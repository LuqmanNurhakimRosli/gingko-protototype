// Ginkgo demo film, step 2: render demo/film.html to an MP4, frame by frame.
//   node demo/render.mjs [assetsDir=demo/assets] [out=demo/ginkgo-demo.mp4]
//   PREVIEW=1 node demo/render.mjs [assetsDir]        contact sheets, one frame per second
//   PREVIEW=12.5,40 node demo/render.mjs [assetsDir]  full-size stills at those times
//
// Every frame is window.renderAt(t) followed by a screenshot, so the timing is
// exact however slow the machine is. Frames are split across a few browser pages
// and encoded in parallel, then the segments are joined without re-encoding.

import { spawn, execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(process.argv[2] ?? join(HERE, 'assets'));
const OUT = resolve(process.argv[3] ?? join(HERE, 'ginkgo-demo.mp4'));
const FPS = 30, W = 1920, H = 1080;
const WORKERS = Number(process.env.WORKERS ?? 3);
const PREVIEW = process.env.PREVIEW;

// film.html at /, captured footage at /assets/
const TYPES = { '.html': 'text/html', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg' };
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path === '/' || path === '/film.html' ? join(HERE, 'film.html')
    : path.startsWith('/assets/') ? join(ASSETS, normalize(path.slice(8)).replace(/^(\.\.[/\\])+/, '')) : null;
  if (!file || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
  createReadStream(file).pipe(res);
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const FILM = `http://127.0.0.1:${server.address().port}/film.html`;

const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
async function openFilm() {
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  page.on('console', m => m.type() === 'warning' && console.log('  film:', m.text()));
  page.on('pageerror', e => console.log('  FILM ERROR', e.message));
  await page.goto(FILM);
  await page.evaluate(() => window.filmReady);
  return page;
}
const frameAt = async (page, t, opts) => {
  await page.evaluate(t => window.renderAt(t), t);
  return page.screenshot({ type: 'jpeg', quality: 92, ...opts });
};

if (PREVIEW) {
  const dir = join(dirname(OUT), 'preview');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const page = await openFilm();
  const duration = await page.evaluate(() => window.FILM_DURATION);
  if (PREVIEW === '1') {
    const times = Array.from({ length: Math.floor(duration) + 1 }, (_, i) => Math.min(i, duration - 0.01));
    for (const [i, t] of times.entries()) await frameAt(page, t, { path: join(dir, `p_${String(i).padStart(3, '0')}.jpg`) });
    // 4×4 sheets of 480×270 thumbnails, 16 seconds per sheet
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', '1', '-i', join(dir, 'p_%03d.jpg'),
      '-vf', "scale=480:270,drawtext=text='%{n}s':x=8:y=8:fontsize=26:fontcolor=white:box=1:boxcolor=black@0.6,tile=4x4",
      join(dir, 'sheet_%02d.jpg')]);
  } else {
    for (const t of PREVIEW.split(',').map(Number)) await frameAt(page, t, { path: join(dir, `t_${t.toFixed(2)}.jpg`) });
  }
  console.log(`preview → ${dir} (film ${duration.toFixed(1)} s)`);
} else {
  const probe = await openFilm();
  const duration = await probe.evaluate(() => window.FILM_DURATION);
  await probe.close();
  const total = Math.round(duration * FPS);
  const per = Math.ceil(total / WORKERS);
  const segs = [];
  let done = 0;
  const started = Date.now();
  await Promise.all(Array.from({ length: WORKERS }, async (_, w) => {
    const a = w * per, b = Math.min(total, a + per);
    const seg = `${OUT}.part${w}.mp4`;
    segs[w] = seg;
    const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p', '-r', String(FPS), seg], { stdio: ['pipe', 'inherit', 'inherit'] });
    const closed = new Promise((res, rej) => ff.on('close', c => (c === 0 ? res() : rej(new Error(`ffmpeg exited ${c}`)))));
    const page = await openFilm();
    for (let i = a; i < b; i++) {
      const jpg = await frameAt(page, i / FPS);
      if (!ff.stdin.write(jpg)) await new Promise(r => ff.stdin.once('drain', r));
      if (++done % 150 === 0) console.log(`  ${done}/${total} frames · ${((Date.now() - started) / 1000).toFixed(0)} s`);
    }
    ff.stdin.end();
    await closed;
    await page.close();
  }));
  const list = `${OUT}.parts.txt`;
  writeFileSync(list, segs.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n'));
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c', 'copy', '-movflags', '+faststart', OUT]);
  for (const s of [...segs, list]) rmSync(s, { force: true });
  console.log(`${OUT} · ${total} frames · ${duration.toFixed(1)} s`);
}

await browser.close();
server.close();
