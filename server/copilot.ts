// Ginkgo Copilot — server-side proxy to the Claude API.
// Runs as a Cloudflare Pages Function (functions/api/copilot.ts) and as Vite
// dev/preview middleware (vite.config.ts). The API key never reaches the browser.
//
// The browser owns the conversation and runs the tools; this handler only adds
// the fixed system prompt, tool list and model, and forwards the history as-is.
// Histories are append-only (never edited), which keeps prompt caching warm and
// thinking blocks valid across turns.

import Anthropic from '@anthropic-ai/sdk';
import { DEFAULT_EFFORT, DEFAULT_MODEL, LIMITS, SYSTEM_PROMPT, TOOLS } from '../src/copilot/agentSpec';

export interface CopilotEnv {
  ANTHROPIC_API_KEY?: string;
  /** Override the model, e.g. claude-sonnet-5-5 or claude-haiku-5-5 for lower cost. */
  COPILOT_MODEL?: string;
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

function modelOf(env: CopilotEnv) { return env.COPILOT_MODEL?.trim() || DEFAULT_MODEL; }

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
  deps: { client?: Pick<Anthropic, 'beta'> } = {},
): Promise<Response> {
  const origins = env.COPILOT_ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean);
  const origin = request.headers.get('origin');
  if (origins?.length && origin && !origins.includes(origin)) return json(403, { error: 'origin not allowed' });

  if (request.method === 'GET') {
    return json(200, { enabled: Boolean(env.ANTHROPIC_API_KEY), model: modelOf(env) });
  }
  if (request.method !== 'POST') return json(405, { error: 'method not allowed' });
  if (!env.ANTHROPIC_API_KEY && !deps.client) return json(503, { error: 'AI copilot is not configured (ANTHROPIC_API_KEY is not set)' });

  const text = await request.text();
  if (text.length > LIMITS.maxBytes) return json(413, { error: 'conversation too long — start a new one' });
  let body: { messages?: unknown };
  try { body = JSON.parse(text); } catch { return json(400, { error: 'invalid JSON' }); }
  const v = validateMessages(body.messages);
  if (!v.ok) return json(400, { error: v.error });

  const effort = (EFFORTS as string[]).includes(env.COPILOT_EFFORT ?? '') ? env.COPILOT_EFFORT as Effort : DEFAULT_EFFORT;
  const client = deps.client ?? new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  try {
    const response = await client.beta.messages.create({
      model: modelOf(env),
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
    return json(200, {
      id: response.id,
      model: response.model,
      content: response.content,
      stop_reason: response.stop_reason,
      stop_details: response.stop_details ?? null,
      usage: response.usage,
    });
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
