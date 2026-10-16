import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import { handleCopilot, memoryCache, type CopilotEnv } from './server/copilot'

// https://vite.dev/config/
// The app is static (it reads precomputed files from public/data). The only
// server code is the copilot proxy: a Cloudflare Pages Function in production
// (functions/api/copilot.ts) and this middleware for `vite dev` / `vite preview`.
function copilotApi(env: CopilotEnv): Plugin {
  const cache = memoryCache()
  const handle = async (req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = []
    for await (const c of req) chunks.push(c as Buffer)
    const headers = new Headers()
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
    const request = new Request(`http://localhost${req.url ?? '/'}`, {
      method: req.method, headers, body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    })
    const r = await handleCopilot(request, env, { cache })
    res.statusCode = r.status
    r.headers.forEach((v, k) => res.setHeader(k, v))
    res.end(Buffer.from(await r.arrayBuffer()))
  }
  const mount = (attach: (path: string, fn: (req: IncomingMessage, res: ServerResponse) => void) => void) =>
    attach('/api/copilot', (req, res) => { void handle(req, res) })
  return {
    name: 'ginkgo-copilot-api',
    configureServer(server) { mount(server.middlewares.use.bind(server.middlewares)) },
    configurePreviewServer(server) { mount(server.middlewares.use.bind(server.middlewares)) },
  }
}

export default defineConfig(({ mode }) => {
  // Server-only variables (no VITE_ prefix) are never exposed to the browser bundle.
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react(), copilotApi({
      ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      AI_PROVIDER: env.AI_PROVIDER,
      OPENROUTER_API_KEY: env.OPENROUTER_API_KEY,
      OPENROUTER_MODEL: env.OPENROUTER_MODEL,
      COPILOT_SITE_URL: env.COPILOT_SITE_URL,
      COPILOT_MODEL: env.COPILOT_MODEL,
      COPILOT_EFFORT: env.COPILOT_EFFORT,
      COPILOT_ALLOWED_ORIGINS: env.COPILOT_ALLOWED_ORIGINS,
    })],
    server: { port: 5173 },
    // MapLibre's tile worker is an ES module (see MapView.tsx)
    worker: { format: 'es' as const },
  }
})
