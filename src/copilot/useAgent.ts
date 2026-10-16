// Ginkgo Copilot — React state for the Claude agent (status, conversation, busy flag).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchAgentStatus, runAgentTurn, type AgentStep, type MessageParam } from './agentClient';
import { runTool, type ToolContext } from './agentTools';
import type { GroundingResult } from './grounding';

export interface AgentEntry {
  id: number;
  role: 'user' | 'bot' | 'error';
  text: string;
  steps?: AgentStep[];
  grounding?: GroundingResult;
  model?: string | null;
  notice?: string;
  pending?: boolean;
}

export interface AgentSession {
  toolCtx: ToolContext;
  /** small JSON block sent with each question: scenario, selection */
  context: unknown;
  /** extra sources a figure may legitimately come from (e.g. model.json) */
  extraSources: unknown[];
}

export type AgentMode = 'checking' | 'ai' | 'off';

export function useAgent(session: RefObject<AgentSession | null>) {
  const [mode, setMode] = useState<AgentMode>('checking');
  const [model, setModel] = useState<string | null>(null);
  const [entries, setEntries] = useState<AgentEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const history = useRef<MessageParam[]>([]);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchAgentStatus().then(s => { if (alive) { setMode(s.enabled ? 'ai' : 'off'); setModel(s.model); } });
    return () => { alive = false; };
  }, []);

  const ask = useCallback(async (text: string) => {
    const s = session.current;
    if (!s || busyRef.current || !text.trim()) return;
    busyRef.current = true;
    setBusy(true);
    const userId = ++seq.current, botId = ++seq.current;
    setEntries(e => [...e, { id: userId, role: 'user', text }, { id: botId, role: 'bot', text: '', steps: [], pending: true }]);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { history: h, reply } = await runAgentTurn({
        history: history.current,
        userText: text,
        context: s.context,
        extraSources: s.extraSources,
        execute: (name, input) => runTool(s.toolCtx, name, input),
        onStep: step => setEntries(e => e.map(x => (x.id === botId ? { ...x, steps: [...(x.steps ?? []), step] } : x))),
        signal: ctrl.signal,
      });
      history.current = h;
      setEntries(e => e.map(x => (x.id === botId ? {
        ...x, pending: false, text: reply.text, steps: reply.steps, grounding: reply.grounding, model: reply.model, notice: reply.notice,
      } : x)));
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const msg = err instanceof Error ? err.message : String(err);
      setEntries(e => e.map(x => (x.id === botId ? { ...x, role: 'error', pending: false, text: msg } : x)));
    } finally {
      if (abort.current === ctrl) { busyRef.current = false; setBusy(false); abort.current = null; }
    }
  }, [session]);

  /** Start a new conversation (the old history is discarded, never edited). */
  const reset = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
    history.current = [];
    busyRef.current = false;
    setBusy(false);
    setEntries([]);
  }, []);

  return { mode, model, entries, busy, ask, reset };
}

export type Agent = ReturnType<typeof useAgent>;
