# Ginkgo — end-to-end architecture

Ginkgo is a flood-susceptibility command center for Selangor. It has three parts:

1. **An offline data pipeline** (Python, `pipeline/`) that turns open satellite, terrain, map and census data into small precomputed files, plus a self-hosted vector basemap.
2. **A static web app** (React + MapLibre GL, `src/`) that shows those files on a Google-Maps-style map and computes statistics for any area the user draws.
3. **An AI copilot** (Claude, behind a small server function) that answers questions by calling tools over the same computed data, operates the map, screens candidate sites and drafts briefs — and never produces a number itself.

Every workflow is laid out as Input → Process → Output in [`WORKFLOW_BLUEPRINT.md`](WORKFLOW_BLUEPRINT.md).

```mermaid
flowchart LR
  subgraph A["① Offline pipeline (once, ~5 min)"]
    direction TB
    S1[Copernicus GLO-30 DEM] --> P2
    S2[OpenStreetMap via Overture:<br/>rivers, boundaries, places, rail] --> P1
    S3[JRC Global Surface Water] --> P2
    S4[ESA WorldCover 2021] --> P2
    S5[Meta HRSL + DOSM Census 2020] --> P2
    P1[01 vectors · 01b sites] --> P2[02 rasters<br/>slope · D8 flow · HAND]
    P2 --> P3[03 model<br/>score · scenarios · stats · validation]
    P3 --> P4[04 facilities & rail<br/>class per facility]
    S2 --> P5[05 basemap<br/>vector tiles → PMTiles]
  end
  A -->|public/data/*, public/basemap/*| B
  subgraph B["② Static web app (browser)"]
    direction TB
    M[MapLibre map: Google-style basemap,<br/>layers, chips, draw, search, locate] --> AN[analysis.ts<br/>clip grid to polygon, count cells, screen sites]
    AN --> UI[Panels · report · PDF/GeoJSON]
    T[Copilot tools<br/>agentTools.ts] --> AN
  end
  B <-->|POST /api/copilot<br/>history + tool results| C
  subgraph C["③ Copilot proxy (Cloudflare Pages Function)"]
    F[server/copilot.ts<br/>fixed system prompt + tools + model] <--> CL[(OpenRouter<br/>or Claude API)]
    F <--> KV[(shared reply cache<br/>KV / edge cache)]
  end
```

## ① Offline pipeline

| Step | Input | Output |
|---|---|---|
| `01_vectors.py` | Overture divisions + water (range-read from S3) | 9 daerah boundaries (KL/Putrajaya excluded), rivers, 1,573-name gazetteer |
| `01b_sites.py` | Dec-2021 flood reports (sources in file) + Overture names | validation sites with coordinates matched to map names |
| `02_rasters.py` | DEM, JRC GSW, WorldCover, HRSL | one 3″ (~92 m) grid: elevation, slope, D8 flow accumulation, **HAND**, river distance, water history, land cover, population |
| `03_model.py` | the grid + DOSM totals | Stage 1 score, 3 scenarios, per-daerah stats, validation results, the client grid |
| `04_facilities.py` | Overture places + rail segments | 2,955 hospitals, clinics, schools, police, Bomba and rail stations (each tagged with its cell's score); operational rail lines |
| `05_basemap.py` + `tiles.mjs` | Overture land cover, land use, water, airports, 549,043 road segments, place points | 5,725 vector tiles (z5–14) in one 23 MB PMTiles archive, Noto Sans label glyphs |

Heavy work happens here, once. The app never fetches a DEM or calls Overpass on a click.

## ② Web app

- **Map** (`MapView.tsx`, `src/map/style.ts`, `MapChrome.tsx`): MapLibre GL over the bundled Selangor vector tiles, styled like Google Maps (mint vegetation, grey built-up land, blue water, white streets with soft casings, yellow expressways, route shields, quiet labels). The flood layer is an image layer inserted *under* streets and labels, resampled to Web Mercator rows and smoothed. Basemaps: Default, Light, Plain, and **Google Map / Satellite** (optional, below). The map has a floating search bar that also takes questions for Ginkgo, quick chips, a layers panel, locate-me and reset buttons, and keeps its position in the URL (`#map=zoom/lat/lon`). On phones it switches to a full-screen map with a bottom sheet.
- **Analysis** (`src/data/analysis.ts`): a drawn polygon is rasterised onto the grid and its cells are counted. That gives class areas, zones, people, built-up share, river length, terrain inputs, the "why this score" breakdown, candidate land and the facilities inside. `findCandidateSites` groups screened land into contiguous blocks. Tests check this code reproduces the pipeline's numbers exactly.
- **Exports**: PDF planning brief (with the AI-drafted summary when there is one) and GeoJSON for any drawn area.

## ③ AI copilot — what model, where, and why

The copilot runs on **OpenRouter** (`OPENROUTER_API_KEY`) or the **Claude API** directly (`ANTHROPIC_API_KEY`); see *Setting up the APIs* below. The table below describes the direct Claude API settings; on OpenRouter the model is `OPENROUTER_MODEL` and the cost per answer is the one OpenRouter reports.

### Where AI is (and isn't) in Ginkgo

| Part | Technique | Machine learning? | Produces the numbers? |
|---|---|---|---|
| Land cover (built-up, trees, crops, water) | ESA WorldCover 2021: a classifier trained on Sentinel-1/2 imagery | **Yes**, upstream | Yes (input) |
| Population distribution | Meta HRSL: building detection on satellite imagery | **Yes**, upstream | Yes (input) |
| Surface-water history | JRC GSW: expert-system classification of 38 years of Landsat | Rule-based | Yes (input) |
| Drainage, HAND, slope | D8 flow routing on the DEM | No (hydrology algorithms) | Yes |
| **Susceptibility score** | Stage 1 weighted overlay, illustrative weights | No | **Yes — the only scorer** |
| Stage 2 (planned) | Random forest / gradient boosting on JPS/DID flood extents, split by event or sub-catchment | Yes | Would replace Stage 1 |
| Candidate-site screen | Rule-based filter + connected blocks | No | Yes |
| **Copilot** | **Claude (LLM) with tool use** | Yes | **No** — it reads tool results, operates the map and explains |

Be accurate about this when you pitch it. The flood score is GIS plus a transparent formula, not an AI prediction, and the copilot is an explainer that's forced to use the computed data.

### The model

| Setting | Value | Why |
|---|---|---|
| Model | `claude-opus-5-5` (Claude Opus 5.5) | Anthropic's current default model: strong tool use and careful with numbers. $4 / $20 per million input / output tokens. |
| Cheaper options | `COPILOT_MODEL=claude-sonnet-5-5` ($2 / $10) or `claude-haiku-5-5` ($0.10 / $0.50) | One environment variable, no code change. Haiku has no server-side refusal fallback. |
| Effort | `medium` (`COPILOT_EFFORT` = low · medium · high · xhigh · max) | Enough for 2–4 tool calls per question. `low` is faster and cheaper for chat. |
| Thinking | adaptive (always on for Opus 5.5) | Control it with effort instead. |
| Refusal fallback | `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`) | If a safety classifier declines a turn, the API retries it on Anthropic's recommended fallback model. |
| Conversation check | `prefix_mismatch_behavior: "drop_block"` (beta `thinking-binding-controls-2026-08-01`) | The history is append-only. If a replayed thinking block ever fails the check, it's dropped instead of failing the demo. |
| Prompt caching | `cache_control: ephemeral` | The system prompt and tool list are frozen, so repeated turns reuse the cache. |
| Shared reply cache | `COPILOT_CACHE` KV binding, else the edge Cache API; in-memory in `vite dev` | An identical request (same model, prompt, tools and history) is answered from the store at no API cost. |

Cost: a typical question takes 2–4 API calls (tool rounds) and costs a few US cents on Opus 5.5, about half on Sonnet 5.5. Each answer in the app shows its model calls, tokens, prompt-cache share, shared-cache hits and a US$ estimate, read from the API's `usage` report; the top bar's AI badge shows the session total. The efficiency measures are listed in [`WORKFLOW_BLUEPRINT.md` §10](WORKFLOW_BLUEPRINT.md#10-ai-efficiency).

### How a question flows

```mermaid
sequenceDiagram
  participant U as User
  participant B as Browser (agentClient + agentTools)
  participant F as /api/copilot (server/copilot.ts)
  participant C as Claude API
  U->>B: "Is Dengkil flood-prone?"
  B->>F: history + question + map context
  F->>C: + fixed system prompt, 11 tools, model, effort, fallbacks
  C-->>F: tool_use: search_places("Dengkil")
  F-->>B: content (stored verbatim)
  B->>B: run search_places over the gazetteer
  B->>F: tool_result
  F->>C: …
  C-->>B: tool_use: analyse_location(lat, lon, 1000 m)
  B->>B: analyse the circle on the grid · draw it on the map · fly there
  B->>F: tool_result (rounded numbers)
  C-->>B: final answer text
  B->>B: grounding check: every figure must match a tool number (unit-aware)
  B-->>U: answer + steps + "✓ all figures match" (or flagged figures)
```

**Tools** (`src/copilot/agentSpec.ts`, executed in `src/copilot/agentTools.ts`):

| Tool | What it returns |
|---|---|
| `search_places` | matching places with coordinates and daerah |
| `get_current_view` | scenario, selected daerah, active drawn area (full report), last clicked cell |
| `analyse_location` | full statistics for a circle (and draws it on the map) |
| `get_daerah_profile` | census population, classes per scenario, zones, people, facilities, score breakdown |
| `query_point` | one cell's class per scenario and its inputs |
| `rank_daerah` | ranking by High share, people in High, zones or facilities in High |
| `list_facilities_at_risk` | facility counts by class and the names in High (state, daerah or drawn area) |
| `get_method_and_validation` | formula, weights, thresholds, validation results, sources, limitations |
| `set_map_view` | switches the scenario, selects a daerah, turns layers on or off — the map shows what the answer describes |
| `find_candidate_sites` | contiguous blocks that stay Low under a chosen scenario and pass the development screen; marked S1… on the map |
| `show_on_map` | moves the map and opens that cell |

**AI features built on these tools.** Questions from the search box or by voice; *Brief me on <daerah>* in the left panel; *✦ Draft brief with AI* for a drawn area (four sections, figure-checked, printed in the PDF); site screening with pins; parallel tool calls in one turn.

**Guardrails.**
- The server fixes the model, system prompt and tools, so the browser can't change them.
- The server accepts only text and tool-result blocks from the user, caps conversation size, and can restrict origins.
- Tools validate and clamp their inputs.
- The system prompt requires numbers to come from tool results and bans "forecast" wording.
- The **grounding check** verifies it: each figure in the answer must match a tool-result number with a compatible unit (`%` ↔ `*_pct`, `km` ↔ `*_km`/`*_m`, …) at the precision written. Unmatched figures are highlighted for the user. A match shows a figure is *traceable*; it doesn't prove the figure was attributed to the right thing.

**Without a key**, `/api/copilot` reports `enabled: false` and the copilot falls back to the template explainer (`src/copilot/explainer.ts`). The app stays fully usable offline.

**Privacy.** Each question sends Claude the question, the scenario, the selected daerah or area label, and the coordinates of a cell only if the user asked about that cell. The locate-me position never leaves the browser unless the user asks the copilot about it. The shared reply cache stores conversations on your own Cloudflare account for a day, keyed by a hash of the whole request; a reply is only returned to an identical request. Voice input uses the browser's own speech service (Chrome and Edge send the audio to their provider).

## Setting up the APIs

### Option A — OpenRouter (copilot)

One OpenRouter key gives access to Claude and many other models; OpenRouter bills per request and reports the cost of each one, which the app shows under every answer.

1. Create a key at **openrouter.ai/keys**, add credits, and set a credit limit on the key.
2. **Local:** `cp .env.example .env.local`, put the key in `OPENROUTER_API_KEY`, run `npm run dev`.
3. **Model:** the default is `anthropic/claude-opus-5.5`. Check the exact slug on **openrouter.ai/models** and set `OPENROUTER_MODEL` if it differs, or to pick another model; it must support **tool calling**. Examples: a Claude Sonnet or Haiku slug for lower cost.
4. **Cloudflare Pages:** add `OPENROUTER_API_KEY` as a **secret**, plus optional `OPENROUTER_MODEL`, `COPILOT_SITE_URL` (your public URL, sent as `HTTP-Referer` so the app is named on OpenRouter), `COPILOT_EFFORT`, `COPILOT_ALLOWED_ORIGINS`, and the `COPILOT_CACHE` KV binding (step 3 of option B describes these).

How it works (`server/openrouter.ts`): the browser's agent loop is unchanged. The proxy translates the conversation to OpenRouter's chat-completions format (the same 11 tools as function definitions, tool results as `tool` messages, `reasoning: {effort}`, `usage: {include: true}`) and translates the reply back. Reasoning that a model returns between tool calls (`reasoning_details`) is kept in the append-only history and sent back unchanged, which models that think between tool calls need. For `anthropic/*` models the fixed system prompt carries a `cache_control` breakpoint so the prompt prefix is cached; other providers cache automatically. A wrong model slug or other request error is shown with OpenRouter's own message.

`AI_PROVIDER=openrouter|anthropic` picks the provider when both keys are set; unset, OpenRouter is used when `OPENROUTER_API_KEY` is present. The Claude-API-only settings (server-side refusal fallback, thinking block binding, `output_config.effort`) apply only to option B.

### Option B — Claude API directly (copilot)

1. Create an API key in the Anthropic Console and set a monthly spend limit.
2. **Local:** `cp .env.example .env.local`, put the key in `ANTHROPIC_API_KEY`, run `npm run dev`. Vite serves `/api/copilot` from `server/copilot.ts`. The key stays in the dev server and never reaches the browser bundle.
3. **Cloudflare Pages:** build command `npm run build`, output directory `dist`. The `functions/` folder is picked up automatically and becomes `/api/copilot`. Under *Settings → Environment variables*, add `ANTHROPIC_API_KEY` as a **secret**, plus optional `COPILOT_MODEL`, `COPILOT_EFFORT` and `COPILOT_ALLOWED_ORIGINS` (e.g. `https://your-site.pages.dev`). For the shared reply cache, create a KV namespace and bind it as `COPILOT_CACHE` under *Settings → Functions*. If the function fails to bundle, enable the `nodejs_compat` compatibility flag.
4. **For a public exhibition:** add a Cloudflare rate-limiting rule on `/api/copilot` (for example 20 requests per minute per IP), and keep the Console spend limit.

### Google basemap (optional)

1. In Google Cloud, enable the **Map Tiles API** and create an API key.
2. Restrict the key by **HTTP referrer** (your site's domain) and by API (Map Tiles API only). A browser key is visible to users by design; the restrictions are what protect it.
3. Set `VITE_GOOGLE_MAPS_API_KEY` in `.env.local` or in Pages' build environment, then rebuild. The *Google* and *Satellite* options become active in the layers panel; the flood layer, pins and outlines are drawn on top of Google's tiles.
4. Google requires its logo and copyright on screen. The app shows Google's attribution from the Map Tiles viewport endpoint; check the current Google Maps Platform policies and pricing before going public.

Without this key, the default basemap (bundled OpenStreetMap/Overture vector tiles in a Google-like style) gives a similar look for free and works offline.

## What's new compared to a typical flood map

- **A grounded AI agent that drives the map:** Claude uses real tools over the computed grid, switches scenario, daerah and layers to show what it means, draws what it analysed, and every figure in its answer is checked against the tool outputs.
- **AI site screening and AI briefs:** candidate land that stays Low even under Extreme rain, as numbered pins; one-click planning briefs that land in the PDF with their figure check.
- **Cost you can see:** tokens, cache share and US$ per answer; a shared reply cache makes repeated exhibition questions free.
- **An offline Google-style map:** self-hosted vector tiles, no key or tile server.
- **Critical-facility exposure:** hospitals, clinics, schools (often used as relief centres), police, Bomba and rail stations, coloured by flood class and counted for any daerah or drawn area under each rain scenario.
- **Transit exposure:** operational rail lines and 151 stations, in operator colours when the risk layer is off.
- **Safe-land finder:** screens undeveloped, gentle, low-susceptibility land (not water, not forest-dominated) for early site search.
- **"Is my spot flood-prone?":** a locate-me check aimed at visitors with phones.
- **Honesty built in:** susceptibility, not forecast; scenario rule table labelled hypothetical; a validation gate with sources; data provenance in every brief.

## Refreshing the data

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
PY=.venv/bin/python pipeline/run_all.sh   # step 5 also needs `npm install` (geojson-vt for tiling)
npm test   # confirms the app still reproduces the pipeline's numbers and the basemap decodes
```
