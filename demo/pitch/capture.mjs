// Ginkgo pitch film, step 1: capture the demo scenes from the running app, frame by frame.
//   npm run dev                                   (in another terminal)
//   SCENES=map,drill,ai node demo/pitch/capture.mjs [outDir]    (default demo/pitch/work/capture)
//
// Every frame is posed (camera, drill clock, route drawn so far) and then
// screenshotted, so motion is smooth however slow the machine is.
//   map    s1  Planning mode: Selangor → Klang and Shah Alam
//   drill  s2  Flood drill: water spreads, look-ahead moves (T+0 → T+2:30)
//          s3  Alert → evacuation route drawn on the map
//          s4  Evacuation centre card while centres fill (T+0:10 → T+3:20)
//          s5  3D Taman Sri Muda: orbit while the water rises
//   ai     s6  Ask Ginkgo: question typed, answer with the figure check
// The AI scene uses a scripted stand-in for the model behind the real
// /api/copilot contract; the tools, map actions and figures are the app's own.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const OUT = process.argv[2] ?? 'demo/pitch/work/capture';
const URL = process.env.GINKGO_URL ?? 'http://localhost:5173/';
const SCENES = (process.env.SCENES ?? 'map,drill,ai').split(',');
const W = 1920, H = 1080, DSF = 1.5;
const metaPath = join(OUT, 'meta.json');
mkdirSync(OUT, { recursive: true });
const meta = existsSync(metaPath) ? JSON.parse(readFileSync(metaPath, 'utf8')) : {};
const save = () => writeFileSync(metaPath, JSON.stringify(meta, null, 1));

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const lerp = (a, b, t) => a + (b - a) * t;

async function open({ mock = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: DSF });
  const p = await ctx.newPage();
  p.on('pageerror', e => console.log('  PAGEERROR', e.message));
  if (mock) await p.route('**/api/copilot', mockAgent(p));
  else await p.route('**/api/copilot', r => r.request().method() === 'GET'
    ? r.fulfill({ json: { enabled: true, model: 'anthropic/claude-opus-5.5', provider: 'openrouter' } })
    : r.fulfill({ status: 503, json: { error: 'off' } }));
  await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await p.waitForSelector('.mode-switch', { timeout: 120000 });
  await p.waitForFunction(() => !document.querySelector('.cc-bottom .status')?.textContent?.includes('loading terrain'), null, { timeout: 60000 });
  // costs would be mocked; keep the cursor out of the way
  await p.addStyleTag({ content: '.usage-line{display:none!important}' });
  await p.mouse.move(W - 4, H - 4);
  await mapIdle(p);
  await sleep(800);
  return p;
}

const mapIdle = p => p.evaluate(() => new Promise(res => {
  const m = window.__ginkgoMap;
  if (!m) return res();
  const t = setTimeout(res, 8000);
  m.once('idle', () => { clearTimeout(t); res(); });
  m.triggerRepaint();
}));
const jump = (p, c, z) => p.evaluate(({ c, z }) => window.__ginkgoMap.jumpTo({ center: c, zoom: z }), { c, z });
const camera = p => p.evaluate(() => { const m = window.__ginkgoMap; const c = m.getCenter(); return { c: [c.lng, c.lat], z: m.getZoom() }; });
const setClock = (p, v) => p.locator('.scrub input[type="range"]').evaluate((el, v) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, Math.round(v));
const box = async (p, loc) => { const b = await loc.boundingBox(); return b && { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
const shot = (p, path) => p.screenshot({ path, type: 'jpeg', quality: 88 });

/** Fly between two views keeping the target point steady (centre moves in Mercator with the scale change). */
function flight(from, to) {
  const merc = ([lon, lat]) => [lon, Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  const unmerc = ([x, y]) => [x, (360 / Math.PI) * Math.atan(Math.exp(y)) - 90];
  const [m0, m1] = [merc(from.c), merc(to.c)];
  return t => {
    const z = lerp(from.z, to.z, t);
    const s = Math.abs(to.z - from.z) < 1e-6 ? t : (1 - 2 ** -(z - from.z)) / (1 - 2 ** -(to.z - from.z));
    return { c: unmerc([lerp(m0[0], m1[0], s), lerp(m0[1], m1[1], s)]), z };
  };
}

async function frames(p, dir, n, pose) {
  mkdirSync(join(OUT, dir), { recursive: true });
  for (let i = 0; i < n; i++) {
    await pose(n === 1 ? 1 : i / (n - 1), i);
    await shot(p, join(OUT, dir, `f_${String(i).padStart(4, '0')}.jpg`));
    if (i % 60 === 0) console.log(`   ${dir} ${i}/${n}`);
  }
  meta[dir] = { ...(meta[dir] ?? {}), frames: n };
  save();
}

// ── scripted stand-in for the model (same request/response contract as the real proxy) ──
function mockAgent(page) {
  let round = 0;
  return async route => {
    const req = route.request();
    if (req.method() === 'GET') return route.fulfill({ json: { enabled: true, model: 'anthropic/claude-opus-5.5', provider: 'openrouter' } });
    const msgs = JSON.parse(req.postData()).messages;
    const last = msgs[msgs.length - 1];
    const results = Array.isArray(last.content) ? last.content.filter(b => b.type === 'tool_result').map(b => JSON.parse(b.content)) : [];
    const reply = (content, stop_reason) => route.fulfill({ json: { id: 'demo', model: 'anthropic/claude-opus-5.5', content, stop_reason, usage: {}, cached: false } });
    round++;
    await sleep(1200);
    if (round === 1) return reply([{ type: 'tool_use', id: 'a', name: 'run_flood_drill', input: { event: 'klang-valley', intensity: null, at_minute: 10 } }], 'tool_use');
    if (round === 2) {
      // let the evacuation plan finish so the route respects centre capacity, as on screen
      await page.waitForFunction(() => [...document.querySelectorAll('.drill-tiles .tile')].some(t => t.textContent.includes('In evacuation centres') && !/…|—/.test(t.querySelector('.value')?.textContent ?? '…')), null, { timeout: 60000 }).catch(() => {});
      await sleep(1500);
      return reply([{ type: 'tool_use', id: 'b', name: 'plan_evacuation_route', input: { latitude: 3.02954, longitude: 101.53446, label: 'Taman Sri Muda', mode: meta.mode ?? 'walk', depart_minute: null } }], 'tool_use');
    }
    const r = results[0];
    const b = r.best;
    const text = b
      ? `In this drill, people in **Taman Sri Muda** should leave by **${r.last_dry_departure}**, before the roads out flood.\n\n` +
        `- Go to **${b.centre.name}** (${b.centre.kind}, ${b.centre.capacity} places): about **${b.minutes} min** ${r.mode === 'walk' ? 'on foot' : 'by car'}, ${b.km} km.\n` +
        `- Main roads: ${b.roads.slice(0, 3).map(x => x.road).join(', ')}.\n\n` +
        `Candidate centre from open data, not the official list. Follow official instructions and call 999 if trapped.`
      : `No dry route was found: ${r.no_route}`;
    return reply([{ type: 'text', text }], 'end_turn');
  };
}

// ── s1: Planning mode, Selangor → Klang and Shah Alam ──
if (SCENES.includes('map')) {
  console.log('s1 · map');
  const p = await open();
  meta.drillBtn = await box(p, p.locator('.mode-switch button', { hasText: 'Flood drill' }));
  meta.chip3d = await box(p, p.locator('.gm-chip.three-d'));
  const from = await camera(p), to = { c: [101.50, 3.06], z: 10.4 };
  const fly = flight(from, to);
  await frames(p, 's1', 300, async t => { const v = fly(ease(t)); await jump(p, v.c, v.z); await mapIdle(p); });
  await p.context().close();
}

// ── s2–s5: the flood drill ──
if (SCENES.includes('drill')) {
  console.log('s2 · drill');
  const p = await open();
  await p.locator('.mode-switch button', { hasText: 'Flood drill' }).click();
  await p.waitForSelector('.drill-panel');
  // wait for the evacuation plan (worker) so centre filling is real
  await p.waitForFunction(() => [...document.querySelectorAll('.drill-tiles .tile')].some(t => t.textContent.includes('In evacuation centres') && !/…|—/.test(t.querySelector('.value')?.textContent ?? '…')), null, { timeout: 90000 });
  await sleep(1500);
  meta.playBtn = await box(p, p.locator('.play-btn'));
  const v0 = { c: [101.49, 3.04], z: 10.15 }, v1 = { c: [101.52, 3.04], z: 10.7 };
  const fly2 = flight(v0, v1);
  await frames(p, 's2', 360, async t => {
    const v = fly2(t);
    await setClock(p, 150 * t);
    await jump(p, v.c, v.z);
    await sleep(40);
    await mapIdle(p);
  });

  console.log('s3 · alert → route');
  await setClock(p, 10);
  await sleep(600);
  const row = p.locator('.alert-row', { hasText: 'Taman Sri Muda' }).first();
  await row.scrollIntoViewIfNeeded();
  await sleep(300);
  await jump(p, v1.c, v1.z);
  await mapIdle(p);
  meta.routeBtn = await box(p, row.locator('.alert-go'));
  meta.alertRow = await box(p, row);
  mkdirSync(join(OUT, 's3'), { recursive: true });
  await shot(p, join(OUT, 's3', 'before.jpg'));
  const c0 = await camera(p);
  // pick the mode: walk unless the walk is very long
  await row.locator('.alert-go').click();
  await sleep(2500);
  const walk = await p.locator('.route-hero').innerText().catch(() => '');
  await p.locator('.seg button', { hasText: 'Drive' }).click();
  await sleep(2500);
  const drive = await p.locator('.route-hero').innerText().catch(() => '');
  console.log('   walk:', walk.replace(/\n/g, ' '), '| drive:', drive.replace(/\n/g, ' '));
  const walkMin = /(\d+) h/.test(walk) ? 60 * Number(walk.match(/(\d+) h/)[1]) : Number((walk.match(/(\d+) min/) ?? [0, 999])[1]);
  meta.mode = walkMin <= 70 ? 'walk' : 'drive';
  await p.locator('.seg button', { hasText: meta.mode === 'walk' ? 'Walk' : 'Drive' }).click();
  await sleep(2500);
  await mapIdle(p);
  const c1 = await camera(p);
  const routes = await p.evaluate(() => window.__ginkgoMap.getSource('routes').getData());
  meta.routeSummary = (await p.locator('.route-hero').innerText()).replace(/\n/g, ' · ');
  meta.leaveBy = await p.locator('.leave-by').innerText().catch(() => '');
  meta.hero = await box(p, p.locator('.route-hero'));
  meta.leaveBox = await box(p, p.locator('.leave-by'));
  meta.steps = await box(p, p.locator('ol.steps'));
  save();
  const chosen = routes.features.find(f => f.properties.chosen === 1);
  const pts = chosen.geometry.coordinates;
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const cut = s => {
    const L = cum[cum.length - 1] * s, out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (cum[i] <= L) { out.push(pts[i]); continue; }
      const u = (L - cum[i - 1]) / (cum[i] - cum[i - 1] || 1);
      out.push([lerp(pts[i - 1][0], pts[i][0], u), lerp(pts[i - 1][1], pts[i][1], u)]);
      break;
    }
    return { type: 'FeatureCollection', features: out.length > 1 ? [{ type: 'Feature', properties: { chosen: 1 }, geometry: { type: 'LineString', coordinates: out } }] : [] };
  };
  const fly3 = flight(c0, c1);
  await frames(p, 's3', 150, async (_t, i) => {
    const tc = Math.min(1, i / 50), tr = Math.max(0, Math.min(1, (i - 50) / 80));
    const v = fly3(ease(tc));
    await jump(p, v.c, v.z);
    await p.evaluate(d => window.__ginkgoMap.getSource('routes').setData(d), i >= 135 ? routes : cut(ease(tr)));
    await mapIdle(p);
  });

  console.log('s4 · centre card');
  await p.locator('.shelter-links button', { hasText: 'Show on map' }).first().click();
  await sleep(1500);
  const card = p.locator('.shelter-card').first();
  await card.scrollIntoViewIfNeeded();
  await sleep(500);
  meta.card = await box(p, card);
  meta.cardName = await card.locator('.shelter-name b').innerText();
  save();
  const v4 = { c: [101.532, 3.045], z: 12.6 };
  await jump(p, v4.c, v4.z);
  await mapIdle(p);
  await frames(p, 's4', 300, async t => {
    await setClock(p, lerp(10, 200, t));
    await jump(p, v4.c, v4.z + 0.25 * t);
    await sleep(40);
    await mapIdle(p);
  });

  console.log('s5 · 3D');
  await setClock(p, 40);
  await p.locator('.gm-chip.three-d').click();
  await p.waitForSelector('.sk-card', { timeout: 180000 });
  await p.addStyleTag({ content: `
    .cc{grid-template-rows:1fr!important}.cc-main{grid-template-columns:1fr!important}
    .cc-top,.cc-bottom,.cc-panel,.sk-tools{display:none!important}` });
  await sleep(4000);
  const start3 = await p.evaluate(() => {
    const s = window.__ginkgo3d;
    const t = s.controls.target, c = s.camera.position;
    return { t: [t.x, t.y, t.z], c: [c.x, c.y, c.z] };
  });
  meta.s5 = start3;
  save();
  await frames(p, 's5', 390, async t => {
    await setClock(p, lerp(40, 270, ease(t)));
    await p.evaluate(({ start, t }) => {
      const s = window.__ginkgo3d;
      const [tx, ty, tz] = start.t, [cx, cy, cz] = start.c;
      const dx = cx - tx, dz = cz - tz;
      const r0 = Math.hypot(dx, dz), a0 = Math.atan2(dz, dx);
      const a = a0 - 0.75 * t, r = r0 * (1 - 0.38 * t), y = cy * (1 - 0.45 * t);
      s.controls.target.set(tx, ty, tz);
      s.camera.position.set(tx + r * Math.cos(a), y, tz + r * Math.sin(a));
      s.controls.update();
    }, { start: start3, t: ease(t) });
    await p.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
  });
  await p.context().close();
}

// ── s6: Ask Ginkgo ──
if (SCENES.includes('ai')) {
  console.log('s6 · AI');
  const p = await open({ mock: true });
  const q = 'Simulate the Klang Valley storm. How do people in Taman Sri Muda get to safety?';
  const input = p.locator('.gm-search input');
  meta.search = await box(p, p.locator('.gm-search'));
  await input.click();
  mkdirSync(join(OUT, 's6'), { recursive: true });
  let k = 0;
  for (let i = 1; i <= q.length; i++) {
    await input.fill(q.slice(0, i));
    if (i % 2 === 0 || i === q.length) await shot(p, join(OUT, 's6', `type_${String(k++).padStart(3, '0')}.jpg`));
  }
  meta.typeFrames = k;
  await p.keyboard.press('Enter');
  await sleep(2500);
  await shot(p, join(OUT, 's6', 'thinking.jpg'));
  await p.waitForSelector('.grounding', { timeout: 120000 });
  await sleep(3000);
  await mapIdle(p);
  await shot(p, join(OUT, 's6', 'answer.jpg'));
  meta.answer = await box(p, p.locator('.msg-bot, .agent-text').last()).catch(() => null);
  meta.grounding = await box(p, p.locator('.grounding').last());
  meta.answerText = await p.locator('.grounding').last().innerText();
  save();
  await p.context().close();
}

save();
await browser.close();
console.log('done', meta);
