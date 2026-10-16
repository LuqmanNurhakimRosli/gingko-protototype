// Ginkgo Copilot — server-side proxy to the model provider: the Claude API
// directly, or OpenRouter (server/openrouter.ts).
// Runs as a Cloudflare Pages Function (functions/api/copilot.ts) and as Vite
// dev/preview middleware (vite.config.ts). API keys never reach the browser.
//
// The browser owns the conversation and runs the tools; this handler only adds
// the fixed system prompt, tool list and model, and forwards the history as-is.
// Histories are append-only (never edited), which keeps prompt caching warm and
// thinking blocks valid across turns.

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_EFFORT, DEFAULT_MODEL, DEFAULT_OPENROUTER_MODEL, LIMITS, SYSTEM_PROMPT, TOOLS } from '../src/copilot/agentSpec';
import { callOpenRouter, type HistoryMessage } from './openrouter';

/** Shared store of finished API replies, keyed by a hash of the whole request.
 *  Visitors who tap the same suggestion with the same map view get the stored
 *  reply instantly and at no API cost; any difference in history misses. */
export interface ResponseCache {
  get(key: string): Promise<unknown | null>;
  put(key: string, value: unknown): Promise<void>;
}

/** In-process cache for `vite dev` / `vite preview`. */
export function memoryCache(max = 300): ResponseCache {
  const m = new Map<string, unknown>();
  return {
    async get(key) {
      const v = m.get(key);
      if (v === undefined) return null;
      m.delete(key); m.set(key, v);  // most recently used last
      return v;
    },
    async put(key, value) {
      m.set(key, value);
      while (m.size > max) m.delete(m.keys().next().value!);
    },
  };
}

export async function cacheKey(model: string, effort: string, messages: unknown): Promise<string> {
  // the fixed prompt and tools are part of the key, so editing them never serves stale replies
  const text = JSON.stringify([model, effort, SYSTEM_PROMPT, TOOLS, messages]);
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

export interface CopilotEnv {
  /** anthropic | openrouter. Unset: OpenRouter when OPENROUTER_API_KEY is set, else Anthropic. */
  AI_PROVIDER?: string;
  ANTHROPIC_API_KEY?: string;
  /** Override the Claude API model, e.g. claude-sonnet-5-5 or claude-haiku-5-5 for lower cost. */
  COPILOT_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  /** OpenRouter model slug as listed on openrouter.ai/models, e.g. anthropic/claude-sonnet-5.5 */
  OPENROUTER_MODEL?: string;
  /** Public URL of the site, sent to OpenRouter as HTTP-Referer for app attribution. */
  COPILOT_SITE_URL?: string;
  /** low | medium | high | xhigh | max */
  COPILOT_EFFORT?: string;
  /** Comma-separated list of allowed Origin values; unset allows any. */
  COPILOT_ALLOWED_ORIGINS?: string;
}

type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];
const USER_BLOCKS = new Set(['text', 'tool_result']);
const BETAS: Anthropic.Beta.AnthropicBeta[] = ['server-side-fallback-2026-07-01', 'thinking-binding-controls-2026-08-01'];

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export type Provider = 'anthropic' | 'openrouter';

/** Which provider answers: AI_PROVIDER if set (and its key is present), else whichever key is set. */
export function providerOf(env: CopilotEnv): Provider | null {
  const want = env.AI_PROVIDER?.trim().toLowerCase();
  if (want === 'openrouter') return env.OPENROUTER_API_KEY ? 'openrouter' : null;
  if (want === 'anthropic') return env.ANTHROPIC_API_KEY ? 'anthropic' : null;
  if (env.OPENROUTER_API_KEY) return 'openrouter';
  if (env.ANTHROPIC_API_KEY) return 'anthropic';
  return null;
}

function modelOf(env: CopilotEnv, provider: Provider | null = providerOf(env)) {
  return provider === 'openrouter'
    ? env.OPENROUTER_MODEL?.trim() || DEFAULT_OPENROUTER_MODEL
    : env.COPILOT_MODEL?.trim() || DEFAULT_MODEL;
}

/** Shape checks only — the content itself is passed through unchanged. */
export function validateMessages(raw: unknown): { ok: true; messages: Anthropic.Beta.BetaMessageParam[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'messages must be a non-empty array' };
  if (raw.length > LIMITS.maxMessages) return { ok: false, error: 'conversation too long — start a new one' };
  if (raw[0]?.role !== 'user') return { ok: false, error: 'first message must be from the user' };
  for (const [i, m] of raw.entries()) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) return { ok: false, error: `messages.${i}: role must be user or assistant` };
    if (typeof m.content === 'string') continue;
    if (!Array.isArray(m.content)) return { ok: false, error: `messages.${i}: content must be a string or an array` };
    if (m.role === 'user') {
      for (const b of m.content) {
        if (!b || !USER_BLOCKS.has(b.type)) return { ok: false, error: `messages.${i}: user content may only contain text and tool_result blocks` };
      }
    }
  }
  return { ok: true, messages: raw as Anthropic.Beta.BetaMessageParam[] };
}

export async function handleCopilot(
  request: Request,
  env: CopilotEnv,
  deps: { client?: Pick<Anthropic, 'beta'>; cache?: ResponseCache; fetch?: typeof fetch } = {},
): Promise<Response> {
  const origins = env.COPILOT_ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (origins?.length && origin && !origins.includes(origin)) return json(403, { error: 'origin not allowed' });

  const provider = providerOf(env) ?? (deps.client ? 'anthropic' : null);
  if (request.method === 'GET') {
    return json(200, { enabled: provider !== null, model: modelOf(env, provider), provider });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!provider) return json(503, { error: 'AI copilot is not configured (set OPENROUTER_API_KEY or ANTHROPIC_API_KEY)' });

  const text = await request.text();
  if (text.length > LIMITS.maxBytes) return json(413, { error: 'conversation too long — start a new one' });
  let body: { messages?: unknown };
  try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }); }
  const v = validateMessages(body.messages);
  if (!v.ok) return json(400, { error: v.error });

  const effort = (EFFORTS as string[]).includes(env.COPILOT_EFFORT ?? '') ? env.COPILOT_EFFORT as Effort : DEFAULT_EFFORT;
  const model = modelOf(env, provider);
  const key = deps.cache ? await cacheKey(`${provider}:${model}`, effort, v.messages) : null;
  if (key) {
    const hit = await deps.cache!.get(key).catch(() => null);
    if (hit && typeof hit === 'object') return json(200, { ...hit, cached: true });
  }
  // only complete, ordinary turns are worth replaying
  const store = async (payload: { stop_reason: string | null }) => {
    if (key && (payload.stop_reason === 'end_turn' || payload.stop_reason === 'tool_use')) {
      await deps.cache!.put(key, payload).catch(() => {});
    }
  };

  if (provider === 'openrouter') {
    const r = await callOpenRouter({
      apiKey: env.OPENROUTER_API_KEY ?? '', model, effort, history: v.messages as unknown as HistoryMessage[],
      referer: env.COPILOT_SITE_URL?.trim() || origin || undefined, fetchImpl: deps.fetch,
    });
    if (!r.ok) return json(r.status, { error: r.error });
    await store(r.reply);
    return json(200, { ...r.reply, cached: false });
  }

  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: BETAS,
      // On a safety decline the API re-runs the turn on Anthropic's recommended fallback model.
      fallbacks: 'default',
      // Adaptive thinking; if a replayed thinking block ever fails the conversation
      // check, drop it instead of failing the demo with a 400.
      thinking: { type: 'adaptive', block_binding: { prefix_mismatch_behavior: 'drop_block' } },
      output_config: { effort },
      cache_control: { type: 'ephemeral' },
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages: v.messages,
    });
    if (response.input_transformations?.length) {
      console.warn('copilot: input_transformations', JSON.stringify(response.input_transformations));
    }
    const payload = {
      id: response.id,
      model: response.model,
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_details ?? null,
      usage: response.usage,
    };
    await store(payload);
    return json(200, { ...payload, cached: false });
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) return json(429, { error: 'The AI service is busy — try again in a moment.' });
    if (err instanceof Anthropic.AuthenticationError) return json(502, { error: 'The AI service rejected the server API key.' });
    if (err instanceof Anthropic.BadRequestError) {
      console.error('copilot: bad request', err.message);
      return json(400, { error: 'The AI service rejected this conversation — start a new one.' });
    }
    if (err instanceof Anthropic.APIError) {
      console.error('copilot: API error', err.status, err.message);
      return json(502, { error: 'The AI service returned an error.' });
    }
    console.error('copilot: unexpected error', err);
    return json(502, { error: 'Could not reach the AI service.' });
  }
}
