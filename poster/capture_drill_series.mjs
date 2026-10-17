// Poster data: the flood drill's headline tiles at every half hour, read from the running app.
//   npm run dev                                   (in another terminal)
//   node poster/capture_drill_series.mjs          → poster/data/drill_series.json
// Klang Valley monsoon storm, Extreme 120 mm/hr (the drill's defaults). Values are the tiles' own text,
// so the poster's chart shows exactly what the app shows.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL = process.env.GINKGO_URL ?? 'http://localhost:5173/';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => {
  const m = /^([\d.]+)\s*([KM]?)/.exec(s.trim());
  return m ? Number(m[1]) * ({ K: 1e3, M: 1e6 }[m[2]] ?? 1) : NaN;
};

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
const p = await (await browser.newContext({ viewport: { width: 1600, height: 900 } })).newPage();
await p.route('**/api/copilot', r => r.fulfill({ status: 503, json: {} }));
await p.goto(URL, { waitUntil: 'domcontentloaded', timeout: 120000 });
await p.waitForSelector('.mode-switch', { timeout: 120000 });
await p.locator('.mode-switch button', { hasText: 'Flood drill' }).click();
await p.waitForSelector('.drill-panel');
const tiles = () => p.evaluate(() => Object.fromEntries([...document.querySelectorAll('.drill-tiles .tile')].map(t => [
  t.textContent.replace(t.querySelector('.value')?.textContent ?? '', '').trim().slice(0, 40), t.querySelector('.value')?.textContent ?? ''])));
await p.waitForFunction(() => [...document.querySelectorAll('.drill-tiles .tile')].some(t => t.textContent.includes('In evacuation centres') && !/…|—/.test(t.querySelector('.value')?.textContent ?? '…')), null, { timeout: 90000 });
await sleep(2000);

const setClock = v => p.locator('.scrub input[type="range"]').evaluate((el, v) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v));
  el.dispatchEvent(new Event('input', { bubbles: true }));
}, v);

const rows = [];
for (let t = 0; t <= 300; t += 30) {
  await setClock(t);
  await sleep(2500); // the evacuation plan re-computes in a worker
  const raw = await tiles();
  const pick = key => Object.entries(raw).find(([k]) => k.toLowerCase().includes(key))?.[1] ?? '';
  const row = {
    minute: t,
    clock: await p.locator('.clock').first().innerText().catch(() => ''),
    flooded: num(pick('living in flooded')), within1h: num(pick('flooding within 1')),
    inCentres: num(pick('in evacuation')), noCentre: num(pick('no centre')), raw,
  };
  rows.push(row);
  console.log(t, row.flooded, row.within1h, row.inCentres, row.noCentre);
}
mkdirSync(join(HERE, 'data'), { recursive: true });
writeFileSync(join(HERE, 'data', 'drill_series.json'), JSON.stringify({ event: 'Klang Valley monsoon storm', intensity: 'Extreme 120 mm/hr', rows }, null, 1));
await browser.close();
