# Pitch video: prompt for Claude Code (run locally)

The pitch video is edited on your laptop, where the recordings are. This file is the full brief for Claude Code.

**Before you start**

1. `git pull` on `main`, then `npm install`.
2. Put your three recordings in `demo/pitch/recordings/` with these exact names:
   `PART A.mp4` (on camera, A1–A5), `PART B.mp4` (the demo part, B1–B6) and `PART C.mp4` (the ask).
3. Optional: put a music track you are allowed to use in `demo/pitch/audio/music.mp3` (or `.wav`), with its
   licence or credit line in `demo/pitch/audio/music.txt`. Put any sound effects you like in `demo/pitch/audio/sfx/`.
4. Open Claude Code in the repo folder and say: **"Read demo/pitch/PROMPT.md and make the video."**
   Or paste everything below the line.

`recordings/`, `audio/`, `work/` and `out/` are git-ignored. Videos and music never go into the repo.

---

You are the editor, motion designer and sound designer for **Ginkgo's pitch video**. Ginkgo is a flood command center for
Selangor, Malaysia. The founder is a student pitching to urban experts in the style of *Shark Tank*. Make a polished, honest,
**under-4-minute** film (aim for 3:00–3:30) from the founder's recordings and the real app. It needs:
- motion graphics;
- sound effects (clicks, typing, whooshes, pops, alerts);
- music.

## 0. Read first

- `docs/VIDEO_SCRIPT.md`: the director's script, run of show, on-screen text and director's notes. This is the plan.
- `docs/PROGRESS.md` §3: the **only** numbers allowed on screen.
- `docs/SYSTEM_GUIDE.md`: what each part of the app does, so labels and callouts are correct.
- `docs/REFERENCES.md`: sources for Japan and Singapore and for the December 2021 figures.
- `demo/film.html` and `demo/render.mjs`: the earlier film's pattern. Every frame is a pure function `renderAt(t)`, screenshotted by
  Playwright and encoded by ffmpeg. Reuse this approach.
- `demo/pitch/capture.mjs`: captures the demo scenes from the running app frame by frame and writes element boxes to `meta.json`.
  It has **not been run yet**, so expect to fix selectors or timings.
- `public/logo.svg`; the brand tokens in `src/index.css` and `src/drill.css`.

## 1. Check the tools and the inputs

- Check that these are present: ffmpeg and ffprobe, Node 20+, the Playwright Chromium browser (`npx playwright install chromium`),
  and Python 3 with `faster-whisper` (or whisper.cpp).
- Detect my OS and give me the install commands for anything missing. **Ask before installing system packages.**
- `ffprobe` each recording and report:
  - duration, resolution, fps, rotation and audio streams;
  - whether `PART B.mp4` shows my face, a screen recording, or is effectively audio only.
- Run `npm test` (69 tests should pass). Then run `npm run dev` in the background.

## 2. Transcribe, pick the best takes, build the edit list

- Extract each recording's audio to 48 kHz WAV in `demo/pitch/work/`.
- Transcribe with **word timestamps** (faster-whisper `medium.en` or `small.en`, VAD on). Save JSON and SRT.
- Match the speech to the script lines A1–A5, B1–B6 and C.
  - I may have done several takes, or changed some words. **Keep my actual words.** Captions follow what I said, not the script.
  - Never re-order words within a sentence.
- For each line, choose the best take: complete, clear, fewest stumbles, best energy.
  - Remove false starts, "um" and "uh", and dead air.
  - Shorten pauses longer than 0.6 s to about 0.3 s.
  - Keep the deliberate pause after each number.
- Write `demo/pitch/work/edl.md`. It needs a table (segment, source file, in, out, words, length) and a run-of-show total.
- **Stop. Show me the edit list and the total length, and wait for my "go".**
  - If the total is over 3:50, first propose which pauses or lines to cut.
  - If my name, programme, university or contact line is not clear from the audio, ask me for the exact spelling.

## 3. Demo footage: real app, real UI

- Run `SCENES=map node demo/pitch/capture.mjs`, then `drill`, then `ai`. Output goes to `demo/pitch/work/capture/`.
- Run one group at a time. Open a few frames from each scene to check them. Fix the script if a selector, wait or pose is wrong.
- Fix the app itself **only** for a real bug. Any app fix goes in a separate commit, with `npm test` and `npm run lint` passing.
- Scenes:

  | Scene | Covers | Shows |
  |---|---|---|
  | s1 | B1 | Map fly-in to Klang and Shah Alam |
  | s2 | B2 | Drill water spreading, with the 1-hour look-ahead |
  | s3 | B3 | Alert, then the route drawing on |
  | s4 | B4 | Evacuation centre card filling up |
  | s5 | B5, A1 cold open | 3D Taman Sri Muda with water rising |
  | s6 | B6 | Ask Ginkgo: question typed, answer with "✓ All figures match" |

- s6 uses a scripted stand-in for the model behind the real `/api/copilot` contract. The tools, map actions and figures are the app's
  own. Say so in the end credits: *"AI answer shown is a scripted replay using the app's real tools and data."*
  If `.env` has a working AI key and I ask for it, capture a live answer instead.
- If `PART B.mp4` already contains a usable screen recording, compare it with the captured frames. Use whichever looks cleaner,
  per scene.
- Fit each scene to its voice-over by changing the picture: hold frames, trim, or ease the speed (0.8×–1.25×).
  **Never stretch or pitch the voice.**

## 4. Motion graphics

- Build `demo/pitch/film.html` (the composition) and `demo/pitch/render.mjs` (frame-by-frame render plus ffmpeg encode).
- Output: 1920×1080, 30 fps.
- Suggested structure:
  - The demo section is rendered fully by the HTML: footage, browser frame, camera moves, cursor and overlays.
  - On-camera sections use the trimmed face video as the base. Graphics are rendered as a **transparent** layer
    (`omitBackground: true`, PNG sequence or qtrle/ProRes 4444) and overlaid with ffmpeg.
- **Sync every graphic to the transcript word timestamps.** A number pops on the word, not near it.
- Look:
  - Font: Inter 400/600/800.
  - Colours: green `#08A045`, water blue `#3884EC`, paper `#F3F0E8`, text `#111111`.
  - Alert colours (Japan's Kikikuru): Level 5 `#0C000C`, Level 4 "evacuate" purple `#AA00AA`, Level 3 red `#FF2800`, Level 2 yellow `#F2E700`.
- Motion: ease-out cubic, 8–14 frames in and 6–10 out. Small overshoot on pops. At most three transition styles.
  Calm and premium, not flashy.

Graphics to build:

1. **Cold open (A1)**
   - Picture: 3D Sri Muda (s5) with water rising.
   - Text types on: *"December 2021 · Taman Sri Muda"*.
   - Small line, bottom-left: *"Simulation of a December-2021-style storm"*.
   - Fade from black. Rain sound.
2. **Logo sting into A2.** The ginkgo leaf from `public/logo.svg` draws on (stroke, then fill), then shrinks to the top-right corner
   and stays there, small, during the on-camera parts.
3. **Lower third (A2):** *[Name] · Founder, Ginkgo · [University]*, with a green bar sliding in from the left. Hold 4 s.
4. **Problem callouts (A3), right third of the frame**
   - Number chips "1 / 2 / 3" for the three problems.
   - Count-up numbers, each with a small source line:
     - **24.1%** of land High susceptibility (*Ginkgo analysis, Normal rain*)
     - **~1.9 million** people in High cells (*estimate: Census 2020 × Meta HRSL*)
     - **15,404 people in 83 centres**, 26 Dec 2021 (*news reports*)
   - Keep my face clear on the left third. If my framing differs, adapt.
5. **Japan · Singapore card (A4), 3 s, two columns**
   - *Japan: 5 alert levels · live shelter crowding*
   - *Singapore: 1,000+ water sensors · SMS alerts*
   - Use only claims backed by `docs/REFERENCES.md`.
6. **Map · Drill · Guide (A5).** Three icons slide in, each on its spoken word. Then "Let me show you" goes into a push-in through
   a laptop or browser frame into the demo.
7. **Demo layer (B1–B6)**
   - A clean browser frame around the app.
   - A smooth cursor on eased bezier paths to the real element boxes in `meta.json`.
   - A **click ripple** (green ring) on every click.
   - Gentle punch-in zooms (1.0 → 1.4–1.8×) on the area being explained.
   - Highlight rings and short labels, at most about 4 words:
     - *"Purple = floods within 1 hour"*
     - *"Roads that stay dry"*
     - *"Leave by T+0:35"*
     - *"Full at …"*
     - *"≈2 m at the door"*
     - *"✓ Every figure checked"*
   - A **Level 4 alert chip** pops in purple at the alert moment.
   - A **chapter bar** along the bottom: Map · Drill · Route · Shelter · 3D · AI, with a progress fill.
   - Values on labels (leave-by time, depth, "full at") must match what is on screen in the captured frames.
     Read them from the frames or the DOM. Don't type them from memory.
8. **Captions throughout**, burned in.
   - At most 2 lines and about 42 characters per line.
   - Inter 600, white on a soft dark rounded band, bottom centre.
   - Move them up when they would cover the lower third or the chapter bar.
   - Also export `ginkgo-pitch.srt`.
9. **End card (C, last 4 s)**
   - Logo, then *"See the risk. Plan around it."*
   - My name and contact.
   - Small print: *"Flood drill shown is a simulation, not a forecast. Data: Copernicus, OpenStreetMap/Overture, JRC, ESA,
     Meta HRSL, DOSM."*
   - Music and sound credits, and the AI disclosure line.

## 5. Sound design

**Dialogue (first priority, always clear)**
- Processing chain:
  - high-pass at 80 Hz;
  - light noise reduction (`afftdn`, or `arnndn` if a model is available);
  - gentle EQ presence;
  - `acompressor` at about 3:1;
  - de-ess if needed.
- Match the levels of parts A, B and C.
- Put a 10–20 ms crossfade on every audio cut, so there are no clicks.
- Fill gaps with room tone taken from my own silent moments.

**Music (licensed or original only)**
1. Use `demo/pitch/audio/music.*` if I provided it, and credit it from `music.txt`.
2. If I didn't, **compose an original bed in code**. For example, render offline with numpy or Tone.js:
   - 92–100 BPM, warm and hopeful;
   - soft pad chords, a light plucked arpeggio, soft kick and shaker;
   - stems or sections so it can follow the edit.
3. Never download music whose licence you can't confirm.
- Arc of the music:
  - near silence with rain under the cold open;
  - pad comes in on the logo sting;
  - builds under A3;
  - a riser into "Let me show you", landing on the first demo frame;
  - steady groove under the demo;
  - drops under C;
  - resolves on the end card.
- **Ducking:** `sidechaincompress` keyed by dialogue (ratio about 8, attack 20 ms, release 400 ms). Music sits about 20 dB under
  speech and comes up in gaps and transitions.

**Sound effects**
- Sources:
  - CC0 only: Kenney "UI Audio" and "Interface Sounds", Freesound with the CC0 filter;
  - or synthesise them with ffmpeg, sox or numpy.
  - Log every file's source and licence in `demo/pitch/out/CREDITS.md`.
- Cues:
  - **mouse click** on every cursor click, on the exact ripple frame;
  - **soft keyboard typing**, one randomised key per typed character in the AI question;
  - **whoosh** on transitions, card slide-ins and the map fly-in;
  - **pop or tick** on each callout, icon and label; light ticks during count-ups;
  - **two-tone alert chime** when the Level 4 alert appears. Make it gentle; not a real emergency-alert tone;
  - **rain ambience** under the cold open, and a low **water rumble** under the rising water in 3D;
  - **success chime** on "✓ All figures match";
  - **riser and soft impact** into the demo;
  - **logo sting** on the end card.
- Keep effects sparse and under the voice. An effect never covers a spoken word.
- Generate every cue from one list, `demo/pitch/work/cues.json` (time, file, gain), derived from the motion timeline.
  Re-renders then stay in sync.

**Master**
- Two-pass `loudnorm`: **−14 LUFS** integrated, true peak **≤ −1 dBTP**, LRA ≤ 11.
- 48 kHz stereo, AAC 192 kbps or higher.

## 6. Preview, notes, final

- Make it reproducible: one command, `npm run pitch:build`, runs transcribe (cached) → render → mix → mux.
  Add the script to `package.json`.
- **Preview first.** Make a 960×540 `demo/pitch/out/preview.mp4` and a contact sheet, `out/contact.jpg` (one frame every 2 s).
  Show me both and **wait for my notes**.
- **Final:**
  - `demo/pitch/out/ginkgo-pitch.mp4`: 1920×1080, 30 fps, H.264 High, CRF 18–20, `yuv420p`, `+faststart`, AAC 48 kHz.
  - Plus `ginkgo-pitch.srt` and `CREDITS.md`.
- **QA, then report the results:**
  - Duration **under 4:00**, checked with ffprobe.
  - Loudness −14 ±1 LUFS and true peak ≤ −1 dBTP, checked with the `ebur128` filter.
  - No unintended black or frozen frames, checked with `blackdetect` and `freezedetect`.
  - Lip sync correct at every face cut. Captions within 100 ms of the speech.
  - No clicks or pops at audio cuts.
  - Every number matches `docs/PROGRESS.md` §3 and has a source line.
  - Names are spelled as I gave them.
  - The words "drill" or "simulation" are used, never "forecast" or "prediction".
  - Credits are complete.
  - Watch it once at 1× and list anything you would still fix, with timestamps.

## Rules

- **Honesty:**
  - No stock or news footage of real floods.
  - No unlicensed music or sound.
  - No AI-generated faces or voices.
  - Never change what I said, only cut it.
- **Git:**
  - Commit only scripts, HTML and docs. Never commit recordings, music, frames or renders.
  - Ask me before pushing.
  - Update `docs/PROGRESS.md` (the video row and a milestone) when the final is done.
- **When to ask:** if anything is ambiguous (spelling, music choice, a cut over 4:00, a missing take), ask instead of guessing.
