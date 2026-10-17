// Ginkgo flood drill — a time-lapse of a rain event over the susceptibility grid.
//
// The drill plays a scenario forward in time. Rain falls over the chosen daerah;
// water reaches the most susceptible ground first (lowest above drainage,
// nearest rivers, flattest) and spreads until, at the peak, it covers the
// scenario's High class. Each cell gets one number: the minute it floods.
// From that, every view follows — the flood extent at any time, the 1–3 hour
// look-ahead and the alert level of every place.
//
// This is a drill, not a forecast: there is no live rainfall, river gauge or
// hydraulic model behind it. Depths are indicative only.

import type { Grid, ModelSpec, Place, Facility } from '../data/types';
import { SCORE_WATER } from '../data/types';
import { DAERAH_NAMES, cellIndex, type LonLat } from '../data/analysis';

export const NEVER = 65535;

export type Intensity = 'heavy' | 'extreme';
export interface FloodEvent {
  id: string;
  label: string;
  desc: string;
  daerah: number[];        // where the rain falls (1–9)
  intensity: Intensity;    // which scenario's High class the flood reaches at its peak
  firstMin: number;        // minutes after the rain starts when the first ground floods
  peakMin: number;         // minutes when the flood reaches its full extent
  stageM: number;          // indicative water level at the peak, m
  durationMin: number;     // length of the drill
}

/** Score at which the first cells flood; the most susceptible ground in Selangor scores ~0.85+. */
const START_SCORE = 0.82;

export const EVENTS: FloodEvent[] = [
  {
    id: 'klang-valley', label: 'Klang Valley monsoon storm',
    desc: 'Days of monsoon rain over Klang, Petaling, Hulu Langat, Kuala Langat and Sepang — the pattern of December 2021.',
    daerah: [6, 5, 8, 7, 9], intensity: 'extreme', firstMin: 40, peakMin: 300, stageM: 2.8, durationMin: 420,
  },
  {
    id: 'flash', label: 'Flash flood after a thunderstorm',
    desc: 'Two hours of intense rain over Petaling and Gombak; drains overflow in the lowest urban spots first.',
    daerah: [5, 4], intensity: 'heavy', firstMin: 20, peakMin: 140, stageM: 1.2, durationMin: 240,
  },
  {
    id: 'north', label: 'Bernam & Selangor rivers rise',
    desc: 'Heavy rain upstream in Hulu Selangor; the Selangor and Bernam rivers rise through Kuala Selangor and Sabak Bernam.',
    daerah: [2, 3, 1], intensity: 'extreme', firstMin: 60, peakMin: 360, stageM: 2.5, durationMin: 480,
  },
  {
    id: 'state', label: 'Extreme rain over all Selangor',
    desc: 'A 120 mm/hr stress test over all nine daerah at once.',
    daerah: [1, 2, 3, 4, 5, 6, 7, 8, 9], intensity: 'extreme', firstMin: 30, peakMin: 270, stageM: 3.0, durationMin: 360,
  },
];

export interface FloodSim {
  id: number;              // a new number for every run
  event: FloodEvent;
  onset: Uint16Array;      // minute each cell floods, NEVER if it does not
  bounds: { r0: number; r1: number; c0: number; c1: number }; // rows/cols the rain covers
  peakScore: number;
  /** people per minute of onset (index = minute), for fast "how many under water by t" */
  popByMinute: Float64Array;
  cellsByMinute: Int32Array;
}

function peakScore(model: ModelSpec, intensity: Intensity): number {
  return model.scenarios.find(s => s.key === intensity)!.high;
}

/** Share of the way from first flooding to the peak at which a cell of this score floods. */
function onsetFraction(score: number, peak: number): number {
  return Math.min(1, Math.max(0, (START_SCORE - score) / (START_SCORE - peak)));
}

let runs = 0;

export function simulate(grid: Grid, model: ModelSpec, event: FloodEvent): FloodSim {
  const { width, height } = grid.meta;
  const n = width * height;
  const onset = new Uint16Array(n).fill(NEVER);
  const peak = peakScore(model, event.intensity);
  const peakByte = Math.round(peak * 200);
  const inRain = new Uint8Array(11);
  for (const d of event.daerah) inRain[d] = 1;
  const popByMinute = new Float64Array(event.durationMin + 1);
  const cellsByMinute = new Int32Array(event.durationMin + 1);
  let r0 = height, r1 = -1, c0 = width, c1 = -1;
  const span = event.peakMin - event.firstMin;
  for (let i = 0; i < n; i++) {
    const dz = grid.daerah[i];
    if (!inRain[dz]) continue;
    const r = (i / width) | 0, c = i - r * width;
    if (r < r0) r0 = r; if (r > r1) r1 = r; if (c < c0) c0 = c; if (c > c1) c1 = c;
    const s = grid.score[i];
    if (s > 200 || s < peakByte) continue; // water, outside, or never reached
    const t = Math.round(event.firstMin + span * onsetFraction(s / 200, peak));
    onset[i] = t;
    if (t <= event.durationMin) { popByMinute[t] += grid.pop[i] / 10; cellsByMinute[t]++; }
  }
  return { id: ++runs, event, onset, bounds: { r0, r1, c0, c1 }, peakScore: peak, popByMinute, cellsByMinute };
}

/** Indicative water depth (m) in a flooded cell at minute t. */
export function depthAt(sim: FloodSim, score: number, t: number): number {
  const { firstMin, peakMin, stageM } = sim.event;
  const rise = Math.min(1, Math.max(0, (t - firstMin) / (peakMin - firstMin)));
  return 0.15 + stageM * Math.max(0, rise - onsetFraction(score, sim.peakScore));
}

// ── alert levels (after Japan's 5-level system and JMA's Kikikuru colours) ──
export type Level = 0 | 2 | 3 | 4 | 5;
export const LEVELS: Record<Exclude<Level, 0>, { name: string; action: string; color: string; ink: string; lead: string }> = {
  5: { name: 'Level 5 · Flooding now', action: 'Water has reached this area. Move to a higher floor now; call 999 if trapped.', color: '#0C000C', ink: '#fff', lead: 'flooding' },
  4: { name: 'Level 4 · Evacuate now', action: 'Flooding expected within 1 hour. Everyone leaves for a safe evacuation centre.', color: '#AA00AA', ink: '#fff', lead: '≤ 1 h' },
  3: { name: 'Level 3 · Elderly evacuate', action: 'Flooding expected within 2 hours. Elderly, disabled and their helpers leave now; others prepare.', color: '#FF2800', ink: '#fff', lead: '1–2 h' },
  2: { name: 'Level 2 · Check your plan', action: 'Flooding possible within 3 hours. Check your route and evacuation centre.', color: '#F2E700', ink: '#111', lead: '2–3 h' },
};

export function levelOf(onset: number, t: number): Level {
  if (onset === NEVER) return 0;
  const lead = onset - t;
  return lead <= 0 ? 5 : lead <= 60 ? 4 : lead <= 120 ? 3 : lead <= 180 ? 2 : 0;
}

export interface SimTotals {
  floodedPeople: number;  // living in cells under water at t
  floodedKm2: number;
  level4People: number;   // cells flooding within the next hour
  level3People: number;
  peakPeople: number;     // under water by the end of the drill
}

export function totalsAt(sim: FloodSim, grid: Grid, t: number): SimTotals {
  const P = sim.popByMinute, C = sim.cellsByMinute;
  let fp = 0, fc = 0, l4 = 0, l3 = 0, all = 0;
  for (let m = 0; m < P.length; m++) {
    all += P[m];
    if (m <= t) { fp += P[m]; fc += C[m]; } else if (m <= t + 60) l4 += P[m]; else if (m <= t + 120) l3 += P[m];
  }
  return { floodedPeople: fp, floodedKm2: fc * grid.meta.cell_km2, level4People: l4, level3People: l3, peakPeople: all };
}

// ── place and facility alerts ───────────────────────────────────────────────
export interface PlaceRisk {
  name: string;
  kind: 'place' | 'facility';
  sub: string;            // neighbourhood / school / hospital …
  daerah: string;
  point: LonLat;
  onset: number;          // earliest flooding inside the place
  people: number;         // residents of its cells that flood during the drill
  cells: number;
}

const FAC_LABEL: Record<string, string> = { hospital: 'Hospital', clinic: 'Clinic', school: 'School', police: 'Police', fire: 'Bomba', station: 'Rail station' };

/** Earliest flooding for each named place (its bounding box, capped at ~1.5 km) and facility (its cell). */
export function placeRisks(sim: FloodSim, grid: Grid, places: Place[], facilities: Facility[]): PlaceRisk[] {
  const { meta } = grid;
  const out: PlaceRisk[] = [];
  const cap = 0.007; // half-width cap, degrees
  for (const p of places) {
    if (p.t !== 'neighborhood' && p.t !== 'macrohood' && p.t !== 'locality') continue;
    const [cx, cy] = p.c;
    const x0 = Math.max(p.b[0], cx - cap), x1 = Math.min(p.b[2], cx + cap);
    const y0 = Math.max(p.b[1], cy - cap), y1 = Math.min(p.b[3], cy + cap);
    const c0 = Math.floor((x0 - meta.x0) / meta.res), c1 = Math.floor((x1 - meta.x0) / meta.res);
    const r0 = Math.floor((meta.y1 - y1) / meta.res), r1 = Math.floor((meta.y1 - y0) / meta.res);
    let first = NEVER, people = 0, cells = 0, dz = 0;
    for (let r = Math.max(0, r0); r <= Math.min(meta.height - 1, r1); r++) {
      for (let c = Math.max(0, c0); c <= Math.min(meta.width - 1, c1); c++) {
        const i = r * meta.width + c;
        const o = sim.onset[i];
        if (o === NEVER) continue;
        if (o < first) first = o;
        people += grid.pop[i] / 10;
        cells++;
        dz = grid.daerah[i];
      }
    }
    if (first === NEVER) continue;
    out.push({ name: p.n, kind: 'place', sub: p.t === 'locality' ? 'Town' : 'Neighbourhood', daerah: DAERAH_NAMES[dz - 1] ?? '', point: p.c, onset: first, people, cells });
  }
  for (const f of facilities) {
    const i = cellIndex(meta, f.c[0], f.c[1]);
    if (i < 0 || sim.onset[i] === NEVER) continue;
    out.push({ name: f.n, kind: 'facility', sub: FAC_LABEL[f.k] ?? f.k, daerah: DAERAH_NAMES[f.d - 1] ?? '', point: f.c, onset: sim.onset[i], people: 0, cells: 1 });
  }
  return out.sort((a, b) => a.onset - b.onset || b.people - a.people);
}

/** Earliest flooding within `cells` grid cells of a point (~0.5 km for 2): when its area's warnings start. */
export function areaOnset(sim: FloodSim, grid: Grid, lon: number, lat: number, cells = 2): number {
  const i = cellIndex(grid.meta, lon, lat);
  if (i < 0) return NEVER;
  const { width, height } = grid.meta;
  const r = (i / width) | 0, c = i - r * width;
  let first = NEVER;
  for (let y = Math.max(0, r - cells); y <= Math.min(height - 1, r + cells); y++) {
    for (let x = Math.max(0, c - cells); x <= Math.min(width - 1, c + cells); x++) first = Math.min(first, sim.onset[y * width + x]);
  }
  return first;
}

/** Cell onset at a point, NEVER outside the rain or the flood. */
export function onsetAt(sim: FloodSim, grid: Grid, lon: number, lat: number): number {
  const i = cellIndex(grid.meta, lon, lat);
  return i < 0 ? NEVER : sim.onset[i];
}

export const isWater = (grid: Grid, i: number) => grid.score[i] === SCORE_WATER;

export function fmtClock(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return `T+${h}:${String(m).padStart(2, '0')}`;
}
export function fmtLead(min: number): string {
  if (min <= 0) return 'now';
  if (min < 60) return `in ${Math.round(min)} min`;
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `in ${h} h ${m} min` : `in ${h} h`;
}
