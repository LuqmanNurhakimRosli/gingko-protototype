// Ginkgo Copilot — OpenRouter provider (OpenAI-compatible chat completions).
//
// The browser's agent loop speaks the Claude Messages shape (text / tool_use /
// tool_result blocks). This module translates that history to an OpenRouter
// request and the reply back, so the loop, tools and grounding check are the
// same whichever provider the server uses.
//
// Reasoning continuity: OpenRouter returns `reasoning_details` on assistant
// turns; models that reason between tool calls need them sent back unchanged.
// They travel through the browser inside an `openrouter_reasoning` block of the
// assistant turn (the history stays append-only) and are re-attached here.

import { SYSTEM_PROMPT, TOOLS } from '../src/copilot/agentSpec';

export const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const REASONING_BLOCK = 'openrouter_reasoning';

type Json = Record<string, unknown>;
interface Block extends Json { type: string }
export interface HistoryMessage { role: 'user' | 'assistant'; content: string | Block[] }

interface ToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
type ORMessage =
  | { role: 'system'; content: string | Json[] }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[]; reasoning_details?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface OpenRouterOptions {
  model: string;
  /** low | medium | high (xhigh/max map to high) */
  effort: string;
  maxTokens?: number;
}

const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(p => (p && typeof p === 'object' && 'text' in p ? String((p as Json).text) : '')).join('\n');
  }
  return content == null ? '' : JSON.stringify(content);
};

/** Claude-shaped history → OpenRouter chat messages. */
export function toChatMessages(history: HistoryMessage[], model: string): ORMessage[] {
  // Anthropic models on OpenRouter cache only at explicit breakpoints; the fixed
  // tool list and system prompt are the stable prefix, so mark the system prompt.
  const system: ORMessage = model.startsWith('anthropic/')
    ? { role: 'system', content: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }] }
    : { role: 'system', content: SYSTEM_PROMPT };
  const out: ORMessage[] = [system];
  for (const m of history) {
    if (typeof m.content === 'string') {
      out.push(m.role === 'user' ? { role: 'user', content: m.content } : { role: 'assistant', content: m.content });
      continue;
    }
    if (m.role === 'user') {
      // tool results must directly follow the assistant turn that asked for them
      const texts: string[] = [];
      for (const b of m.content) {
        if (b.type === 'tool_result') {
          const body = textOf(b.content);
          out.push({ role: 'tool', tool_call_id: String(b.tool_use_id), content: b.is_error ? `ERROR: ${body}` : body });
        } else if (b.type === 'text') texts.push(String(b.text));
      }
      if (texts.length) out.push({ role: 'user', content: texts.join('\n\n') });
      continue;
    }
    const text: string[] = [];
    const calls: ToolCall[] = [];
    let reasoning: unknown[] | undefined;
    for (const b of m.content) {
      if (b.type === 'text') text.push(String(b.text));
      else if (b.type === 'tool_use') {
        calls.push({ id: String(b.id), type: 'function', function: { name: String(b.name), arguments: JSON.stringify(b.input ?? {}) } });
      } else if (b.type === REASONING_BLOCK && Array.isArray(b.reasoning_details)) reasoning = b.reasoning_details;
      // Claude thinking blocks from a direct-API conversation cannot be replayed here; they are dropped
    }
    out.push({
      role: 'assistant',
      content: text.length ? text.join('\n') : null,
      ...(calls.length ? { tool_calls: calls } : {}),
      ...(reasoning ? { reasoning_details: reasoning } : {}),
    });
  }
  return out;
}

/** The same 11 tools, as OpenAI-style function definitions. */
export const CHAT_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description ?? '', parameters: t.input_schema },
}));

export function buildRequest(history: HistoryMessage[], opts: OpenRouterOptions) {
  const effort = opts.effort === 'low' || opts.effort === 'medium' ? opts.effort : 'high';
  return {
    model: opts.model,
    messages: toChatMessages(history, opts.model),
    tools: CHAT_TOOLS,
    tool_choice: 'auto',
    max_tokens: opts.maxTokens ?? 16000,
    reasoning: { effort },
    // ask OpenRouter to report the request's cost alongside the token counts
    usage: { include: true },
  };
}

interface ChatResponse {
  id?: string;
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: unknown; tool_calls?: ToolCall[]; reasoning_details?: unknown[] };
    error?: { message?: string };
  }[];
  usage?: {
    prompt_tokens?: number; completion_tokens?: number; cost?: number;
    prompt_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number };
  };
  error?: { message?: string; code?: number };
}

export interface ProviderReply {
  id: string;
  model: string;
  content: Block[];
  stop_reason: string;
  stop_details: null;
  usage: {
    input_tokens: number; output_tokens: number;
    cache_read_input_tokens: number; cache_creation_input_tokens: number;
    /** actual US$ charged, when the provider reports it */
    cost_usd?: number;
  };
}

/** OpenRouter reply → the Claude-shaped reply the browser loop expects. */
export function fromChatResponse(r: ChatResponse, model: string): ProviderReply {
  const choice = r.choices?.[0];
  if (!choice?.message) throw new Error(choice?.error?.message ?? r.error?.message ?? 'empty reply from OpenRouter');
  const msg = choice.message;
  const content: Block[] = [];
  if (Array.isArray(msg.reasoning_details) && msg.reasoning_details.length) {
    content.push({ type: REASONING_BLOCK, reasoning_details: msg.reasoning_details });
  }
  const text = textOf(msg.content).trim();
  if (text) content.push({ type: 'text', text });
  for (const [i, tc] of (msg.tool_calls ?? []).entries()) {
    let input: unknown = {};
    try { input = JSON.parse(tc.function?.arguments || '{}'); } catch { /* the tool reports the bad input back to the model */ }
    content.push({ type: 'tool_use', id: tc.id || `call_${i}`, name: tc.function?.name ?? '', input });
  }
  const calls = msg.tool_calls?.length ?? 0;
  const stop = calls ? 'tool_use'
    : choice.finish_reason === 'length' ? 'max_tokens'
      : choice.finish_reason === 'content_filter' ? 'refusal' : 'end_turn';
  const u = r.usage ?? {};
  const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
  const written = u.prompt_tokens_details?.cache_write_tokens ?? 0;
  return {
    id: r.id ?? '',
    model: r.model ?? model,
    content,
    stop_reason: stop,
    stop_details: null,
    usage: {
      input_tokens: Math.max(0, (u.prompt_tokens ?? 0) - cached - written),
      output_tokens: u.completion_tokens ?? 0,
      cache_read_input_tokens: cached,
      cache_creation_input_tokens: written,
      ...(typeof u.cost === 'number' ? { cost_usd: u.cost } : {}),
    },
  };
}

const ERRORS: Record<number, [number, string]> = {
  400: [400, 'The AI service rejected this conversation — start a new one.'],
  401: [502, 'OpenRouter rejected the server API key.'],
  402: [502, 'The OpenRouter account is out of credits.'],
  403: [502, 'The AI service declined this request.'],
  408: [504, 'The AI service timed out — try again.'],
  429: [429, 'The AI service is busy — try again in a moment.'],
};

export async function callOpenRouter(opts: OpenRouterOptions & {
  apiKey: string;
  history: HistoryMessage[];
  /** shown on openrouter.ai as the calling app */
  referer?: string;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: true; reply: ProviderReply } | { ok: false; status: number; error: string }> {
  const doFetch = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await doFetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${opts.apiKey}`,
        'content-type': 'application/json',
        'x-title': 'Ginkgo Flood Command Center',
        ...(opts.referer ? { 'http-referer': opts.referer } : {}),
      },
      body: JSON.stringify(buildRequest(opts.history, opts)),
    });
  } catch (err) {
    console.error('copilot/openrouter: network error', err);
    return { ok: false, status: 502, error: 'Could not reach the AI service.' };
  }
  const body = await res.json().catch(() => null) as ChatResponse | null;
  if (!res.ok) {
    const detail = (body?.error?.message ?? '').replace(/\s+/g, ' ').slice(0, 200);
    console.error('copilot/openrouter: HTTP', res.status, detail);
    // a wrong model slug comes back as 400/404; show OpenRouter's own words so it can be fixed
    if ((res.status === 400 || res.status === 404) && detail) return { ok: false, status: 400, error: `OpenRouter: ${detail}` };
    const [status, error] = ERRORS[res.status] ?? [502, 'The AI service returned an error.'];
    return { ok: false, status, error };
  }
  try {
    return { ok: true, reply: fromChatResponse(body ?? {}, opts.model) };
  } catch (err) {
    console.error('copilot/openrouter: bad reply', err);
    return { ok: false, status: 502, error: 'The AI service returned an error.' };
  }
}
