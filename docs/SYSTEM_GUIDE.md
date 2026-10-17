# Ginkgo — system guide

The whole system in one document: what Ginkgo is for, every feature and how to use it, how it works from data to
screen, what each file does, how to run and deploy it, and its limits. Progress and plans are tracked separately in
[`PROGRESS.md`](PROGRESS.md).

---

## 1. What Ginkgo is

Ginkgo is a flood command center for **Selangor's nine daerah** (Kuala Lumpur and Putrajaya are federal territories and
sit outside the analysis). It has two modes and a 3D view:

| | Question it answers | For |
|---|---|---|
| **Planning** | *Where* is riverine flooding most likely, and who and what is exposed? | Town planners, councils, developers, the public |
| **Flood drill** | If a storm hits, *when* does each neighbourhood flood, *who* must leave, *where* is there space, and *how* do they get there? | Disaster managers, councils, schools, residents rehearsing |
| **3D view** | What does that water look like on the street? | Anyone — presentations, community briefings |

An AI assistant, **Ask Ginkgo**, answers questions in English or Bahasa Melayu by running the same calculations and
driving the map; every number it writes is checked against those calculations.

**What it is not:** a forecast. The susceptibility map says *where* flooding is more likely; the drill replays a
scenario in time for rehearsal. Neither uses live rainfall, river gauges or a hydraulic model, and the app says so on
every relevant screen.

---

## 2. Features and how to use them

### 2.1 Planning mode (default)

| Feature | How to use it | What you get |
|---|---|---|
| **Susceptibility map** | Opens on load | Red (High) and amber (Moderate) ~92 m cells under the streets of a Google-style map |
| **Rain scenarios** | Bottom bar: Normal · Heavy (50 mm/hr) · Extreme (120 mm/hr, hypothetical) | Map, panels and pins re-classified for that scenario |
| **Daerah profile** | Click a daerah, a bar in the left panel, or search it | Population, High land, High-risk zones, people in High cells, built-up share, facilities, *why this score* |
| **Draw an area** | Chips: ▭ Rectangle or ⬠ Polygon | Area report for all three scenarios in the right panel; ranking against other areas |
| **Exports** | Area report: ⇩ PDF brief · ⇩ GeoJSON | A planning brief with mini-map, method, validation and sources (plus the AI brief if drafted) |
| **Inspect a spot** | Click the map, or the locate-me button | That cell's class, score and inputs; "Ask Ginkgo about this spot" |
| **Facilities** | Chips: Hospitals, Schools, Police & Bomba, Rail, Clinics | 2,955 facilities coloured by the flood class of their cell, counted per daerah or area |
| **Safe land & candidate sites** | Chip *Safe land*; button *◍ Candidate sites* | Gentle, undeveloped, low-susceptibility land; contiguous blocks S1, S2… that stay Low even under Extreme |
| **Reported floods 2021** | Chip *Dec 2021 floods* | Validation sites with the model's class at each |
| **Method & validation** | Top-right button | Formula, weights, scenario rules, validation results with sources, limitations |
| **Search** | Search box, or press `/` | 1,573 place names; typing a question sends it to Ask Ginkgo |

### 2.2 Flood drill mode

Switch with **Flood drill** in the top bar.

| Feature | How to use it | What you get |
|---|---|---|
| **Events** | Left panel: Klang Valley monsoon storm (Dec 2021 pattern) · Flash flood · Bernam & Selangor rivers · All Selangor; Intensity Heavy / Extreme | Where the rain falls and how far the water reaches at the peak |
| **Clock** | Bottom bar: ▶ play, drag the slider, speed 10× / 20× / 40× | The drill time T+h:mm since the rain started; first flooding and peak marked |
| **Water and look-ahead** | On the map; toggle *3-hour look-ahead* | Blue water now (indicative depth bands); purple floods ≤ 1 h, red ≤ 2 h, yellow ≤ 3 h (JMA Kikikuru colours) |
| **Alerts** | Left panel list; filter Level 2+ / Level 4+ | Every neighbourhood and critical facility on Japan's 5-level scale, earliest first, with people affected |
| **Headline tiles** | Left panel | People in flooded cells, people whose cells flood within 1 h, people in centres, people with no centre within reach |
| **Evacuation route** | Click the map, an alert's **Route**, a search result, or locate-me | Walk or drive route to the nearest centre that will have space on arrival, on roads that stay dry until you pass; directions; options; **Leave by**; Google Maps link |
| **Evacuation centres** | Pins on the map (green → amber → red), centre cards, *Centres in the rain area* list | 1,274 candidate PPS with estimated capacity; how full each gets and when; an illustration of the building type; link to real photos |
| **AI situation report** | *✦ Ask Ginkgo for a situation report*, or ask anything | The AI runs the drill tools and answers in drill times |

### 2.3 3D view — Taman Sri Muda

Open with the **◆ 3D · Sri Muda** chip (either mode).

- An architect's white model: 23,336 buildings in white with dark outlines, soft shadows, streets, the Klang river and drains.
- In a drill the water rises through the streets at the drill's indicative depths; the route appears as a blue tube; centres
  are green pins. A card compares the deepest water with a two-storey house.
- Toolbar: Water · Labels · Rotate · Reset view · ✕. Drag to orbit, scroll to zoom, right-drag to pan.
- In Planning mode, *▶ Play the flood here* starts the Klang Valley drill.

### 2.4 Ask Ginkgo (AI)

- Open from the *✦ Ask Ginkgo* tab, chip, or by typing a question in the search box. Voice input on supported browsers.
- 15 tools: places, current view, area analysis, daerah profile, point query, rankings, facilities at risk, method,
  map control, candidate sites, show on map, and the drill tools (run drill, drill status, evacuation route, list centres).
- Every figure in an answer is checked against the tool results ("✓ All N figures match"); tokens and cost are shown;
  repeated questions come from a shared cache. Without an API key the app answers from templates.

---

## 3. How it works

```
open data ──► offline pipeline (Python) ──► public/data, public/basemap ──► browser app (React + MapLibre + three.js)
                                                                                  │
                                                         Ask Ginkgo ◄──► /api/copilot proxy ◄──► OpenRouter or Claude API
```

### 3.1 Offline pipeline (`pipeline/`, run once, ≈15 min)

| Step | Builds |
|---|---|
| `01_vectors.py` | Daerah boundaries, rivers, gazetteer (Overture Maps) |
| `01b_sites.py` | Validation sites from December 2021 flood reports |
| `02_rasters.py` | One ~92 m grid: elevation, slope, flow, **HAND**, river distance, water history, land cover, population |
| `03_model.py` | Susceptibility score, three scenarios, per-daerah statistics, validation |
| `04_facilities.py` | Hospitals, clinics, schools, police, Bomba, rail stations; operational rail lines |
| `05_basemap.py` + `tiles.mjs` | Google-style vector basemap (PMTiles) |
| `06_evacuation.py` | Road graph for routing; candidate evacuation centres with capacity |
| `07_model3d.py` | 3D massing model of Taman Sri Muda |

**The score:** `0.35·exp(−HAND/5 m) + 0.20·exp(−distance/1500 m) + 0.15·(1 − slope/8°) + 0.15·(1 − elevation/50 m) +
0.15·min(water history/25 %, 1)`; High from 0.60, Moderate from 0.40 (Normal), thresholds lowered by 0.05 (Heavy) and 0.10 (Extreme).
Weights are illustrative, not calibrated.

**The drill:** within the rain area, cells at or above the scenario's High threshold flood in score order between the
first-flooding time and the peak (one *onset minute* per cell). Alert level = time until a place's earliest flooding
(≤ 0 → 5, ≤ 1 h → 4, ≤ 2 h → 3, ≤ 3 h → 2).

**Routing:** time-aware Dijkstra on 197,323 junctions and 264,379 road links; a road is closed if its lowest point
(lowest-HAND cell, bridges and stream crossings excluded) floods before the walker is 10 minutes past it. Walking 4.5 km/h;
driving at 60% of class speed in heavy rain.

**Centre filling:** evacuation orders per ~740 m zone, an hour before the zone's first flooding; 15% of residents go to a
public centre; each zone's people go to the nearest of their 6 nearest reachable centres with space (worker thread, 2–4 s).

**Capacity:** usable floor area ÷ 3.5 m² per person (Sphere minimum), from Overture building footprints at each site.

### 3.2 Browser app (`src/`)

| Folder | Contents |
|---|---|
| `pages/CommandCenter.tsx` | The screen: modes, panels, map, AI wiring |
| `components/command/` | Map (MapLibre), map chrome, panels, report, copilot, top and bottom bars |
| `components/sim/` | Drill panel, Evacuate panel, timeline, centre illustrations |
| `components/brand/` | The Ginkgo logo |
| `data/` | Loading, grid analysis, overlays, formatting |
| `sim/` | Drill engine: flood time-lapse, road graph, routing, evacuation plan (+ worker), map painter, state hook |
| `three/` | 3D view: model loader, geometry, the three.js scene |
| `copilot/` | AI: prompt and tool specs, tools, drill tools, agent loop, grounding check |
| `map/` | Basemap style and icons |
| `services/` | PDF and GeoJSON exports |

### 3.3 Server (`server/`, `functions/`)

One endpoint, `/api/copilot`: keeps the API key on the server, forwards the conversation to OpenRouter or the Claude API,
caches replies. Runs as a Cloudflare Pages Function in production and as Vite middleware in development.

---

## 4. Data inventory

| File | Size | Contents | Loaded |
|---|---|---|---|
| `grid_core.bin.gz` | 1.5 MB | score, daerah, population, built-up, water history, river length per cell | at start |
| `grid_detail.bin.gz` | 3.6 MB | tree, crop, water, HAND, slope, elevation, river distance | in the background |
| `stats.json`, `model.json`, `validation.json`, `grid.json` | small | statistics, model spec, validation, grid layout | at start |
| `daerah.json`, `rivers.json`, `places.json` | 1.4 MB | boundaries, rivers, gazetteer | at start |
| `facilities.json`, `rail.json` | 0.4 MB | facilities, rail lines | at start |
| `roads.bin.gz` + `roads.json` | 5.1 MB | drill road graph and road names | when the drill opens |
| `shelters.json` | 0.2 MB | candidate evacuation centres | when the drill opens |
| `model3d.bin.gz` + `model3d.json` | 0.4 MB | Taman Sri Muda 3D model | when the 3D view opens |
| `public/basemap/selangor.pmtiles` | 23 MB | vector basemap, fetched tile by tile | as you pan |

Sources: Copernicus GLO-30 DEM · OpenStreetMap via Overture Maps (2026-09-23.1) · JRC Global Surface Water · ESA WorldCover 2021 ·
Meta HRSL · DOSM Census 2020. Retrieved 2026-10-16/17.

---

## 5. Run, build, deploy

```bash
npm install
cp .env.example .env.local     # optional: OPENROUTER_API_KEY or ANTHROPIC_API_KEY; VITE_GOOGLE_MAPS_API_KEY
npm run dev                    # http://localhost:5173 (with /api/copilot)
npm test                       # 69 tests
npm run build                  # dist/ + functions/ for Cloudflare Pages
```

| Setting | Where | Purpose |
|---|---|---|
| `OPENROUTER_API_KEY` (+ `OPENROUTER_MODEL`) | server secret | AI via OpenRouter |
| `ANTHROPIC_API_KEY` | server secret | AI via the Claude API directly |
| `COPILOT_CACHE` | Cloudflare KV binding | shared answer cache (optional) |
| `VITE_GOOGLE_MAPS_API_KEY` | build-time | Google basemaps (optional) |

Rebuilding the data: see the README (*Rebuilding the data*). The demo film: [`demo/README.md`](../demo/README.md).

---

## 6. Quality

- **Tests (69):** app numbers reproduce the pipeline's; basemap decodes; AI tools; site screen; agent loop; proxy, cache and
  OpenRouter translation; grounding check; drill time-lapse, alert levels, routing (dry roads, full centres, flooded start),
  centre capacity; drill AI tools.
- **Lint and types:** `npx oxlint src` and `npx tsc -b` clean.
- **Browser checks:** desktop and phone, production build, scripted AI flows.

---

## 7. Limits and honesty

- Susceptibility, not forecasting; weights illustrative; scenarios are a rule table; 120 mm/hr is hypothetical.
- The drill spreads water by score within the rain area, not by routing flow down rivers; depths are indicative.
- Roads are undirected; road closure uses each road's lowest ~92 m cell.
- Centres are candidates from open data, not the official NADMA/JKM list; capacities are estimates; 15% use of public
  centres is an assumption.
- 3D heights are mostly estimated from footprint size (Overture rarely has heights here).
- Population figures are estimates (HRSL scaled to the census).

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Daerah** | District; Selangor has nine |
| **HAND** | Height Above Nearest Drainage — how far a cell sits above the stream it drains to |
| **Susceptibility** | How likely a place is to flood, relative to others; not when |
| **Scenario** | Normal / Heavy / Extreme: stricter thresholds for High and Moderate |
| **Drill** | A replay of a scenario in time, for rehearsal |
| **Alert level** | Japan's 5-level scale: 2 check your plan · 3 elderly leave · 4 everyone leaves · 5 flooding now |
| **Kikikuru** | Japan Meteorological Agency's risk map; source of the yellow / red / purple / black colours |
| **PPS** | *Pusat Pemindahan Sementara* — temporary evacuation centre |
| **VACAN** | Japanese service showing shelter crowding; source of the space / filling / crowded / full states |
| **Sphere** | Humanitarian standard: at least 3.5 m² of covered space per person |
| **Leave by** | The last departure time that still has a dry route out |
| **Grounding check** | The app's check that every figure in an AI answer appears in a tool result |

---

## 9. Other documents

| Document | Read it for |
|---|---|
| [`../README.md`](../README.md) | Project overview, run instructions, data sources, rebuild |
| [`PROGRESS.md`](PROGRESS.md) | What is done, in progress and planned; milestones; decisions |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Architecture, where AI is used, API setup |
| [`WORKFLOW_BLUEPRINT.md`](WORKFLOW_BLUEPRINT.md) | Every workflow as Input → Process → Output; demo script |
| [`REFERENCES.md`](REFERENCES.md) | Japan, Singapore and Malaysia systems the drill follows |
| [`VIDEO_SCRIPT.md`](VIDEO_SCRIPT.md) | The 3-minute pitch video script |
| [`../demo/pitch/PROMPT.md`](../demo/pitch/PROMPT.md) | Brief for editing the pitch video locally (motion graphics, music, sound effects) |
| [`../demo/README.md`](../demo/README.md) | How the 2-minute demo film is made |
