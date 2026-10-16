# Ginkgo — Selangor Flood Command Center

A live command-center map of **Selangor's nine daerah** for **riverine flood susceptibility** and urban-development screening.
Pick a daerah, draw any rectangle or polygon, switch the rain scenario, and every figure on screen is computed from real,
open terrain, river, land-cover, water-history and census data — with its source shown next to it.

> **What it is:** susceptibility — *where* riverine flooding is more likely.
> **What it is not:** a forecast of *when* a flood will happen, or a hydraulic simulation (no depths, no return periods).
> The copilot explains computed numbers; it never produces one.

**Every workflow as Input → Process → Output (incl. AI and AI efficiency):** [`docs/WORKFLOW_BLUEPRINT.md`](docs/WORKFLOW_BLUEPRINT.md) ·
**Architecture, where AI is used, and API setup:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) ·
**2-minute demo film (silent, captioned):** [`docs/demo/ginkgo-demo.mp4`](docs/demo/ginkgo-demo.mp4), made with [`demo/`](demo/README.md).

## What you can do

| Flow | How |
|---|---|
| **A · Look at a daerah** | Click a daerah on the map, the population bars, or the ranking. The map zooms to it; the left panel shows population, High-susceptibility land, High-risk zones, people in High cells (estimate), built-up share, and *Why this score*. |
| **B · Analyse a drawn area** | **▭ Rectangle** (drag) or **⬠ Polygon** (click points, double-click to finish; Backspace undoes, Esc cancels). The right panel reports area, land by class under all three scenarios, zones, population estimate, built-up %, river & canal length, elevation range, height above drainage, land cover, a development screen, and *Why this score*. Export a **PDF brief** or **GeoJSON**. |
| **C · Compare scenarios** | Normal / Heavy (50 mm/hr, scenario) / Extreme (120 mm/hr, hypothetical stress test) in the bottom bar. The map keeps its position; **⟲ Reset view** is always there. |
| **D · Historical check** | Toggle **Water history** (JRC Global Surface Water 1984–2021) and **Reported floods** (places reported flooded in Dec 2021, plus DEM-chosen hilly controls) to see how the modelled zones line up. |
| **Inspect a spot** | Click the map for that ~92 m cell's class, score and inputs; *Ask Ginkgo about this spot* adds it as context. |
| **Critical facilities** | Chips for Hospitals, Schools, Police & Bomba, Rail, Clinics: 2,955 mapped facilities, each coloured by the flood class of its cell, and counted per daerah and per drawn area. |
| **Safe land & candidate sites** | Screens undeveloped, gentle, low-susceptibility land (not water, not forest-dominated). **◍ Candidate sites** groups it into contiguous blocks that stay Low even under Extreme rain and pins them S1, S2… |
| **Is my spot flood-prone?** | The locate button checks the visitor's own location; it stays on the device unless they ask the copilot. |
| **Ask Ginkgo (AI)** | A Claude agent answers by calling 11 tools over the computed grid (search places, analyse an area, rank daerah, list facilities at risk, screen sites…), **operates the map** (scenario, daerah, layers) to show what it means, and every figure in its answer is checked against the tool results. Ask from the chat, the map's search box, a suggestion card, or by voice. Each answer shows its tokens and cost; repeated questions are served from a shared cache. Without an API key it falls back to template answers. |
| **AI planning brief** | **✦ Draft brief with AI** on a drawn area: four short sections, figure-checked, and included in the PDF. |
| **Search** | 1,573 Selangor/KL/Putrajaya place names (OpenStreetMap via Overture); press `/` to focus. A question typed here goes to Ginkgo. |
| **Method & validation** | Top-right button: formula, weights, scenario rule table, validation results with sources, data provenance, limitations. |

The map looks and works like Google Maps: a self-hosted vector basemap in a Google-like style (mint vegetation, white streets, yellow expressways, blue water, route shields), the flood layer under streets and labels, rail lines in operator colours, floating search, quick chips, a layers panel (Default · Light · Plain · Google/Satellite with a key), locate-me and reset buttons. The view is kept in the URL so it can be shared. On desktop the right panel has **Insights** and **✦ Ask Ginkgo** tabs; on a phone the app becomes a full-screen map with a draggable bottom sheet. The whole map works offline.

## Run it

```bash
npm install
cp .env.example .env.local   # optional: OPENROUTER_API_KEY (or ANTHROPIC_API_KEY) for the AI copilot, VITE_GOOGLE_MAPS_API_KEY for Google tiles
npm run dev        # http://localhost:5173 (also serves /api/copilot)
npm test           # 52 tests: app numbers vs pipeline, basemap, tools, site screen, agent loop, proxy & cache, OpenRouter, grounding check
npm run build      # static site in dist/ + functions/ for Cloudflare Pages
```

Deploy on Cloudflare Pages with build command `npm run build` and output `dist`. The `functions/` folder becomes
`/api/copilot`. Set `OPENROUTER_API_KEY` (or `ANTHROPIC_API_KEY`) as a secret there, and optionally `OPENROUTER_MODEL`
(details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#setting-up-the-apis)).
The map itself is fully static: it reads the precomputed files in `public/data/` (≈6.7 MB; the 1.5 MB core grid paints the map,
the 3.7 MB terrain detail loads in the background) and the 23 MB basemap archive, of which only the tiles in view are fetched
(HTTP range requests; the first Selangor view took 5 requests, 0.22 MB). Measured on a local production build (3 runs): UI ready
≈1.3 s, terrain detail ≈2.3–2.4 s. Venue hardware and network will differ.

## How the numbers are made

```
INPUT                          PROCESS (offline, pipeline/)                      OUTPUT (app)
Copernicus GLO-30 DEM   ──►    3″ grid (~92 m) · slope · stream burning ·    ──► susceptibility layer (3 classes × 3 scenarios)
OSM rivers & canals            depression fill · D8 flow · HAND               ──► daerah panel, ranking, zones
JRC Global Surface Water ─►    intermittent-water share 1984–2021             ──► drawn-area report, Why this score
ESA WorldCover 2021     ──►    built-up / tree / crop / water shares          ──► PDF brief, GeoJSON
Meta HRSL + DOSM 2020   ──►    30 m population scaled to census per daerah    ──► population exposure (estimate)
Overture divisions      ──►    9 daerah; KL & Putrajaya excluded              ──► validation gate
```

Heavy work runs once, offline. A click only reads precomputed data; a drawn polygon is rasterised onto the grid and its
cells are counted in the browser (`src/data/analysis.ts`). The tests in `src/data/analysis.test.ts` confirm that this
browser-side counting reproduces the pipeline's per-daerah class areas, zone counts, population and validation classes.

### Stage 1 model (running here)

```
S = 0.35·HAND_score + 0.20·proximity_score + 0.15·flatness_score + 0.15·elevation_score + 0.15·history_score
```

| Term | 0–1 transform |
|---|---|
| Height above nearest drainage (HAND) | `exp(-HAND / 5 m)` |
| Distance to mapped river or canal | `exp(-distance / 1500 m)` |
| Flatness | `1 - min(slope / 8°, 1)` |
| Elevation above sea level | `1 - min(elevation / 50 m, 1)` |
| Observed surface-water history | `min(intermittent-water share / 25 %, 1)` |

Weights are **illustrative, not calibrated**. Class thresholds (High ≥ 0.60, Moderate ≥ 0.40) were fixed from worked examples
*before* the validation sites were checked (e.g. 2 m above a river 300 m away on flat ground 10 m above sea → 0.66, High).
Scenarios are a rule table: Heavy lowers both thresholds by 0.05, Extreme by 0.10. Selangor-wide High share: 24.1 % (Normal),
30.4 % (Heavy), 36.3 % (Extreme).

**Stage 2** (a learned model) needs official JPS / DID flood-extent labels split by event or sub-catchment. Those were not
available, so Stage 1 is the product.

### Validation gate

Flood sites come from contemporaneous reports of the December 2021 floods; coordinates are matched to OpenStreetMap names,
not typed by hand, and each site's daerah is read from the boundary data (Taman Sri Muda, in Shah Alam, falls in Klang daerah). Hilly controls are chosen from the DEM by slope. This is a sanity check, not an accuracy score.

| Site | Kind | Model (Normal) | Expected | High within 500 m |
|---|---|---|---|---|
| Taman Sri Muda, Shah Alam | Reported flood, Dec 2021 | Moderate ✗ | High | 59% |
| Seksyen 13, Shah Alam | Reported flood, Dec 2021 | High ✓ | High | 79% |
| Telok Gong, Klang | Reported flood, Dec 2021 | High ✓ | High | 86% |
| Kampung Johan Setia, Klang | Reported flood, Dec 2021 | Moderate ✗ | High | 3% |
| Pandamaran, Klang | Reported flood, Dec 2021 | High ✓ | High | 96% |
| Taman Sri Nanding, Hulu Langat | Reported flood, Dec 2021 | Moderate ✗ | High | 27% |
| Dengkil, Sepang | Reported flood, Dec 2021 | High ✓ | High | 71% |
| Masjid Jamek, Kuala Lumpur | Reported flood — KL, outside scope (regression check) | High ✓ | High | 49% |
| Populated hillside near Taman Industri Bolton | Hilly control (DEM-chosen) | Low ✓ | Low | 0% |
| Upland forest, Hulu Selangor | Hilly control (DEM-chosen) | Low ✓ | Low | 0% |

**4 of 7** Selangor flood sites are High at the point; the other 3 are Moderate. **2 of 2** controls are Low.
Sources for each site are in `public/data/validation.json` and in the app's *Method & validation* drawer.

## Data sources

| Layer | Source | Notes |
|---|---|---|
| Terrain | [Copernicus GLO-30 DEM](https://registry.opendata.aws/copernicus-dem/) | 1″ → 3″; 3rd-lowest of 9 sub-pixels per cell to reduce building/canopy bias of the surface model |
| Rivers, canals, boundaries, place names | OpenStreetMap contributors via [Overture Maps](https://overturemaps.org/) 2026-09-23.1 | ODbL |
| Water history | [JRC Global Surface Water](https://global-surface-water.appspot.com/) v1.4 occurrence | seen as water in 1–50 % of observations, 1984–2021 |
| Land cover | [ESA WorldCover 2021](https://esa-worldcover.org/) v200 | 10 m |
| Population | DOSM Census 2020 district totals; [Meta/CIESIN HRSL](https://dataforgood.facebook.com/dfg/tools/high-resolution-population-density-maps) v1.5 | HRSL's 30 m pattern scaled per daerah to the census; the nine districts sum to DOSM's published 6,994,423 (`pipeline/dosm_census_2020.json` lists each figure's source) |
| Facilities & rail | OpenStreetMap and other open sources via Overture Maps places / transportation | Filtered by category, name and confidence; de-duplicated; stations kept only within 300 m of an operational line; may be incomplete |
| Basemap | OpenStreetMap, ESA WorldCover and other sources via Overture Maps (base, transportation, divisions); Noto Sans glyphs (SIL OFL) from Protomaps basemaps-assets | Self-hosted vector tiles z5–14 |

All retrieved 2026-10-16.

## Rebuilding the data

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
PY=.venv/bin/python pipeline/run_all.sh      # ≈8 min, ~1.2 GB cache in pipeline/.cache (step 5 needs npm install)
```

| Step | Does |
|---|---|
| `01_vectors.py` | Overture daerah, KL/Putrajaya, rivers, gazetteer (HTTP range reads of only the Selangor row groups) |
| `01b_sites.py` | Resolves validation-site names to coordinates via Overture names |
| `02_rasters.py` | DEM mosaic, slope, hydrology & HAND, JRC GSW, WorldCover, HRSL → one grid |
| `03_model.py` | Stage 1 score, scenarios, per-daerah stats, validation, client grid files |
| `04_facilities.py` | Hospitals, clinics, schools, police, Bomba, rail stations (filtered, de-duplicated) and operational rail lines |
| `05_basemap.py` + `tiles.mjs` | Google-style basemap: roads, water, land cover, land use, airports, place names → vector tiles → `public/basemap/selangor.pmtiles` |

## Limitations

- Susceptibility, not forecasting; not a hydraulic model.
- Weights are illustrative; scenario classes come from a rule table; the 120 mm/hr case is hypothetical.
- The DEM is a surface model; buildings and canopy can still raise apparent ground height.
- The history term counts any intermittent water, so irrigated paddy and old mining ponds can score as "wet before".
- Population figures are estimates. Built-up growth between two dates is not included (needs two comparable land-cover dates).
- HAND falls back to straight-line height above the nearest drainage for ~1.4 % of land cells whose flow paths did not resolve.
- Small drawn areas contain few ~92 m cells; treat their figures as indicative. Early screening only — it does not decide permits.

## Project layout

```
pipeline/            offline data build (Python)
public/data/         precomputed files the app reads
public/basemap/      self-hosted vector tiles (PMTiles) and label fonts
src/data/            types, loading, grid analysis + site screen (+ tests), overlays, formatting, Google tiles
src/map/             basemap style (Google-like) and runtime icons (+ tests)
src/copilot/         Claude agent: spec (prompt + tools + prices), browser tools, loop, grounding check; template explainer
src/components/      map, map chrome, panels, copilot, sites, bottom sheet, charts
src/services/        PDF brief and GeoJSON export
server/copilot.ts    copilot proxy (shared by Cloudflare and the Vite dev server): OpenRouter or the Claude API
server/openrouter.ts translation to and from OpenRouter chat completions
functions/api/       Cloudflare Pages Function entry
docs/ARCHITECTURE.md architecture, AI usage, API setup
docs/WORKFLOW_BLUEPRINT.md  every workflow as Input → Process → Output, AI efficiency, demo script
```

The earlier upload-an-image flow and its mock analysis data were removed; they remain in git history (commit `0beff74`).

## Before presenting

1. **AI key and budget** — set `OPENROUTER_API_KEY` (with a credit limit on the key) or `ANTHROPIC_API_KEY` (with a Console spend limit) as a secret, confirm the `OPENROUTER_MODEL` slug on openrouter.ai/models, add a rate-limit rule on `/api/copilot`, and (optional) the `COPILOT_CACHE` KV binding so repeated questions are free.
2. **Rehearse the demo** in [`docs/WORKFLOW_BLUEPRINT.md` §14](docs/WORKFLOW_BLUEPRINT.md#14-five-minute-exhibition-demo) on the presentation machine; the map works offline, the AI needs the network.
3. **Framing** — say *riverine flood susceptibility*, not forecast; keep 50 / 120 mm/hr labelled as scenario and hypothetical stress test (the app does).
4. **Timing** — quote measured figures (above) or measure on the venue machine. AI answers take several seconds (2–4 Claude calls per question); repeated questions come back from the cache.
5. **Unsourced figures** — any statistic on slides that is not in this app (deaths, evacuees, losses, rainfall records) needs its own source.
