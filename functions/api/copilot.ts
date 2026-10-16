// Cloudflare Pages Function: /api/copilot → Claude API proxy.
// Set ANTHROPIC_API_KEY (as a secret) in Pages → Settings → Environment variables.
import { handleCopilot, type CopilotEnv } from '../../server/copilot';

export const onRequest = (ctx: { request: Request; env: CopilotEnv }): Promise<Response> =>
  handleCopilot(ctx.request, ctx.env);
