// Ginkgo pitch film: the whole build, one command.
//   npm run pitch:build
// transcribe (cached) → edit list → render → soundtrack → mux, then subtitles, preview, contact sheet,
// credits and a QA report in demo/pitch/out/. Capture the app footage first (npm run pitch:capture,
// with npm run dev running); it only needs redoing when the app changes.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORK = join(HERE, 'work'), OUT = join(HERE, 'out');
const PY = process.env.PYTHON ?? 'python';
mkdirSync(OUT, { recursive: true });
const run = (cmd, args, env = {}) => {
  console.log(`\n▶ ${cmd} ${args.join(' ')}`);
  execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...env } });
};
const ff = (...args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

run(PY, [join(HERE, 'transcribe.py')]);
run(PY, [join(HERE, 'edl.py')]);
if (!process.env.SKIP_RENDER) run('node', [join(HERE, 'render.mjs')]);
run(PY, [join(HERE, 'mix.py')]);

const film = join(OUT, 'ginkgo-pitch.mp4');
console.log('\n▶ mux');
ff('-i', join(WORK, 'video.mp4'), '-i', join(WORK, 'mix.wav'), '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
  '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-shortest', '-movflags', '+faststart', film);

// subtitles
const stamp = s => { const ms = Math.round(s * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`; };
const caps = JSON.parse(readFileSync(join(WORK, 'captions.json'), 'utf8'));
writeFileSync(join(OUT, 'ginkgo-pitch.srt'), caps.map((c, i) => `${i + 1}\n${stamp(c.s)} --> ${stamp(c.e)}\n${c.text}\n`).join('\n'));

// preview and contact sheet (one frame every 2 s)
ff('-i', film, '-vf', 'scale=960:540', '-c:v', 'libx264', '-crf', '26', '-preset', 'fast', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', join(OUT, 'preview.mp4'));
// 6 per row = 12 s per row (no drawtext: it crashes ffmpeg on Windows without a fontconfig setup)
ff('-i', film, '-vf', 'fps=1/2,scale=320:180,tile=6x15:padding=4:color=white', '-frames:v', '1', join(OUT, 'contact.jpg'));

writeFileSync(join(OUT, 'CREDITS.md'), `# Ginkgo pitch film: credits

- **Founder, voice and on-camera:** recorded by the founder (demo/pitch/recordings/).
- **App footage:** the Ginkgo app itself, captured frame by frame (demo/pitch/capture.mjs). The flood drill is a simulation, not a forecast.
- **AI answer:** a scripted replay using the app's real tools, map actions and data (same request and reply shape as /api/copilot).
- **Music:** original, composed in code for this film (demo/pitch/mix.py): 96 BPM, D major. No samples, no third-party audio.
- **Sound effects:** all synthesised in code (demo/pitch/mix.py): clicks, keys, whooshes, pops, chimes, riser, impact, rain, water rumble.
- **Logos:** Ginkgo (public/logo.svg); UiTM and URBIEE 2026 logos supplied by the founder for the competition entry (not in the repo).
- **Data shown:** Copernicus GLO-30 DEM, OpenStreetMap / Overture Maps, JRC Global Surface Water, ESA WorldCover 2021, Meta HRSL, DOSM Census 2020.
- **Figures on screen:** docs/PROGRESS.md §3; Japan and Singapore claims: docs/REFERENCES.md.
`);

// QA
console.log('\n▶ QA');
const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate,sample_rate,profile,pix_fmt', '-of', 'json', film]));
const dur = +probe.format.duration;
const r128 = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', film, '-af', 'ebur128=peak=true', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const summary = r128.slice(r128.lastIndexOf('Summary:'));
const pick = re => (summary.match(re) ?? [])[1];
const det = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', film, '-vf', 'blackdetect=d=0.4:pix_th=0.08,freezedetect=n=-55dB:d=2.5', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
const blacks = [...det.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map(m => `${(+m[1]).toFixed(1)}–${(+m[2]).toFixed(1)} s`);
const freezes = [...det.matchAll(/freeze_start: ([\d.]+)[\s\S]*?freeze_end: ([\d.]+)/g)].map(m => `${(+m[1]).toFixed(1)}–${(+m[2]).toFixed(1)} s`);
const v = probe.streams.find(s => s.width), a = probe.streams.find(s => s.sample_rate);
const qa = [
  `Duration: ${Math.floor(dur / 60)}:${(dur % 60).toFixed(1).padStart(4, '0')} (${dur < 240 ? 'OK, under 4:00' : 'OVER 4:00'})`,
  `Video: ${v.codec_name} ${v.profile} ${v.width}×${v.height} ${v.r_frame_rate} ${v.pix_fmt} · Audio: ${a.codec_name} ${a.sample_rate} Hz`,
  `Loudness: ${pick(/I:\s+(-?[\d.]+) LUFS/)} LUFS integrated (target −14 ±1) · true peak ${pick(/Peak:\s+(-?[\d.]+) dBFS/)} dBTP (≤ −1) · LRA ${pick(/LRA:\s+(-?[\d.]+) LU/)} LU`,
  `Black stretches ≥0.4 s: ${blacks.join(', ') || 'none'} (fade in at 0 s and out at the end are intended)`,
  `Frozen stretches ≥2.5 s: ${freezes.join(', ') || 'none'}`,
];
writeFileSync(join(OUT, 'qa.txt'), qa.join('\n') + '\n');
console.log(qa.join('\n'));
console.log(`\n✓ ${film}`);
