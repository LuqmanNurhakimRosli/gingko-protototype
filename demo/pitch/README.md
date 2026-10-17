# Pitch film

The pitch video for URBIEE 2026: about 3:00, 1920×1080, 30 fps. The founder speaks on camera, and the real app plays under his
voice-over. It has motion graphics, original music and sound effects, all made in code. The brief is [`PROMPT.md`](PROMPT.md);
the script is [`docs/VIDEO_SCRIPT.md`](../../docs/VIDEO_SCRIPT.md).

## Pipeline

| Step | File | In → out |
|---|---|---|
| 0 | `transcribe.py` | `recordings/PART {A,B,C}.mp4` → `work/{A,B,C}.json` (faster-whisper `medium.en`, word timestamps; cached) |
| 1 | `edl.py` | transcripts → `work/edl.json` / `edl.md`: clips on the output timeline, caption words with output times, fixes for words Whisper misheard |
| 2 | `capture.mjs` | the running app → `work/capture/s1…s6/` + `meta.json` (element boxes, values shown on screen) |
| 3 | `film.html` | the composition: `renderAt(t)` draws every frame from the edit list and the word timestamps; it also exports the sound cues |
| 4 | `render.mjs` | `film.html` → `work/video.mp4` (and the on-camera frames, `cues.json`, `captions.json`) |
| 5 | `mix.py` | dialogue + original music + synthesised effects → `work/mix.wav` (ducked, two-pass loudnorm to −14 LUFS) |
| 6 | `build.mjs` | all of the above → `out/ginkgo-pitch.mp4`, `.srt`, `preview.mp4`, `contact.jpg`, `CREDITS.md`, `qa.txt` |

Names, the university and the contact line are in `config.json`.

## Run

Needs ffmpeg, Node 20+, Python 3 with `faster-whisper`, `numpy` and `scipy`, and Playwright's Chromium (`npx playwright install chromium`).

```bash
npm run dev                  # in another terminal
SCENES=map npm run pitch:capture      # then SCENES=drill, then SCENES=ai (one group at a time)
npm run pitch:build                    # → demo/pitch/out/ginkgo-pitch.mp4
```

- `STILLS=12,84.5 node demo/pitch/render.mjs` renders full-size stills at those times (`work/stills/`).
- `CUES=1 node demo/pitch/render.mjs` rewrites only the sound cues and captions. Run `python demo/pitch/mix.py` after it to re-mix without re-rendering.
- `SKIP_RENDER=1 npm run pitch:build` re-mixes and re-muxes with the last render.

The capture uses the GPU (ANGLE / Direct3D 11), which is about 4× faster than software WebGL; set `GPU=0` to turn it off.
A frame can still take a few seconds while the map loads tiles.

Recordings, logos from third parties, captured frames, the render and the outputs are git-ignored: `recordings/`, `assets/`, `audio/`, `work/` and `out/`.

## Honesty

- The drill is shown as a simulation, and the end card says it is not a forecast.
- The AI answer is a scripted replay that uses the app's real tools and data. The end card says so.
- Every number on screen comes from `docs/PROGRESS.md` §3 and has a source line.
- The captions follow what was said. Only Whisper's mishearings are fixed, and every fix is listed in `work/edl.md`.
- The music and sound effects are synthesised. No third-party audio is used.
