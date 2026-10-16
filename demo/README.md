# Demo film

A 2-minute silent demo of Ginkgo (1920×1080, 30 fps, on-screen captions, no voice).
The finished film is [`docs/demo/ginkgo-demo.mp4`](../docs/demo/ginkgo-demo.mp4).

| Time | Chapter | What it shows |
|---|---|---|
| 0:00 | Intro | Logo, tagline |
| 0:06 | Data | The question, three headline figures, the Input → Process → Output workflow, the flood-score formula |
| 0:35 | Map | Fly-in from all of Selangor to the Klang river at street level, on the live map |
| 0:47 | Scenarios | Normal → Heavy → Extreme rain, High land 24.1% → 30.4% → 36.3% |
| 0:55 | Analyse | Facilities in High cells (Klang), drawing an area, the instant report |
| 1:11 | Ask AI | A question typed in the search box, the agent loop, the AI's map actions and candidate sites, the AI brief and PDF |
| 1:45 | Trust | Susceptibility not forecast, validation, figure checks, efficiency, any model, offline |
| 1:53 | Outro | Tagline, data credits |

## How it is made

Two steps, both scripted with Playwright, so the film can be rebuilt after the app changes.

1. **`capture.mjs`** drives the running app at 1920×1080 and saves real footage:
   screenshots of each workflow step, typing frames for the AI question, the PDF brief,
   and a 300-frame fly-in rendered map frame by map frame (each frame waits for the tiles).
2. **`film.html`** is the motion-graphics composition. Every frame is a pure function of
   time, `window.renderAt(t)`, which places the footage inside a browser frame, moves a
   camera over it and animates the diagrams and captions.
   **`render.mjs`** screenshots it frame by frame and encodes H.264 with ffmpeg.

The AI scenes use a scripted stand-in for the model behind the real `/api/copilot` contract
(same request and reply shape). The tool calls, map actions, candidate sites, grounding
checks and every figure are the app's own. The end credits say so.

## Rebuild

Needs ffmpeg and pdftoppm (poppler-utils) on the PATH.

```bash
npm install
npx playwright install chromium   # or set CHROME=/path/to/chrome
npm run dev                       # in another terminal

npm run demo:capture              # → demo/assets/        (a few minutes)
PREVIEW=1 npm run demo:render     # → demo/preview/       contact sheets, one frame per second
npm run demo:render               # → demo/ginkgo-demo.mp4 (~5 min)
```

`PARTS=C npm run demo:capture` re-captures one part only (A overview and analysis, B AI question, C fly-in).
`PREVIEW=40,92.5 npm run demo:render` renders full-size stills at those times.
