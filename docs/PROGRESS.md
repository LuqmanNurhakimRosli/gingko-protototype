# Ginkgo — progress tracker

A living record of what is built, what is in progress and what is next. Update it whenever a piece of work lands:
move items between sections, add a milestone row with its commit, and note any decision.

**Last updated:** 2026-10-17 · **Branch:** `ccr-4f4b5ee6-9w2dmb` · **`main`** is at `820e47b` (OpenRouter); everything
after that is on the branch until it is merged.

Legend: ✅ done · 🟡 in progress / waiting · ⬜ planned · ⚠️ known issue

---

## 1. Status at a glance

| Area | Status | Notes |
|---|---|---|
| Data pipeline (grid, score, scenarios, stats, validation) | ✅ | `pipeline/01–03` |
| Facilities and rail | ✅ | `04_facilities.py` |
| Google-style self-hosted basemap | ✅ | `05_basemap.py`, works offline |
| Planning mode: map, daerah profiles, drawn areas, exports | ✅ | PDF brief with logo, GeoJSON |
| Candidate sites / safe land | ✅ | |
| Ask Ginkgo AI (tools, grounding check, cost, cache) | ✅ | Claude API or OpenRouter |
| OpenRouter provider | ✅ | ⚠️ not tested against the live API (openrouter.ai unreachable from the build machine) |
| Workflow blueprint and architecture docs | ✅ | |
| 2-minute demo film (silent, captioned) | ✅ | ⚠️ made before the drill, the 3D view and the new logo |
| Flood drill: time-lapse, alerts, look-ahead | ✅ | |
| Evacuation routing (dry roads, leave-by, options) | ✅ | |
| Evacuation centres with capacity and crowding | ✅ | candidates, not the official list |
| Drill AI tools (run, status, route, centres) | ✅ | |
| Ginkgo logo and favicon | ✅ | |
| Reference systems write-up (Japan, Singapore, Malaysia) | ✅ | `REFERENCES.md` |
| 3D sketch model — Taman Sri Muda | ✅ | with drill water and route |
| 3-minute pitch video | 🟡 | script done (`VIDEO_SCRIPT.md`); waiting for the founder's on-camera and voice-over recordings |
| System guide and this tracker | ✅ | `SYSTEM_GUIDE.md`, `PROGRESS.md` |
| Merge the branch into `main` | 🟡 | waiting for the go-ahead |

---

## 2. Milestones

| Date | Commit | Milestone |
|---|---|---|
| 2026-09-14 | `e9e45aa` | Initial prototype (image-upload flow) |
| 2026-10-16 | `2f13378` | Replaced with the Selangor flood command center: pipeline, grid, scenarios, panels, draw, exports |
| 2026-10-16 | `0f463c6` | Google-style map, Claude agent copilot, facility exposure |
| 2026-10-16 | `991dc81` | Self-hosted Google-style vector basemap |
| 2026-10-16 | `3f7824b` | AI map control, site finder, AI briefs, cost-aware copilot |
| 2026-10-16 | `bc2f40b` | Workflow blueprint, shareable map views, search shortcut |
| 2026-10-16 | `820e47b` | OpenRouter as an AI provider (**merged to `main`**) |
| 2026-10-16 | `0f8ecef`, `2c846f5` | Demo film tooling and the 2-minute film |
| 2026-10-17 | `22c1fe7` | Flood drill: simulated flooding, alerts, evacuation routes and centres, AI drill tools, logo |
| 2026-10-17 | `9129d6b` | Drill polish (AI keeps its answer in view, phone layout), docs, references |
| 2026-10-17 | `15d871e` | 3D sketch-style model of Taman Sri Muda with the drill's water |
| 2026-10-17 | `8450dba` | 3-minute pitch video script |
| 2026-10-17 | *(this commit)* | System guide and progress tracker |

---

## 3. Numbers to keep consistent

Use these exact figures in slides, the video and the pitch (all from the app or `REFERENCES.md`):

| Figure | Value | Source |
|---|---|---|
| Selangor population | 6,994,423 (6.99M) | DOSM Census 2020 |
| Land High susceptibility (Normal) | 24.1% | Ginkgo analysis |
| People in High cells (Normal) | ~1.93 million | estimate, HRSL × Census |
| Hospitals in High cells (Normal) | 32 of 116 | Ginkgo, Overture facilities |
| Schools in High cells (Normal) | 155 of 626 | Ginkgo, Overture facilities |
| Validation | 4 of 7 Dec 2021 flood sites High; 2 of 2 hilly controls Low | `validation.json` |
| Candidate evacuation centres | 1,274 (539 schools, 150 halls, 415 mosques, 170 sports) | `shelters.json` |
| Drill road graph | 197,323 junctions · 264,379 links | `roads.json` |
| 3D model | 23,336 buildings, Taman Sri Muda | `model3d.json` |
| People in Selangor PPS, 26 Dec 2021 | 15,404 in 83 centres | news reports (`REFERENCES.md`) |
| Tests | 69 passing | `npm test` |

---

## 4. Backlog (next)

Ordered by value for the exhibition and a council pilot.

| # | Item | Why | Size |
|---|---|---|---|
| 1 | **Record and edit the 3-minute video** | The pitch | founder records → edit |
| 2 | **Refresh the 2-minute demo film** with the drill, the 3D view and the new logo | Current film predates them | 1 session |
| 3 | **Merge to `main` and deploy** (Cloudflare Pages + AI key + spend limit) | Public link for judges | small |
| 4 | **Test OpenRouter live** with the real key and model slug | Unverified so far | small |
| 5 | **Live river levels** from Public InfoBanjir to start or steer the drill | From rehearsal to real warnings | medium |
| 6 | **Official PPS list** (NADMA / JKM) to replace or confirm the candidate centres | Real names and capacities | medium (needs data access) |
| 7 | **One-way streets and road closures** in routing | More realistic driving routes | medium |
| 8 | **Street View photos** of centres when a Google key is set | Real "what it looks like" | small |
| 9 | **More 3D areas** (e.g. Klang town, Kuala Lumpur city centre) | Other demo sites | small per area (`07_model3d.py` box) |
| 10 | **"My Timeline" sheet** per household (print or share) | Personal preparedness | small |
| 11 | **Bahasa Melayu interface** | Local users | medium |
| 12 | **Flow-routed drill** (water moving down rivers between daerah) | More physical spread | large |

---

## 5. Known issues and limits

- ⚠️ The demo film (`docs/demo/ginkgo-demo.mp4`) shows the app before the drill, 3D view and new logo.
- ⚠️ OpenRouter integration follows the documented API but has not been called live.
- The drill's water spreads by susceptibility score, not by flow; depths are indicative.
- Most 3D building heights are estimated (Overture rarely has heights here).
- Routing treats roads as two-way and closes a road when its lowest ~92 m cell floods.
- In big drills, nearby centres fill quickly; "no centre within reach" depends on the 15% assumption.
- The JS bundle is large (MapLibre); three.js and the drill data load only when needed.

---

## 6. Decisions

| Date | Decision | Reason |
|---|---|---|
| 2026-10-16 | Susceptibility, not forecast; scenarios as a rule table | No calibrated hydraulic model or live data |
| 2026-10-16 | Self-hosted vector basemap | Works offline at the exhibition; no tile key |
| 2026-10-16 | AI never produces numbers; grounding check on every answer | Trust |
| 2026-10-16 | OpenRouter or Claude API behind one server proxy | Key stays on the server; switch providers by setting |
| 2026-10-17 | Flood drill = time-lapse of the scenario, labelled "simulation, not a forecast" | Honest without live gauges |
| 2026-10-17 | Japan's 5-level alerts and Kikikuru colours; VACAN crowding states; Sphere 3.5 m² | Proven public systems (`REFERENCES.md`) |
| 2026-10-17 | Evacuation orders per ~740 m zone; 15% to public centres | Matches how orders are issued; Dec 2021 behaviour |
| 2026-10-17 | Centre images are illustrations by type, plus a Google Maps photo link | No licensed photos of each building |
| 2026-10-17 | 3D area = Taman Sri Muda, not Kuala Lumpur | KL is outside the analysis; Sri Muda is the drill's demo site and the 2021 flood |

---

## 7. How to update this file

1. When work lands, set its row in **Status at a glance** and add a **Milestones** row with the commit hash.
2. Move finished backlog items out of **Backlog**; add new ideas at the right priority.
3. If a figure in **Numbers to keep consistent** changes (for example after rebuilding the data), update it here and in the video
   script and slides.
4. Record any choice that someone might later question in **Decisions**.
