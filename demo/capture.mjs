// Ginkgo demo film, step 1: capture real footage of the running app.
//   npm run dev            (in another terminal)
//   node demo/capture.mjs  [outDir=demo/assets]
//
// Screenshots of each workflow step at 1920×1080, typing frames for the AI
// question, a PDF brief, and a frame-by-frame fly-in on the live map.
// The AI scenes use a scripted stand-in for the model behind the real
// /api/copilot contract: the tools, map actions and figures are the app's own.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'demo/assets';
const URL = process.env.GINKGO_URL ?? 'http://localhost:5173/';
const W = 1920, H = 1080;
mkdirSync(join(OUT, 'fly'), { recursive: true });
mkdirSync(join(OUT, 'type'), { recursive: true });
const PARTS = (process.env.PARTS ?? 'ABC').toUpperCase();
const metaPath = join(OUT, 'meta.json');
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const idle = p => p.waitForFunction(() => {
  const m = window.__ginkgoMap;
  return m && m.loaded() && m.areTilesLoaded() && !m.isMoving();
}, null, { timeout: 45000 }).catch(() => console.log('  (map not idle, continuing)'));
const shot = async (p, name) => { await p.mouse.move(W - 5, H - 5); await sleep(250); await p.screenshot({ path: join(OUT, name) }); console.log('  ', name); };

// ── scripted stand-in for the model (same request/response contract as the real proxy) ──
async function mockAgent(route) {
  const req = route.request();
  if (req.method() === 'GET') return route.fulfill({ json: { enabled: true, model: 'anthropic/claude-opus-5.5', provider: 'openrouter' } });
  const msgs = JSON.parse(req.postData()).messages;
  const q = [...msgs].reverse().find(m => m.role === 'user' && Array.isArray(m.content) && m.content[0].type === 'text').content[0].text;
  const last = msgs[msgs.length - 1];
  const results = Array.isArray(last.content) ? last.content.filter(b => b.type === 'tool_result').map(b => JSON.parse(b.content)) : [];
  await sleep(1400);
  const reply = (content, stop_reason) => route.fulfill({ json: { id: 'demo', model: 'anthropic/claude-opus-5.5', content, stop_reason, usage: {}, cached: false } });
  if (/school/i.test(q)) {
    if (!results.length) {
      return reply([
        { type: 'tool_use', id: 'v1', name: 'set_map_view', input: { scenario: 'extreme', daerah: 'Sepang', layers_on: ['schools'], layers_off: [] } },
        { type: 'tool_use', id: 's1', name: 'find_candidate_sites', input: { daerah: 'Sepang', min_area_ha: 5, low_under: 'extreme', max_sites: 4, purpose: 'school' } },
      ], 'tool_use');
    }
    const r = results.find(x => x.sites);
    const text = `I screened ${r.scope} for land that stays **Low even under Extreme rain** and marked ${r.sites.length} candidate blocks on the map:\n\n` +
      r.sites.map(x => `- **${x.site}**: ${x.area_ha} ha, mean slope ${x.mean_slope_deg}°, ${x.nearest_high_cell_m === null ? 'no High cell nearby' : `nearest High cell ${x.nearest_high_cell_m} m away`}`).join('\n') +
      `\n\nThese are screening candidates, not recommendations: zoning, land status and a site flood study still apply.`;
    return reply([{ type: 'text', text }], 'end_turn');
  }
  if (/planning brief/i.test(q)) {
    if (!results.length) return reply([{ type: 'tool_use', id: 'g1', name: 'get_current_view', input: {} }], 'tool_use');
    const a = results[0].active_drawn_area;
    const n = a.by_scenario.normal, e = a.by_scenario.extreme;
    const text = `## Summary\n${a.label} is mostly High susceptibility: ${n.high_pct}% of its Selangor land under Normal rain.\n\n` +
      `## Exposure by scenario\n- Normal: ${n.high_pct}% High, about ${n.people_in_high_estimate.toLocaleString('en-US')} people in High cells\n- Extreme: ${e.high_pct}% High\n\n` +
      `## Why it scores this way\nLow, flat ground close to rivers: the median height above drainage is ${a.terrain.median_height_above_drainage_m} m.\n\n` +
      `## What to check next\n- Commission a site-specific flood study before any approval.\n- Check drainage capacity and evacuation routes for the facilities inside.`;
    return reply([{ type: 'text', text }], 'end_turn');
  }
  return reply([{ type: 'text', text: 'OK.' }], 'end_turn');
}

async function open() {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  await p.route('**/api/copilot', mockAgent);
  await p.goto(URL);
  await p.waitForSelector('.ai-status.ai', { timeout: 30000 });
  await p.waitForFunction(() => !document.querySelector('.cc-bottom .status')?.textContent?.includes('loading terrain'), null, { timeout: 45000 });
  // the demo shows no token/cost figures: the model replies are scripted
  await p.addStyleTag({ content: '.usage-line{display:none!important}' });
  await idle(p); await sleep(800);
  return p;
}

const mapBox = async p => p.locator('.cc-map').boundingBox();

// ── A: overview, scenarios, facilities, draw, AI brief, PDF ──
if (PARTS.includes('A')) {
  console.log('A · overview and analysis');
  const p = await open();
  await shot(p, 'app_normal.png');
  for (const s of ['Heavy', 'Extreme']) {
    await p.locator('.scenario-seg button', { hasText: s }).click();
    await sleep(600); await idle(p);
    await shot(p, `app_${s.toLowerCase()}.png`);
  }
  await p.locator('.scenario-seg button', { hasText: 'Normal' }).click();
  await p.locator('.cc-panel.left .bar-row', { hasText: 'Klang' }).first().click();
  await sleep(1200); await idle(p);
  await p.locator('.gm-chip', { hasText: 'Hospitals' }).click();
  await p.locator('.gm-chip', { hasText: 'Schools' }).click();
  await sleep(600); await idle(p);
  await shot(p, 'app_klang.png');

  await p.locator('.gm-chip', { hasText: 'Schools' }).click();
  await p.locator('.gm-chip', { hasText: 'Rectangle' }).click();
  await sleep(400);
  await shot(p, 'draw_before.png');
  const b = await mapBox(p);
  const a = { x: Math.round(b.x + b.width * 0.40), y: Math.round(b.y + b.height * 0.50) };
  const z = { x: Math.round(b.x + b.width * 0.60), y: Math.round(b.y + b.height * 0.70) };
  meta.draw = { from: a, to: z };
  await p.mouse.move(a.x, a.y); await p.mouse.down();
  await p.mouse.move(z.x, z.y, { steps: 12 }); await p.mouse.up();
  await sleep(900);
  await p.screenshot({ path: join(OUT, 'draw_after.png') }); console.log('   draw_after.png');

  await p.locator('.btn-ai', { hasText: 'Draft brief' }).click();
  await p.waitForSelector('.ai-brief', { timeout: 30000 });
  await sleep(500);
  await p.locator('.ai-brief').scrollIntoViewIfNeeded();
  await sleep(300);
  await shot(p, 'brief.png');
  const [dl] = await Promise.all([p.waitForEvent('download'), p.locator('button', { hasText: 'PDF brief' }).click()]);
  await dl.saveAs(join(OUT, 'brief.pdf'));
  execFileSync('pdftoppm', ['-png', '-r', '110', join(OUT, 'brief.pdf'), join(OUT, 'pdf')]);
  console.log('   brief.pdf → pdf-*.png');
  await p.context().close();
}

// ── B: ask a question from the search box, AI answers and drives the map ──
if (PARTS.includes('B')) {
  console.log('B · AI question');
  const p = await open();
  const q = 'Where could a new school go in Sepang?';
  const input = p.locator('.gm-search input');
  await input.click();
  let k = 0;
  for (let i = 1; i <= q.length; i++) {
    await input.fill(q.slice(0, i));
    if (i % 2 === 0 || i === q.length) {
      await sleep(60);
      await p.screenshot({ path: join(OUT, 'type', `t_${String(k++).padStart(2, '0')}.png`) });
    }
  }
  meta.typeFrames = k;
  console.log(`   ${k} typing frames`);
  await sleep(300);
  await p.keyboard.press('Enter');
  await sleep(500);
  await p.screenshot({ path: join(OUT, 'ai_0.png') }); console.log('   ai_0.png');
  await p.waitForSelector('.agent-steps li', { timeout: 20000 });
  await sleep(1500); await idle(p);
  await p.screenshot({ path: join(OUT, 'ai_1.png') }); console.log('   ai_1.png');
  await p.waitForSelector('.grounding', { timeout: 20000 });
  await sleep(1200); await idle(p);
  await shot(p, 'ai_2.png');
  await p.locator('.panel-tabs button', { hasText: 'Insights' }).click();
  await sleep(500);
  await shot(p, 'ai_sites.png');
  await p.context().close();
}

// ── C: fly-in on the live map, frame by frame ──
if (PARTS.includes('C')) {
  console.log('C · map fly-in');
  const p = await open();
  await p.addStyleTag({ content: `
    .cc{grid-template-rows:1fr!important}.cc-main{grid-template-columns:1fr!important}
    .cc-top,.cc-bottom,.cc-panel,.gm-top,.gm-fabs,.gm-locate,.map-legend,.maplibregl-ctrl-bottom-right,.draw-hint{display:none!important}` });
  await p.evaluate(() => window.__ginkgoMap.resize());
  const merc = ([lon, lat]) => [lon, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const unmerc = ([x, y]) => [x, (360 / Math.PI) * Math.atan(Math.exp(y)) - 90];
  const from = { c: [101.36, 3.25], z: 8.45 }, to = { c: [101.485, 3.052], z: 13.1 };
  const FRAMES = 300;
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const [m0, m1] = [merc(from.c), merc(to.c)];
  for (let i = 0; i < FRAMES; i++) {
    const t = ease(i / (FRAMES - 1));
    const z = from.z + (to.z - from.z) * t;
    // move the centre in proportion to the change in scale, so the target point zooms in steadily
    const s = (1 - 2 ** -(z - from.z)) / (1 - 2 ** -(to.z - from.z));
    const c = unmerc([m0[0] + (m1[0] - m0[0]) * s, m0[1] + (m1[1] - m0[1]) * s]);
    await p.evaluate(({ c, z }) => new Promise(res => {
      const m = window.__ginkgoMap;
      const done = () => { clearTimeout(timer); res(); };
      const timer = setTimeout(done, 8000);
      m.once('idle', done);
      m.jumpTo({ center: c, zoom: z });
    }), { c, z });
    await p.screenshot({ path: join(OUT, 'fly', `f_${String(i).padStart(3, '0')}.jpg`), type: 'jpeg', quality: 90 });
    if (i % 50 === 0) console.log(`   frame ${i}/${FRAMES}`);
  }
  meta.flyFrames = FRAMES;
  await p.context().close();
}

writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 1));
await browser.close();
console.log('done');
