import { describe, expect, it } from 'vitest';
import { DEFAULT_OPENROUTER_MODEL, SYSTEM_PROMPT, TOOLS } from '../src/copilot/agentSpec';
import { runAgentTurn } from '../src/copilot/agentClient';
import { modelName } from '../src/copilot/models';
import { handleCopilot, memoryCache, providerOf } from './copilot';
import { buildRequest, fromChatResponse, OPENROUTER_URL, REASONING_BLOCK, toChatMessages, type HistoryMessage } from './openrouter';

const reasoning = [{ type: 'reasoning.encrypted', data: 'opaque', id: 'r1', format: 'anthropic-claude-v1', index: 0 }];

const history: HistoryMessage[] = [
  { role: 'user', content: [{ type: 'text', text: 'Is Dengkil flood-prone?' }, { type: 'text', text: '<map_context>{}</map_context>' }] },
  { role: 'assistant', content: [
    { type: REASONING_BLOCK, reasoning_details: reasoning },
    { type: 'text', text: 'Let me look.' },
    { type: 'tool_use', id: 'call_a', name: 'search_places', input: { query: 'Dengkil', limit: 3 } },
    { type: 'tool_use', id: 'call_b', name: 'get_current_view', input: {} },
  ] },
  { role: 'user', content: [
    { type: 'tool_result', tool_use_id: 'call_a', content: '{"results":[]}' },
    { type: 'tool_result', tool_use_id: 'call_b', content: '{"error":"x"}', is_error: true },
  ] },
];

describe('provider choice', () => {
  it('uses AI_PROVIDER when its key is set, else whichever key exists (OpenRouter first)', () => {
    expect(providerOf({})).toBeNull();
    expect(providerOf({ ANTHROPIC_API_KEY: 'a' })).toBe('anthropic');
    expect(providerOf({ OPENROUTER_API_KEY: 'o' })).toBe('openrouter');
    expect(providerOf({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o' })).toBe('openrouter');
    expect(providerOf({ ANTHROPIC_API_KEY: 'a', OPENROUTER_API_KEY: 'o', AI_PROVIDER: 'anthropic' })).toBe('anthropic');
    expect(providerOf({ ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'openrouter' })).toBeNull();
  });
});

describe('OpenRouter translation', () => {
  it('turns the Claude-shaped history into chat messages, keeping reasoning and tool-call order', () => {
    const m = toChatMessages(history, 'anthropic/claude-opus-5.5');
    expect(m.map(x => x.role)).toEqual(['system', 'user', 'assistant', 'tool', 'tool']);
    // Anthropic models cache at explicit breakpoints: the system prompt carries one
    expect(m[0].content).toEqual([{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
    expect(m[1]).toEqual({ role: 'user', content: 'Is Dengkil flood-prone?\n\n<map_context>{}</map_context>' });
    expect(m[2]).toEqual({
      role: 'assistant', content: 'Let me look.', reasoning_details: reasoning,
      tool_calls: [
        { id: 'call_a', type: 'function', function: { name: 'search_places', arguments: '{"query":"Dengkil","limit":3}' } },
        { id: 'call_b', type: 'function', function: { name: 'get_current_view', arguments: '{}' } },
      ],
    });
    expect(m[3]).toEqual({ role: 'tool', tool_call_id: 'call_a', content: '{"results":[]}' });
    expect(m[4]).toEqual({ role: 'tool', tool_call_id: 'call_b', content: 'ERROR: {"error":"x"}' });
    // other providers cache automatically: plain system string
    expect(toChatMessages(history, 'openai/gpt-5')[0]).toEqual({ role: 'system', content: SYSTEM_PROMPT });
  });

  it('drops Claude API thinking blocks, which cannot be replayed through OpenRouter', () => {
    const m = toChatMessages([{ role: 'user', content: 'q' }, { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'a' }] }], 'x/y');
    expect(m[2]).toEqual({ role: 'assistant', content: 'a' });
  });

  it('sends the same 11 tools as function definitions, with reasoning effort and cost reporting', () => {
    const body = buildRequest(history, { model: 'anthropic/claude-opus-5.5', effort: 'xhigh' });
    expect(body.tools).toHaveLength(TOOLS.length);
    expect(body.tools[0]).toEqual({ type: 'function', function: { name: TOOLS[0].name, description: TOOLS[0].description, parameters: TOOLS[0].input_schema } });
    expect(body).toMatchObject({ model: 'anthropic/claude-opus-5.5', tool_choice: 'auto', reasoning: { effort: 'high' }, usage: { include: true } });
    expect(buildRequest(history, { model: 'm', effort: 'low' }).reasoning).toEqual({ effort: 'low' });
  });

  it('turns a chat reply back into tool_use blocks, usage and the reported cost', () => {
    const r = fromChatResponse({
      id: 'gen-1', model: 'anthropic/claude-opus-5.5',
      choices: [{ finish_reason: 'tool_calls', message: {
        content: null, reasoning_details: reasoning,
        tool_calls: [
          { id: 'call_x', type: 'function', function: { name: 'query_point', arguments: '{"latitude":3.03,"longitude":101.53}' } },
          { id: 'call_y', type: 'function', function: { name: 'rank_daerah', arguments: '{not json' } },
        ],
      } }],
      usage: { prompt_tokens: 5000, completion_tokens: 300, cost: 0.0123, prompt_tokens_details: { cached_tokens: 3500 } },
    }, 'fallback');
    expect(r.stop_reason).toBe('tool_use');
    expect(r.content).toEqual([
      { type: REASONING_BLOCK, reasoning_details: reasoning },
      { type: 'tool_use', id: 'call_x', name: 'query_point', input: { latitude: 3.03, longitude: 101.53 } },
      { type: 'tool_use', id: 'call_y', name: 'rank_daerah', input: {} },
    ]);
    expect(r.usage).toEqual({ input_tokens: 1500, output_tokens: 300, cache_read_input_tokens: 3500, cache_creation_input_tokens: 0, cost_usd: 0.0123 });
    const cut = fromChatResponse({ choices: [{ finish_reason: 'length', message: { content: 'partial' } }] }, 'm');
    expect([cut.stop_reason, cut.model]).toEqual(['max_tokens', 'm']);
    expect(() => fromChatResponse({ choices: [] }, 'm')).toThrow();
  });

  it('shows OpenRouter slugs as readable names', () => {
    expect(modelName('anthropic/claude-opus-5.5')).toBe('Claude Opus 5.5');
    expect(modelName('anthropic/claude-sonnet-4.5:beta')).toBe('Claude Sonnet 4.5');
    expect(modelName('openai/gpt-5')).toBe('GPT 5');
    expect(modelName('claude-opus-5-5')).toBe('Claude Opus 5.5');
  });
});

describe('proxy with OpenRouter', () => {
  const env = { OPENROUTER_API_KEY: 'sk-or-test' };
  const post = (messages: unknown) => new Request('http://x/api/copilot', {
    method: 'POST', body: JSON.stringify({ messages }), headers: { 'content-type': 'application/json', origin: 'https://ginkgo.example' },
  });

  it('reports the provider and model', async () => {
    const s = await (await handleCopilot(new Request('http://x/api/copilot'), env)).json();
    expect(s).toEqual({ enabled: true, model: DEFAULT_OPENROUTER_MODEL, provider: 'openrouter' });
    const t = await (await handleCopilot(new Request('http://x/api/copilot'), { ...env, OPENROUTER_MODEL: 'anthropic/claude-sonnet-5.5' })).json();
    expect(t.model).toBe('anthropic/claude-sonnet-5.5');
  });

  it('runs a whole agent turn through the proxy: tool call, local tool, final answer', async () => {
    const sent: { url: string; headers: Record<string, string>; body: { model: string; messages: { role: string }[] } }[] = [];
    const replies = [
      { id: 'g1', model: 'anthropic/claude-opus-5.5', choices: [{ finish_reason: 'tool_calls', message: { content: null, reasoning_details: reasoning,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_current_view', arguments: '{}' } }] } }],
        usage: { prompt_tokens: 4000, completion_tokens: 60, cost: 0.004, prompt_tokens_details: { cached_tokens: 3000 } } },
      { id: 'g2', model: 'anthropic/claude-opus-5.5', choices: [{ finish_reason: 'stop', message: { content: 'Under Normal rain the view is 17.4% High.' } }],
        usage: { prompt_tokens: 4200, completion_tokens: 40, cost: 0.003, prompt_tokens_details: { cached_tokens: 4000 } } },
    ];
    const orFetch = (async (url: string, init: RequestInit) => {
      sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(replies[sent.length - 1]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    // the browser loop talks to the proxy, which talks to (mocked) OpenRouter
    const viaProxy = (async (_url: string, init: RequestInit) =>
      handleCopilot(new Request('http://x/api/copilot', init), env, { fetch: orFetch })) as unknown as typeof fetch;

    const { history: h, reply } = await runAgentTurn({
      history: [], userText: 'How much of this view is High?', context: { scenario: 'normal' },
      execute: () => ({ step: 'Read the current map view', result: { high_pct: 17.4 } }), fetchImpl: viaProxy,
    });

    expect(sent[0].url).toBe(OPENROUTER_URL);
    expect(sent[0].headers.authorization).toBe('Bearer sk-or-test');
    expect(sent[0].headers['http-referer']).toBeUndefined(); // the browser loop sends no Origin here
    expect(sent[0].body.model).toBe(DEFAULT_OPENROUTER_MODEL);
    // second request: system, user, assistant (tool call + reasoning), tool result
    expect(sent[1].body.messages.map(m => m.role)).toEqual(['system', 'user', 'assistant', 'tool']);
    expect((sent[1].body.messages[2] as { reasoning_details?: unknown }).reasoning_details).toEqual(reasoning);
    expect(reply.text).toBe('Under Normal rain the view is 17.4% High.');
    expect(reply.grounding).toMatchObject({ total: 1, grounded: 1 });
    expect(reply.usage).toMatchObject({ rounds: 2, inputTokens: 1200, cacheReadTokens: 7000, outputTokens: 100 });
    expect(reply.usage.costUsd).toBeCloseTo(0.007, 9); // the cost OpenRouter reported, not a list-price estimate
    expect(h).toHaveLength(4);
  });

  it('caches complete turns per provider and model', async () => {
    let calls = 0;
    const orFetch = (async () => { calls++; return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: 'ok' } }] }), { status: 200 }); }) as unknown as typeof fetch;
    const cache = memoryCache();
    const msgs = [{ role: 'user', content: [{ type: 'text', text: 'How was the model checked?' }] }];
    const a = await (await handleCopilot(post(msgs), env, { fetch: orFetch, cache })).json();
    const b = await (await handleCopilot(post(msgs), env, { fetch: orFetch, cache })).json();
    expect(calls).toBe(1);
    expect([a.cached, b.cached]).toEqual([false, true]);
    await handleCopilot(post(msgs), { ...env, OPENROUTER_MODEL: 'openai/gpt-5' }, { fetch: orFetch, cache });
    expect(calls).toBe(2);
  });

  it('sends the site as HTTP-Referer and maps OpenRouter errors to readable messages', async () => {
    let headers: Record<string, string> = {};
    const fail = (status: number, message: string) => (async (_u: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response(JSON.stringify({ error: { code: status, message } }), { status });
    }) as unknown as typeof fetch;
    const msgs = [{ role: 'user', content: 'hi' }];
    const credits = await handleCopilot(post(msgs), env, { fetch: fail(402, 'Insufficient credits') });
    expect([credits.status, (await credits.json()).error]).toEqual([502, 'The OpenRouter account is out of credits.']);
    expect(headers['http-referer']).toBe('https://ginkgo.example');
    const badModel = await handleCopilot(post(msgs), env, { fetch: fail(400, 'nope/model is not a valid model ID') });
    expect([badModel.status, (await badModel.json()).error]).toEqual([400, 'OpenRouter: nope/model is not a valid model ID']);
    const busy = await handleCopilot(post(msgs), env, { fetch: fail(429, 'rate limited') });
    expect(busy.status).toBe(429);
    const down = await handleCopilot(post(msgs), env, { fetch: (async () => { throw new Error('ENOTFOUND'); }) as unknown as typeof fetch });
    expect([down.status, (await down.json()).error]).toEqual([502, 'Could not reach the AI service.']);
  });
});
