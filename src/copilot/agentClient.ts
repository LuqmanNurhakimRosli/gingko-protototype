// Ginkgo Copilot — the agent loop, run in the browser.
// POSTs the conversation to /api/copilot (which holds the API key and the fixed
// system prompt + tools), runs any requested tools locally over the grid, and
// repeats until Claude answers. The history is append-only: blocks returned by
// the API are stored and sent back exactly as received.

import type Anthropic from '@anthropic-ai/sdk';
import { MAX_TOOL_ROUNDS, PRICES } from './agentSpec';
import type { ToolOutcome } from './agentTools';
import { checkGrounding, type GroundingResult } from './grounding';

export type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlock = Anthropic.Beta.BetaContentBlock;

export interface AgentStep { id: string; label: string; ok: boolean }

/** What one answer cost: tokens summed over its API rounds. Rounds served from
 *  the shared reply cache cost nothing and are counted separately. */
export interface TurnUsage {
  rounds: number;
  cachedRounds: number;
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
  /** US$ estimate from list prices; null for an unknown model */
  costUsd: number | null;
  ms: number;
}

export interface AgentReply {
  text: string;
  steps: AgentStep[];
  grounding: GroundingResult;
  stopReason: string;
  model: string | null;
  notice?: string;
  usage: TurnUsage;
}

interface ApiUsage { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }

export function costOf(model: string | null, u: Pick<TurnUsage, 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cacheWriteTokens'>): number | null {
  const p = PRICES[(model ?? '').replace(/-\d{8}$/, '')];
  if (!p) return null;
  return (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) / 1e6;
}

export interface AgentStatus { enabled: boolean; model: string | null }

export const COPILOT_ENDPOINT = '/api/copilot';

export async function fetchAgentStatus(fetchImpl: typeof fetch = fetch): Promise<AgentStatus> {
  try {
    const r = await fetchImpl(COPILOT_ENDPOINT, { method: 'GET' });
    if (!r.ok || !(r.headers.get('content-type') ?? '').includes('application/json')) return { enabled: false, model: null };
    const j = await r.json() as { enabled?: boolean; model?: string };
    return { enabled: Boolean(j.enabled), model: j.model ?? null };
  } catch {
    return { enabled: false, model: null };
  }
}

interface ApiResponse { content: ContentBlock[]; stop_reason: string | null; model?: string; error?: string; usage?: ApiUsage; cached?: boolean }

/** Every number the tools have returned so far in this conversation. */
function toolResultSources(history: MessageParam[]): unknown[] {
  const out: unknown[] = [];
  for (const m of history) {
    if (m.role !== 'user' || typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'text') out.push(b.text);
      if (b.type === 'tool_result' && typeof b.content === 'string') {
        try { out.push(JSON.parse(b.content)); } catch { out.push(b.content); }
      }
    }
  }
  return out;
}

export async function runAgentTurn(opts: {
  history: MessageParam[];
  userText: string;
  context: unknown;
  execute: (name: string, input: unknown) => ToolOutcome;
  onStep?: (s: AgentStep) => void;
  extraSources?: unknown[];
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}): Promise<{ history: MessageParam[]; reply: AgentReply }> {
  const doFetch = opts.fetchImpl ?? fetch;
  const history: MessageParam[] = [...opts.history, {
    role: 'user',
    content: [
      { type: 'text', text: opts.userText },
      { type: 'text', text: `<map_context>\n${JSON.stringify(opts.context)}\n</map_context>` },
    ],
  }];
  const steps: AgentStep[] = [];
  let model: string | null = null;
  const t0 = Date.now();
  const usage: TurnUsage = { rounds: 0, cachedRounds: 0, inputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, outputTokens: 0, costUsd: 0, ms: 0 };
  const finish = () => ({ ...usage, costUsd: costOf(model, usage), ms: Date.now() - t0 });

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const res = await doFetch(COPILOT_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: history }),
      signal: opts.signal,
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as ApiResponse;
    if (!res.ok || data.error) throw new Error(data.error ?? `HTTP ${res.status}`);
    model = data.model ?? model;
    usage.rounds++;
    if (data.cached) usage.cachedRounds++;
    else if (data.usage) {
      usage.inputTokens += data.usage.input_tokens ?? 0;
      usage.outputTokens += data.usage.output_tokens ?? 0;
      usage.cacheReadTokens += data.usage.cache_read_input_tokens ?? 0;
      usage.cacheWriteTokens += data.usage.cache_creation_input_tokens ?? 0;
    }
    history.push({ role: 'assistant', content: data.content });

    if (data.stop_reason === 'tool_use') {
      const uses = data.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
      const results: Anthropic.Beta.BetaToolResultBlockParam[] = uses.map(u => {
        const out = opts.execute(u.name, u.input);
        const step = { id: u.id, label: out.step, ok: !out.isError };
        steps.push(step);
        opts.onStep?.(step);
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out.result), ...(out.isError ? { is_error: true } : {}) };
      });
      // all results for one assistant turn go back in a single user message
      history.push({ role: 'user', content: results });
      continue;
    }
    if (data.stop_reason === 'pause_turn') continue;

    const text = data.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map(b => b.text).join('\n').trim();
    const sources = [...toolResultSources(history), opts.context, ...(opts.extraSources ?? [])];
    if (data.stop_reason === 'refusal') {
      const t = 'I can’t help with that request. Ask me about flood susceptibility, places, facilities or scenarios in Selangor.';
      return { history, reply: { text: t, steps, grounding: checkGrounding(t, sources), stopReason: 'refusal', model, usage: finish() } };
    }
    const notice = data.stop_reason === 'max_tokens' ? 'The answer was cut off at the length limit.' : undefined;
    return { history, reply: { text: text || '(no answer)', steps, grounding: checkGrounding(text, sources), stopReason: data.stop_reason ?? 'end_turn', model, notice, usage: finish() } };
  }
  const t = `I stopped after ${MAX_TOOL_ROUNDS} rounds of tool calls without finishing. Try a narrower question.`;
  return { history, reply: { text: t, steps, grounding: checkGrounding(t, [MAX_TOOL_ROUNDS]), stopReason: 'tool_limit', model, usage: finish() } };
}
