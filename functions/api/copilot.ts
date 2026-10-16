// Cloudflare Pages Function: /api/copilot → Claude API proxy.
// Set ANTHROPIC_API_KEY (as a secret) in Pages → Settings → Environment variables.
// Optional: bind a KV namespace as COPILOT_CACHE to share replies across visitors;
// without it the edge Cache API is used where available.
import { handleCopilot, type CopilotEnv, type ResponseCache } from '../../server/copilot';

interface KV {
  get(key: string, type: 'json'): Promise<unknown | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
}
interface EdgeCache {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
}

const TTL = 60 * 60 * 24; // replies stay valid while the data and prompt are unchanged; a day keeps the store small

function cacheFor(env: CopilotEnv & { COPILOT_CACHE?: KV }): ResponseCache | undefined {
  if (env.COPILOT_CACHE) {
    const kv = env.COPILOT_CACHE;
    return {
      get: key => kv.get(`copilot:${key}`, 'json'),
      put: (key, value) => kv.put(`copilot:${key}`, JSON.stringify(value), { expirationTtl: TTL }),
    };
  }
  const edge = (globalThis as { caches?: { default?: EdgeCache } }).caches?.default;
  if (!edge) return undefined;
  const url = (key: string) => new Request(`https://copilot-cache.internal/${key}`);
  return {
    get: async key => {
      const r = await edge.match(url(key));
      return r ? r.json() : null;
    },
    put: (key, value) => edge.put(url(key), new Response(JSON.stringify(value), {
      headers: { 'content-type': 'application/json', 'cache-control': `max-age=${TTL}` },
    })),
  };
}

export const onRequest = (ctx: { request: Request; env: CopilotEnv & { COPILOT_CACHE?: KV } }): Promise<Response> =>
  handleCopilot(ctx.request, ctx.env, { cache: cacheFor(ctx.env) });
