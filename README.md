# Ginkgo — Selangor Flood Command Center

A live command-center map of **Selangor's nine daerah** for **riverine flood susceptibility** and urban-development screening.
Pick a daerah, draw any rectangle or polygon, switch the rain scenario, and every figure on screen is computed from real,
open terrain, river, land-cover, water-history and census data — with its source shown next to it.

> **What it is:** susceptibility — *where* riverine flooding is more likely.
> **What it is not:** a forecast of *when* a flood will happen, or a hydraulic simulation (no depths, no return periods).
> The copilot explains computed numbers; it never produces one.

**End-to-end architecture, where AI is used, and API setup:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## What you can do

| Flow | How |
|---|---|
| **A · Look at a daerah** | Click a daerah on the map, the population bars, or the ranking. The map zooms to it; the left panel shows population, High-susceptibility land, High-risk zones, people in High cells (estimate), built-up share, and *Why this score*. |
| **B · Analyse a drawn area** | **▭ Rectangle** (drag) or **⬠ Polygon** (click points, double-click to finish; Backspace undoes, Esc cancels). The right panel reports area, land by class under all three scenarios, zones, population estimate, built-up %, river & canal length, elevation range, height above drainage, land cover, a development screen, and *Why this score*. Export a **PDF brief** or **GeoJSON**. |
| **C · Compare scenarios** | Normal / Heavy (50 mm/hr, scenario) / Extreme (120 mm/hr, hypothetical stress test) in the bottom bar. The map keeps its position; **⟲ Reset view** is always there. |
| **D · Historical check** | Toggle **Water history** (JRC Global Surface Water 1984–2021) and **Reported floods** (places reported flooded in Dec 2021, plus DEM-chosen hilly controls) to see how the modelled zones line up. |
| **Inspect a spot** | Click the map for that ~92 m cell's class, score and inputs; *Ask copilot about this spot* adds it as context. |
| **Critical facilities** | Chips for Hospitals, Schools, Police & Bomba, Rail, Clinics: 2,955 mapped facilities, each coloured by the flood class of its cell, and counted per daerah and per drawn area. |
| **Safe land** | Screens undeveloped, gentle, low-susceptibility land (not water, not forest-dominated) for early site search. |
| **Is my spot flood-prone?** | The locate button checks the visitor's own location; it stays on the device unless they ask the copilot. |
| **Ask Ginkgo (AI)** | A Claude agent answers questions by calling tools over the computed grid (search places, analyse an area, rank daerah, list facilities at risk…), draws what it analysed on the map, and every figure in its answer is checked against the tool results. Without an API key it falls back to template answers. |
| **Search** | 1,573 Selangor/KL/Putrajaya place names (OpenStreetMap via Overture). |
| **Method & validation** | Top-right button: formula, weights, scenario rule table, validation results with sources, data provenance, limitations. |

The map looks and works like a consumer map app: floating search, quick chips, layers panel (Streets · Light · OpenStreetMap · Google Map/Satellite with a key · No base), locate-me and reset buttons. On a phone it becomes a full-screen map with a draggable bottom sheet. **No base** runs without basemap tiles (useful offline).

## Run it

```bash
npm install
cp .env.example .env.local   # optional: ANTHROPIC_API_KEY for the AI copilot, VITE_GOOGLE_MAPS_API_KEY for Google tiles
npm run dev        # http://localhost:5173 (also serves /api/copilot)
npm test           # 31 tests: app numbers vs pipeline, tools, agent loop, proxy, grounding check
npm run build      # static site in dist/ + functions/ for Cloudflare Pages
```

Deploy on Cloudflare Pages with build command `npm run build` and output `dist`. The `functions/` folder becomes
`/api/copilot`. Set `ANTHROPIC_API_KEY` as a secret there (details in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
The map itself is fully static: it reads the precomputed files in `public/data/` (≈6.7 MB; the 1.5 MB core grid paints the map,
the 3.7 MB terrain detail loads in the background). Measured on a local production build (3 runs): UI ready ≈1.3 s, terrain detail ≈2.3–2.5 s,
switching daerah ≈50–85 ms. Venue hardware and network will differ.

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

All retrieved 2026-10-16.

## Rebuilding the data

```bash
python3 -m venv .venv && .venv/bin/pip install -r pipeline/requirements.txt
PY=.venv/bin/python pipeline/run_all.sh      # ≈5 min, ~1 GB cache in pipeline/.cache
```

| Step | Does |
|---|---|
| `01_vectors.py` | Overture daerah, KL/Putrajaya, rivers, gazetteer (HTTP range reads of only the Selangor row groups) |
| `01b_sites.py` | Resolves validation-site names to coordinates via Overture names |
| `02_rasters.py` | DEM mosaic, slope, hydrology & HAND, JRC GSW, WorldCover, HRSL → one grid |
| `03_model.py` | Stage 1 score, scenarios, per-daerah stats, validation, client grid files |
| `04_facilities.py` | Hospitals, clinics, schools, police, Bomba, rail stations (filtered, de-duplicated) and operational rail lines |

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
src/data/            types, loading, grid analysis (+ tests), overlays, formatting, Google tiles
src/copilot/         Claude agent: spec (prompt + tools), browser tools, loop, grounding check; template explainer
src/components/      map, map chrome, panels, bottom sheet, charts
src/services/        PDF brief and GeoJSON export
server/copilot.ts    Claude API proxy (shared by Cloudflare and the Vite dev server)
functions/api/       Cloudflare Pages Function entry
docs/ARCHITECTURE.md end-to-end workflow, AI usage, API setup
```

The earlier upload-an-image flow and its mock analysis data were removed; they remain in git history (commit `0beff74`).

## Before presenting

These items from the blueprint's status review live in the pitch deck, not the code:

1. **Framing** — the app models riverine (fluvial) flooding; make slide 2 say the same.
2. **Slide 9** — fill or delete the "[insert model / platform name]" placeholder.
3. **Slide 9 badge** — 99.62 % is accuracy; F1 is 99.33 %.
4. **Slide 10 table** — it repeats slide 9's numbers under a different model name; re-run per model or remove it.
5. **Rain values** — keep 120 / 200 mm/hr labelled as hypothetical stress scenarios (the app does).
6. **Unsourced figures** (96.5 mm/hr, ±30 %, 14 hotspots, deaths, evacuees, RM6.1bn) — verify each against its source or drop it. The app uses none of them.
7. **"Sub-second"** — quote the measured figures above instead, or measure on the presentation machine. Copilot answers take longer (several seconds: 2–4 Claude calls per question).
