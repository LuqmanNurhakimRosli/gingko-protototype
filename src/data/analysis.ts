// Ginkgo Command Center — light calculations over the precomputed grid.
// Clips layers to a drawn polygon and aggregates them. Nothing here produces a
// susceptibility score: scores come from the pipeline; this only counts cells.

import type {
  Facility, FacilityKind, Grid, GridDetail, GridMeta, ModelSpec, RiskClass, Scenario, ScenarioKey,
} from './types';
import { FEDERAL_TERRITORY, SCORE_OUTSIDE, SCORE_WATER } from './types';

export type LonLat = [number, number];
export type Ring = LonLat[];

export const DAERAH_NAMES = [
  'Sabak Bernam', 'Hulu Selangor', 'Kuala Selangor', 'Gombak', 'Petaling',
  'Klang', 'Kuala Langat', 'Hulu Langat', 'Sepang',
];

/** 3 = High, 2 = Moderate, 1 = Low, 0 = permanent water, -1 = outside.
 *  Compares the stored byte (score × 200) with integer thresholds, exactly as
 *  pipeline/03_model.py classify() does, so the two always agree. */
export function classOf(scoreByte: number, sc: Scenario): number {
  if (scoreByte === SCORE_OUTSIDE) return -1;
  if (scoreByte === SCORE_WATER) return 0;
  return scoreByte >= Math.round(sc.high * 200) ? 3 : scoreByte >= Math.round(sc.moderate * 200) ? 2 : 1;
}

export const CLASS_NAME: Record<number, RiskClass | 'Water' | 'Outside'> = {
  3: 'High', 2: 'Moderate', 1: 'Low', 0: 'Water', [-1]: 'Outside',
};

export function cellIndex(meta: GridMeta, lon: number, lat: number): number {
  const c = Math.floor((lon - meta.x0) / meta.res);
  const r = Math.floor((meta.y1 - lat) / meta.res);
  if (c < 0 || r < 0 || c >= meta.width || r >= meta.height) return -1;
  return r * meta.width + c;
}

export function cellCenter(meta: GridMeta, idx: number): LonLat {
  const r = Math.floor(idx / meta.width);
  const c = idx % meta.width;
  return [meta.x0 + (c + 0.5) * meta.res, meta.y1 - (r + 0.5) * meta.res];
}

/** Cells whose centre lies inside the polygon (even–odd rule, so holes work). */
export function rasterizePolygon(meta: GridMeta, rings: Ring[]): Int32Array {
  let minY = Infinity, maxY = -Infinity;
  for (const ring of rings) for (const [, y] of ring) { minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
  const r0 = Math.max(0, Math.floor((meta.y1 - maxY) / meta.res));
  const r1 = Math.min(meta.height - 1, Math.ceil((meta.y1 - minY) / meta.res));
  const out: number[] = [];
  const xs: number[] = [];
  for (let r = r0; r <= r1; r++) {
    const y = meta.y1 - (r + 0.5) * meta.res;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
      }
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.ceil((xs[k] - meta.x0) / meta.res - 0.5));
      const c1 = Math.min(meta.width - 1, Math.floor((xs[k + 1] - meta.x0) / meta.res - 0.5));
      for (let c = c0; c <= c1; c++) out.push(r * meta.width + c);
    }
  }
  return Int32Array.from(out);
}

/** Geodesic polygon area in km² (spherical excess; same approach as turf/area). */
export function polygonAreaKm2(rings: Ring[]): number {
  const R = 6378137;
  const rad = Math.PI / 180;
  let total = 0;
  rings.forEach((ring, k) => {
    let a = 0;
    for (let i = 0; i < ring.length; i++) {
      const [x1, y1] = ring[i];
      const [x2, y2] = ring[(i + 1) % ring.length];
      a += (x2 - x1) * rad * (2 + Math.sin(y1 * rad) + Math.sin(y2 * rad));
    }
    a = Math.abs((a * R * R) / 2);
    total += k === 0 ? a : -a;
  });
  return total / 1e6;
}

// ── model terms (same transforms as pipeline/03_model.py, read from model.json) ──
export interface TermValues { hand: number; prox: number; flat: number; elev: number; hist: number }

export function termValues(model: ModelSpec, x: { hand_m: number; river_m: number; slope_deg: number; elev_m: number; hist_share: number }): TermValues {
  const t = Object.fromEntries(model.terms.map(m => [m.key, m]));
  return {
    hand: Math.exp(-x.hand_m / (t.hand.scale_m ?? 5)),
    prox: Math.exp(-x.river_m / (t.prox.scale_m ?? 1500)),
    flat: 1 - Math.min(x.slope_deg / (t.flat.scale_deg ?? 8), 1),
    elev: 1 - Math.min(Math.max(x.elev_m, 0) / (t.elev.scale_m ?? 50), 1),
    hist: Math.min(x.hist_share / (t.hist.scale_share ?? 0.25), 1),
  };
}

// ── area report ───────────────────────────────────────────────────────────
export interface ClassBreakdown {
  high_km2: number; moderate_km2: number; low_km2: number;
  high_pct: number; moderate_pct: number; low_pct: number;
  zones: number; pop_high: number; pop_moderate: number;
}

export interface AreaDetail {
  elev_min: number; elev_max: number; elev_median: number;
  hand_median: number; slope_mean: number; river_dist_median: number;
  landcover: { built: number; tree: number; crop: number; water: number; other: number };
  why: { key: keyof TermValues; label: string; weight: number; mean: number; contribution: number; input: string }[];
  why_sum: number;
  candidate_km2: number;
}

export interface AreaReport {
  polygon_km2: number;
  analysed_km2: number;
  land_km2: number;
  water_km2: number;
  outside_km2: number;
  federal_km2: number;
  daerah: { id: number; name: string; km2: number }[];
  scenarios: Record<ScenarioKey, ClassBreakdown>;
  score_mean: number;
  population: number;
  built_pct: number;
  built_km2: number;
  river_km: number;
  hist_pct: number;
  cell_count: number;
  detail: AreaDetail | null;
}

/** Median of a typed array (sorts it in place — callers pass scratch arrays). */
function median(a: Float32Array): number {
  if (!a.length) return NaN;
  a.sort();
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** 8-connected High clusters of at least `minCells` cells.
 *  Typed-array mask + explicit stack: a whole-state call touches ~250k cells. */
function countZones(meta: GridMeta, cells: Int32Array, isHigh: Uint8Array, minCells: number): number {
  const { width: w, height: h } = meta;
  const mask = new Uint8Array(w * h);           // 1 = High & unvisited
  let nHigh = 0;
  for (let i = 0; i < cells.length; i++) if (isHigh[i]) { mask[cells[i]] = 1; nHigh++; }
  const stack = new Int32Array(nHigh);
  let zones = 0;
  for (let i = 0; i < cells.length; i++) {
    const start = cells[i];
    if (!mask[start]) continue;
    let size = 0, top = 0;
    stack[top++] = start;
    mask[start] = 0;
    while (top) {
      const p = stack[--top];
      size++;
      const r = (p / w) | 0, c = p - r * w;
      for (let dr = -1; dr <= 1; dr++) {
        const rr = r + dr;
        if (rr < 0 || rr >= h) continue;
        for (let dc = -1; dc <= 1; dc++) {
          const cc = c + dc;
          if (cc < 0 || cc >= w) continue;
          const q = rr * w + cc;
          if (mask[q]) { mask[q] = 0; stack[top++] = q; }
        }
      }
    }
    if (size >= minCells) zones++;
  }
  return zones;
}

export function analyseCells(grid: Grid, model: ModelSpec, cells: Int32Array, polygon_km2: number): AreaReport {
  const { meta } = grid;
  const k = meta.cell_km2;
  const d: GridDetail | undefined = grid.detail;
  const land: number[] = [];
  let water = 0, outside = 0, federal = 0;
  const perDaerah = new Map<number, number>();
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i];
    const dz = grid.daerah[p];
    if (dz === FEDERAL_TERRITORY) { federal++; continue; }
    if (dz < 1 || dz > 9) { outside++; continue; }
    perDaerah.set(dz, (perDaerah.get(dz) ?? 0) + 1);
    if (grid.score[p] === SCORE_WATER) water++; else land.push(p);
  }
  const landCells = Int32Array.from(land);
  const nLand = landCells.length;

  const scenarios = {} as Record<ScenarioKey, ClassBreakdown>;
  for (const sc of model.scenarios) {
    let h = 0, m = 0, l = 0, ph = 0, pm = 0;
    const isHigh = new Uint8Array(nLand);
    for (let i = 0; i < nLand; i++) {
      const p = landCells[i];
      const c = classOf(grid.score[p], sc);
      if (c === 3) { h++; ph += grid.pop[p]; isHigh[i] = 1; }
      else if (c === 2) { m++; pm += grid.pop[p]; }
      else l++;
    }
    scenarios[sc.key] = {
      high_km2: h * k, moderate_km2: m * k, low_km2: l * k,
      high_pct: nLand ? (100 * h) / nLand : 0,
      moderate_pct: nLand ? (100 * m) / nLand : 0,
      low_pct: nLand ? (100 * l) / nLand : 0,
      zones: countZones(meta, landCells, isHigh, model.zone_min_km2 / k),
      pop_high: ph / 10, pop_moderate: pm / 10,
    };
  }

  let pop = 0, built = 0, riv = 0, hist = 0, score = 0;
  for (const p of landCells) { score += grid.score[p] / 200; hist += grid.hist[p] > 0 ? 1 : 0; }
  // population, built-up, land cover and river length count every Selangor cell
  // (water included), so "built-up" means the same number everywhere it appears
  let tree = 0, crop = 0, wat = 0;
  for (let i = 0; i < cells.length; i++) {
    const p = cells[i];
    const dz = grid.daerah[p];
    if (dz < 1 || dz > 9) continue;
    pop += grid.pop[p] / 10;
    built += grid.built[p] / 100;
    riv += grid.river_len[p];
    if (d) { tree += d.tree[p] / 100; crop += d.crop[p] / 100; wat += d.water[p] / 100; }
  }
  const nSel = nLand + water;

  let detail: AreaDetail | null = null;
  if (d && nLand) {
    // no spreading into Math.min/max: a whole daerah is >100k cells
    const elev = new Float32Array(nLand), hand = new Float32Array(nLand), dist = new Float32Array(nLand);
    let elevMin = Infinity, elevMax = -Infinity, k2 = 0;
    let slope = 0, cand = 0;
    const tsum = { hand: 0, prox: 0, flat: 0, elev: 0, hist: 0 };
    for (const p of landCells) {
      const e = d.elev[p], hm = d.hand[p] / 10, rd = d.river_dist[p], sl = d.slope[p] / 4;
      elev[k2] = e; hand[k2] = hm; dist[k2] = rd; k2++;
      if (e < elevMin) elevMin = e;
      if (e > elevMax) elevMax = e;
      slope += sl;
      const tv = termValues(model, { hand_m: hm, river_m: rd, slope_deg: sl, elev_m: e, hist_share: grid.hist[p] / 100 });
      tsum.hand += tv.hand; tsum.prox += tv.prox; tsum.flat += tv.flat; tsum.elev += tv.elev; tsum.hist += tv.hist;
      // screening only: Low class, gentle slope, not built, not water, not forest-dominated
      if (isCandidateCell(grid, model, p)) cand++;
    }
    const handMed = median(hand), distMed = median(dist), elevMed = median(elev);
    const inputs: Record<string, string> = {
      hand: `median ${handMed.toFixed(1)} m above drainage`,
      prox: `median ${Math.round(distMed).toLocaleString()} m to a river or canal`,
      flat: `mean slope ${(slope / nLand).toFixed(1)}°`,
      elev: `median ${Math.round(elevMed)} m above sea level`,
      hist: `${((100 * hist) / nLand).toFixed(0)}% of cells seen as water 1984–2021`,
    };
    const why = model.terms.map(t => {
      const mean = tsum[t.key] / nLand;
      return { key: t.key, label: t.label, weight: t.weight, mean, contribution: mean * t.weight, input: inputs[t.key] };
    });
    detail = {
      elev_min: elevMin, elev_max: elevMax, elev_median: elevMed,
      hand_median: handMed, slope_mean: slope / nLand, river_dist_median: distMed,
      landcover: {
        built: built / nSel, tree: tree / nSel, crop: crop / nSel, water: wat / nSel,
        other: Math.max(0, 1 - (built + tree + crop + wat) / nSel),
      },
      why, why_sum: why.reduce((a, b) => a + b.contribution, 0),
      candidate_km2: cand * k,
    };
  }

  return {
    polygon_km2,
    analysed_km2: nSel * k,
    land_km2: nLand * k,
    water_km2: water * k,
    outside_km2: outside * k,
    federal_km2: federal * k,
    daerah: [...perDaerah.entries()].sort((a, b) => b[1] - a[1])
      .map(([id, n]) => ({ id, name: DAERAH_NAMES[id - 1], km2: n * k })),
    scenarios,
    score_mean: nLand ? score / nLand : 0,
    population: pop,
    built_pct: nSel ? (100 * built) / nSel : 0,
    built_km2: built * k,
    river_km: riv / 1000,
    hist_pct: nLand ? (100 * hist) / nLand : 0,
    cell_count: nSel,
    detail,
  };
}

export function analysePolygon(grid: Grid, model: ModelSpec, rings: Ring[]): AreaReport {
  return analyseCells(grid, model, rasterizePolygon(grid.meta, rings), polygonAreaKm2(rings));
}

// ── single-cell query (map click) ─────────────────────────────────────────
export interface CellInfo {
  idx: number;
  lonlat: LonLat;
  daerah: string | null;
  federal: boolean;
  scoreByte: number;
  score: number | null;
  cls: Record<ScenarioKey, number>;
  pop: number;
  built: number;
  hist: number;
  hand?: number; river_m?: number; slope?: number; elev?: number;
  terms?: TermValues;
}

export function queryCell(grid: Grid, model: ModelSpec, lon: number, lat: number): CellInfo | null {
  const idx = cellIndex(grid.meta, lon, lat);
  if (idx < 0) return null;
  const dz = grid.daerah[idx];
  if (dz === 0) return null;
  const sb = grid.score[idx];
  const cls = {} as Record<ScenarioKey, number>;
  for (const sc of model.scenarios) cls[sc.key] = classOf(sb, sc);
  const info: CellInfo = {
    idx, lonlat: [lon, lat],
    daerah: dz >= 1 && dz <= 9 ? DAERAH_NAMES[dz - 1] : null,
    federal: dz === FEDERAL_TERRITORY,
    scoreByte: sb,
    score: sb <= 200 ? sb / 200 : null,
    cls, pop: grid.pop[idx] / 10, built: grid.built[idx], hist: grid.hist[idx],
  };
  const d = grid.detail;
  if (d) {
    info.hand = d.hand[idx] / 10; info.river_m = d.river_dist[idx];
    info.slope = d.slope[idx] / 4; info.elev = d.elev[idx];
    info.terms = termValues(model, { hand_m: info.hand, river_m: info.river_m, slope_deg: info.slope, elev_m: info.elev, hist_share: info.hist / 100 });
  }
  return info;
}

// ── facilities ────────────────────────────────────────────────────────────
export const FACILITY_KINDS: FacilityKind[] = ['hospital', 'clinic', 'school', 'police', 'fire', 'station'];

export interface FacilityExposure {
  kind: FacilityKind;
  total: number;
  high: number;
  moderate: number;
  /** names of facilities in High cells, alphabetical, for display */
  highNames: string[];
}

/** Facilities whose grid cell is one of `cells` (e.g. a drawn polygon). */
export function facilitiesInCells(meta: GridMeta, items: Facility[], cells: Int32Array): Facility[] {
  const set = new Set<number>(cells);
  return items.filter(f => set.has(cellIndex(meta, f.c[0], f.c[1])));
}

export function facilityExposure(items: Facility[], sc: Scenario): FacilityExposure[] {
  return FACILITY_KINDS.map(kind => {
    const of = items.filter(f => f.k === kind);
    const high = of.filter(f => classOf(f.s, sc) === 3);
    return {
      kind,
      total: of.length,
      high: high.length,
      moderate: of.filter(f => classOf(f.s, sc) === 2).length,
      highNames: high.map(f => f.n).sort((a, b) => a.localeCompare(b)),
    };
  });
}

/** Low susceptibility (Normal by default), gentle, undeveloped, not water, not
 *  forest-dominated — the same screen as AreaDetail.candidate_km2. Needs terrain detail. */
export function isCandidateCell(grid: Grid, model: ModelSpec, i: number, lowUnder: Scenario = model.scenarios[0]): boolean {
  const d = grid.detail;
  if (!d) return false;
  const dz = grid.daerah[i];
  if (dz < 1 || dz > 9) return false;
  return classOf(grid.score[i], lowUnder) === 1 && d.slope[i] / 4 < 12 && grid.built[i] < 20
    && d.water[i] < 20 && d.tree[i] < 50;
}

export interface CandidateSite {
  /** 1-based rank (largest first) */
  rank: number;
  cells: Int32Array;
  area_km2: number;
  /** a cell of the site near its middle (always inside the site) */
  centre: LonLat;
  daerah: string | null;
  score_mean: number;
  slope_mean: number;
  hand_median: number;
  /** distance from the centre to the nearest High cell under the screening scenario; null if none within ~5.5 km */
  nearest_high_m: number | null;
}

/** Contiguous blocks of screened candidate land inside `scope`, largest first.
 *  A block must stay Low under `lowUnder` (pick Extreme for a robust screen) and
 *  be at least `minKm2`. Same screen as isCandidateCell; 8-connected. */
export function findCandidateSites(grid: Grid, model: ModelSpec, scope: Int32Array, lowUnder: Scenario, minKm2: number, max: number): CandidateSite[] {
  const d = grid.detail;
  if (!d) return [];
  const { width, height, cell_km2, cell_m } = grid.meta;
  const mask = new Uint8Array(width * height);
  for (const i of scope) if (isCandidateCell(grid, model, i, lowUnder)) mask[i] = 1;
  const minCells = Math.max(1, Math.ceil(minKm2 / cell_km2));
  const comps: number[][] = [];
  const queue = new Int32Array(scope.length || 1);
  for (const start of scope) {
    if (mask[start] !== 1) continue;
    let head = 0, tail = 0;
    queue[tail++] = start;
    mask[start] = 2;
    const comp: number[] = [];
    while (head < tail) {
      const i = queue[head++];
      comp.push(i);
      const r = Math.floor(i / width), c = i % width;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= height || cc >= width) continue;
        const j = rr * width + cc;
        if (mask[j] === 1) { mask[j] = 2; queue[tail++] = j; }
      }
    }
    if (comp.length >= minCells) comps.push(comp);
  }
  comps.sort((a, b) => b.length - a.length);
  const highStep = Math.round(lowUnder.high * 200);
  return comps.slice(0, max).map((comp, k) => {
    let sr = 0, sc = 0, score = 0, slope = 0;
    const hand = new Float32Array(comp.length);
    comp.forEach((i, n) => {
      sr += Math.floor(i / width); sc += i % width;
      score += grid.score[i] / 200; slope += d.slope[i] / 4; hand[n] = d.hand[i] / 10;
    });
    const mr = sr / comp.length, mc = sc / comp.length;
    let centre = comp[0], best = Infinity;
    for (const i of comp) {
      const dd = (Math.floor(i / width) - mr) ** 2 + (i % width - mc) ** 2;
      if (dd < best) { best = dd; centre = i; }
    }
    // nearest High cell from the centre, searching outward ring by ring
    const cr = Math.floor(centre / width), cc = centre % width;
    let nearest: number | null = null;
    for (let rad = 1; rad <= 60 && nearest === null; rad++) {
      for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const rr = cr + dr, c2 = cc + dc;
        if (rr < 0 || c2 < 0 || rr >= height || c2 >= width) continue;
        const j = rr * width + c2, s = grid.score[j];
        if (s === SCORE_OUTSIDE || s === SCORE_WATER || s < highStep) continue;
        const m = Math.hypot(dr * cell_m[1], dc * cell_m[0]);
        if (nearest === null || m < nearest) nearest = m;
      }
    }
    const dz = grid.daerah[centre];
    return {
      rank: k + 1,
      cells: Int32Array.from(comp),
      area_km2: comp.length * cell_km2,
      centre: cellCenter(grid.meta, centre),
      daerah: dz >= 1 && dz <= 9 ? DAERAH_NAMES[dz - 1] : null,
      score_mean: score / comp.length,
      slope_mean: slope / comp.length,
      hand_median: median(hand),
      nearest_high_m: nearest === null ? null : Math.round(nearest / 10) * 10,
    };
  });
}
