// Poster assets, as transparent PNGs:
//   ginkgo-lockup.png  the Ginkgo logo (leaf + wordmark + descriptor), 863×234 at 2×, the same shape as the
//                      lockup the old poster used, so it drops in without moving anything
//   icon-monitor.png   white line icon for the "System in action" badge
//   node poster/make_assets.mjs
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const svg = readFileSync(join(HERE, '..', 'public', 'logo.svg'), 'utf8').replace(/<\?xml[^>]*\?>/, '');
const html = `<!doctype html><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@600;800&display=swap" rel="stylesheet">
<style>
  html, body { margin: 0; background: transparent; }
  #l { width: 1726px; height: 468px; display: flex; align-items: center; justify-content: center; gap: 44px; font-family: Inter, sans-serif; }
  #l svg { width: 330px; height: 330px; flex: none; }
  .w { font-weight: 800; font-size: 236px; line-height: 1; letter-spacing: -6px; color: #111; margin-top: -26px; }
  .w b { color: #08A045; font-weight: 800; }
  .t { font-weight: 600; font-size: 43px; letter-spacing: 13px; color: #05753A; margin: 6px 0 0 8px; white-space: nowrap; }
</style>
<div id="l">${svg}<div><div class="w">GIN<b>KGO</b></div><div class="t">FLOOD COMMAND CENTER</div></div></div>`;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1726, height: 468 } });
await p.setContent(html);
await p.evaluate(() => document.fonts.ready);
await p.locator('#l').screenshot({ path: join(HERE, 'assets', 'ginkgo-lockup.png'), omitBackground: true });

const icon = `<!doctype html><style>html,body{margin:0;background:transparent}</style>
<svg id="i" width="256" height="256" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/><path d="m10 7 5 3-5 3Z"/></svg>`;
const q = await b.newPage({ viewport: { width: 256, height: 256 } });
await q.setContent(icon);
await q.locator('#i').screenshot({ path: join(HERE, 'assets', 'icon-monitor.png'), omitBackground: true });
await b.close();
