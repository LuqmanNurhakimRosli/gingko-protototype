// Ginkgo Copilot — React state for the Claude agent (status, conversation, busy flag).

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { fetchAgentStatus, runAgentTurn, type AgentReply, type AgentStep, type MessageParam, type TurnUsage } from './agentClient';
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
  usage?: TurnUsage;
  /** shown on the question bubble instead of the full prompt (e.g. "Draft a brief for Area 2") */
  label?: string;
}

export interface SessionTotals { answers: number; costUsd: number; cachedRounds: number; rounds: number; tokens: number }
const ZERO: SessionTotals = { answers: 0, costUsd: 0, cachedRounds: 0, rounds: 0, tokens: 0 };

export interface AskOptions {
  /** short text for the question bubble */
  label?: string;
  /** called with the finished reply (e.g. to attach an AI brief to an area) */
  onReply?: (reply: AgentReply) => void;
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
  const [totals, setTotals] = useState<SessionTotals>(ZERO);
  const history = useRef<MessageParam[]>([]);
  const abort = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const busyRef = useRef(false);

  useEffect(() => {
    let alive = true;
    fetchAgentStatus().then(s => { if (alive) { setMode(s.enabled ? 'ai' : 'off'); setModel(s.model); } });
    return () => { alive = false; };
  }, []);

  const ask = useCallback(async (text: string, opts: AskOptions = {}) => {
    const s = session.current;
    if (!s || busyRef.current || !text.trim()) return;
    busyRef.current = true;
    setBusy(true);
    const userId = ++seq.current, botId = ++seq.current;
    setEntries(e => [...e, { id: userId, role: 'user', text, label: opts.label }, { id: botId, role: 'bot', text: '', steps: [], pending: true }]);
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
        ...x, pending: false, text: reply.text, steps: reply.steps, grounding: reply.grounding, model: reply.model, notice: reply.notice, usage: reply.usage,
      } : x)));
      const u = reply.usage;
      setTotals(t => ({
        answers: t.answers + 1, costUsd: t.costUsd + (u.costUsd ?? 0), cachedRounds: t.cachedRounds + u.cachedRounds,
        rounds: t.rounds + u.rounds, tokens: t.tokens + u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens + u.outputTokens,
      }));
      opts.onReply?.(reply);
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

  return { mode, model, entries, busy, totals, ask, reset };
}

export type Agent = ReturnType<typeof useAgent>;
