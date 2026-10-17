// Ginkgo pitch film, step 4: render demo/pitch/film.html to video, frame by frame.
//   node demo/pitch/render.mjs                 → work/video.mp4 (1920×1080, 30 fps, no sound)
//   CUES=1 node demo/pitch/render.mjs          only write work/cues.json and work/captions.json (for mix.py)
//   STILLS=12.5,40 node demo/pitch/render.mjs  full-size stills at those times → work/stills/
//
// First run extracts the on-camera frames (work/face/<clip>/, 30 fps, from recordings/) for every
// face clip in work/edl.json. Every film frame is window.renderAt(t) then a screenshot, so timing is
// exact however slow the machine is; frames are split across a few pages and encoded in parallel.

import { execFileSync, spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const WORK = join(HERE, 'work');
const FPS = 30, W = 1920, H = 1080;
const WORKERS = Number(process.env.WORKERS ?? 3);

// ── on-camera frames ──
const edl = JSON.parse(readFileSync(join(WORK, 'edl.json'), 'utf8'));
const faceDir = join(WORK, 'face');
const index = existsSync(join(faceDir, 'index.json')) ? JSON.parse(readFileSync(join(faceDir, 'index.json'), 'utf8')) : {};
for (const c of edl.clips.filter(c => c.picture === 'face')) {
  const dir = join(faceDir, c.id), key = `${c.src}:${c.in}-${c.out}`;
  if (index[c.id] && index[`${c.id}#src`] === key) continue;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  console.log(`face frames ${c.id} (PART ${c.src} ${c.in}–${c.out} s)`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-ss', String(c.in), '-i', join(HERE, 'recordings', `PART ${c.src}.mp4`), '-t', (c.out - c.in).toFixed(3),
    '-vf', 'fps=30,scale=1920:1080:flags=lanczos,hqdn3d=1.5:1.5:4:4,unsharp=5:5:0.5', '-q:v', '3', '-start_number', '0', join(dir, 'f_%05d.jpg')]);
  index[c.id] = readdirSync(dir).length;
  index[`${c.id}#src`] = key;
  writeFileSync(join(faceDir, 'index.json'), JSON.stringify(index, null, 1));
}

// ── film server: film.html at /, work files at /w/, logos at /brand/ ──
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
const safe = (base, p) => join(base, normalize(p).replace(/^(\.\.[/\\])+/, ''));
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path === '/' || path === '/film.html' ? join(HERE, 'film.html')
    : path === '/logo.svg' ? join(ROOT, 'public', 'logo.svg')
    : path === '/config.json' ? join(HERE, 'config.json')
    : path.startsWith('/w/') ? safe(WORK, path.slice(3))
    : path.startsWith('/brand/') ? safe(join(HERE, 'assets', 'logos'), path.slice(7)) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const FILM = `http://127.0.0.1:${server.address().port}/film.html`;

const browser = await chromium.launch({ args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] });
async function openFilm() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', m => ['warning', 'error'].includes(m.type()) && console.log('  film:', m.text()));
  page.on('pageerror', e => console.log('  FILM ERROR', e.message));
  await page.goto(FILM);
  await page.evaluate(() => window.filmReady);
  return page;
}
const frameAt = async (page, t, opts) => {
  await page.evaluate(t => window.renderAt(t), t);
  return page.screenshot({ type: 'jpeg', quality: 93, ...opts });
};

const probe = await openFilm();
const film = await probe.evaluate(() => ({ cues: window.CUES, captions: window.CAPTIONS, duration: window.FILM_DURATION }));
writeFileSync(join(WORK, 'cues.json'), JSON.stringify(film.cues, null, 1));
writeFileSync(join(WORK, 'captions.json'), JSON.stringify(film.captions, null, 1));
console.log(`cues ${film.cues.cues.length} · captions ${film.captions.length} · film ${film.duration.toFixed(2)} s`);

if (process.env.STILLS) {
  const dir = join(WORK, 'stills');
  mkdirSync(dir, { recursive: true });
  for (const t of process.env.STILLS.split(',').map(Number)) await frameAt(probe, t, { path: join(dir, `t_${t.toFixed(2)}.jpg`) });
  console.log(`stills → ${dir}`);
} else if (!process.env.CUES) {
  const total = Math.round(film.duration * FPS);
  const per = Math.ceil(total / WORKERS);
  const out = join(WORK, 'video.mp4');
  const segs = [];
  let done = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    const seg = join(WORK, `video.part${w}.mp4`);
    segs[w] = seg;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      // screenshots are full-range JPEG: convert to TV-range yuv420p so every player shows the same colours
      '-vf', 'scale=in_range=pc:out_range=tv,format=yuv420p', '-color_range', 'tv',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-profile:v', 'high', '-r', String(FPS), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
    const page = await openFilm();
    for (let i = a; i < b; i++) {
      const jpg = await frameAt(page, i / FPS);
      if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
      if (++done % 300 === 0) console.log(`  ${done}/${total} frames · ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
    await page.close();
  }));
  const list = join(WORK, 'video.parts.txt');
  writeFileSync(list, segs.map(s => `file '${s.replace(/\\/g, '/')}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', out]);
  for (const s of [...segs, list]) rmSync(s, { force: true });
  console.log(`${out} · ${total} frames · ${((Date.now() - started) / 1000).toFixed(0)} s`);
}

await browser.close();
server.close();
