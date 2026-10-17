// Ginkgo flood drill — evacuation routing on the road graph.
// Time-aware: a road is closed once the simulated flood reaches the lowest
// point along it before the evacuee gets there. Evacuation centres are
// skipped when they will flood, or will be full by the time you arrive.

import type { LonLat } from '../data/analysis';
import { NEVER } from './flood';
import { edgeShape, metres, nearestNode, roadName, type RoadGraph } from './graph';

export type Mode = 'walk' | 'drive';
export const WALK_KMH = 4.5;
/** Driving in heavy rain: class speed × 0.6, never under 15 km/h. */
export const RAIN_FACTOR = 0.6;
/** A road must stay dry this long after you pass it. */
export const MARGIN_MIN = 10;

/** Minutes to travel edge e. Infinity when the mode may not use it. */
export function edgeMinutes(g: RoadGraph, e: number, mode: Mode): number {
  if (mode === 'walk') return g.cls[e] === 0 ? Infinity : g.len[e] / (WALK_KMH * 1000 / 60);
  const kmh = Math.max(15, g.meta.classes[g.cls[e]].kmh * RAIN_FACTOR);
  return g.len[e] / (kmh * 1000 / 60);
}

// ── binary min-heap over (key, node) ────────────────────────────────────────
export class Heap {
  private k: Float64Array; private v: Int32Array; size = 0;
  constructor(cap = 1024) { this.k = new Float64Array(cap); this.v = new Int32Array(cap); }
  push(key: number, val: number) {
    if (this.size === this.k.length) {
      const k = new Float64Array(this.size * 2); k.set(this.k); this.k = k;
      const v = new Int32Array(this.size * 2); v.set(this.v); this.v = v;
    }
    let i = this.size++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.k[p] <= key) break;
      this.k[i] = this.k[p]; this.v[i] = this.v[p]; i = p;
    }
    this.k[i] = key; this.v[i] = val;
  }
  peekKey() { return this.k[0]; }
  pop(): number {
    const top = this.v[0];
    const key = this.k[--this.size], val = this.v[this.size];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.size) break;
      if (c + 1 < this.size && this.k[c + 1] < this.k[c]) c++;
      if (this.k[c] >= key) break;
      this.k[i] = this.k[c]; this.v[i] = this.v[c]; i = c;
    }
    this.k[i] = key; this.v[i] = val;
    return top;
  }
}

export interface ShelterNode { id: number; node: number; snapM: number }
export interface ShelterIndex { byNode: Map<number, number[]>; nodeOf: Int32Array; snapM: Float32Array }

/** Snap every evacuation centre to its nearest junction. */
export function indexShelters(g: RoadGraph, points: LonLat[]): ShelterIndex {
  const byNode = new Map<number, number[]>();
  const nodeOf = new Int32Array(points.length).fill(-1);
  const snapM = new Float32Array(points.length);
  points.forEach(([lon, lat], id) => {
    const v = nearestNode(g, lon, lat, 800);
    if (v < 0) return;
    nodeOf[id] = v;
    snapM[id] = metres(lon, lat, g.lon[v], g.lat[v]);
    const l = byNode.get(v);
    if (l) l.push(id); else byNode.set(v, [id]);
  });
  return { byNode, nodeOf, snapM };
}

export interface RouteQuery {
  origin: LonLat;
  departMin: number;              // drill clock when you leave
  mode: Mode;
  edgeOnset: (e: number) => number;      // minute the road floods (NEVER if not)
  originOnset: number;            // minute the start point floods
  /** Can this centre take you if you arrive at minute t? */
  accepts: (shelter: number, t: number) => boolean;
  maxMinutes?: number;
  alternatives?: number;
}

export interface RouteStep { name: string; metres: number }
export interface Route {
  shelter: number;
  metres: number;
  minutes: number;
  arriveMin: number;
  path: LonLat[];
  edges: number[];
  steps: RouteStep[];
  wadeMetres: number;             // distance through water already standing at departure
}
export interface RouteResult {
  ok: boolean;
  reason?: string;
  startNode: number;
  snapMetres: number;
  routes: Route[];               // best first
  startFlooded: boolean;
  /** every centre within reach is full on arrival; the nearest open ones are shown anyway */
  full?: boolean;
}

/**
 * Time-aware Dijkstra from the origin. A road is usable if it stays dry until
 * MARGIN_MIN after you would leave it. If you start in water, roads already
 * flooded within ~600 m are allowed at a heavy cost (wading) so the route can
 * get you out; that distance is reported.
 */
export function routeToShelter(g: RoadGraph, sh: ShelterIndex, q: RouteQuery): RouteResult {
  const maxMin = q.maxMinutes ?? (q.mode === 'walk' ? 120 : 60);
  const want = 1 + (q.alternatives ?? 2);
  const startFlooded = q.originOnset <= q.departMin;
  const start = nearestNode(g, q.origin[0], q.origin[1], 1500, v => g.adjStart[v + 1] > g.adjStart[v]);
  if (start < 0) return { ok: false, reason: 'No road within 1.5 km of this point.', startNode: -1, snapMetres: 0, routes: [], startFlooded };
  const snap = metres(q.origin[0], q.origin[1], g.lon[start], g.lat[start]);
  const snapMin = snap / (WALK_KMH * 1000 / 60);

  const n = g.n;
  const time = new Float64Array(n).fill(Infinity);   // minutes travelled (wading counted at true time)
  const cost = new Float64Array(n).fill(Infinity);   // search cost (wading penalised)
  const dist = new Float64Array(n);
  const wade = new Float64Array(n);
  const prevE = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  cost[start] = 0; time[start] = snapMin; dist[start] = snap;
  heap.push(0, start);
  const found: { s: number; v: number }[] = [];
  const seen = new Set<number>();
  const WADE_LIMIT = 600;

  while (heap.size && found.length < want) {
    const c = heap.peekKey();
    const u = heap.pop();
    if (done[u] || c > cost[u]) continue;
    done[u] = 1;
    if (time[u] > maxMin) break;
    const here = sh.byNode.get(u);
    if (here) {
      for (const s of here) {
        if (seen.has(s)) continue;
        const arrive = q.departMin + time[u] + sh.snapM[s] / (WALK_KMH * 1000 / 60);
        if (q.accepts(s, arrive)) { seen.add(s); found.push({ s, v: u }); }
      }
    }
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const e = g.adjEdge[k], v = g.adjNode[k];
      if (done[v]) continue;
      const dt = edgeMinutes(g, e, q.mode);
      if (dt === Infinity) continue;
      const leave = q.departMin + time[u] + dt;
      const on = q.edgeOnset(e);
      let w = dt, wading = 0;
      if (on !== NEVER && on <= leave + MARGIN_MIN) {
        // flooded before you are clear of it: only allowed as a short wade out of water you started in
        if (!(startFlooded && on <= q.departMin && wade[u] + g.len[e] <= WADE_LIMIT)) continue;
        wading = g.len[e];
        w = dt * 6;
      }
      const nc = cost[u] + w;
      if (nc < cost[v]) {
        cost[v] = nc; time[v] = time[u] + dt * (wading ? 2 : 1); dist[v] = dist[u] + g.len[e];
        wade[v] = wade[u] + wading; prevE[v] = e;
        heap.push(nc, v);
      }
    }
  }
  if (!found.length) {
    return {
      ok: false, startNode: start, snapMetres: snap, routes: [], startFlooded,
      reason: startFlooded
        ? 'This spot is already under water and no dry road leads out. Move to a higher floor and call 999 (or 991 for Civil Defence).'
        : `No evacuation centre with space can be reached within ${maxMin} min by ${q.mode === 'walk' ? 'foot' : 'car'} before the roads flood.`,
    };
  }
  const routes = found.map(({ s, v }) => {
    const edges: number[] = [];
    const nodes: number[] = [v];
    for (let x = v; prevE[x] >= 0;) {
      const e = prevE[x];
      edges.push(e);
      x = g.ea[e] === x ? g.eb[e] : g.ea[e];
      nodes.push(x);
    }
    edges.reverse(); nodes.reverse();
    const path: LonLat[] = [q.origin, [g.lon[start], g.lat[start]]];
    const steps: RouteStep[] = [];
    edges.forEach((e, i) => {
      const pts = edgeShape(g, e, nodes[i]);
      path.push(...pts.slice(1));
      const name = roadName(g, e) ?? 'unnamed road';
      const last = steps[steps.length - 1];
      if (last && last.name === name) last.metres += g.len[e]; else steps.push({ name, metres: g.len[e] });
    });
    const snapS = sh.snapM[s];
    const minutes = time[v] + snapS / (WALK_KMH * 1000 / 60);
    return {
      shelter: s, metres: dist[v] + snapS, minutes, arriveMin: q.departMin + minutes,
      path, edges, steps: mergeShortSteps(steps), wadeMetres: wade[v],
    };
  });
  return { ok: true, startNode: start, snapMetres: snap, routes, startFlooded };
}

/** Fold steps under 60 m into their neighbours so directions read cleanly. */
function mergeShortSteps(steps: RouteStep[]): RouteStep[] {
  const out: RouteStep[] = [];
  for (const s of steps) {
    const last = out[out.length - 1];
    if (last && (s.metres < 60 || last.name === s.name)) last.metres += s.metres;
    else out.push({ ...s });
  }
  return out;
}

/**
 * Multi-source search from open centres: for each junction, its K nearest
 * reachable centres by road distance (on foot: no motorways). Roads closed by
 * `closed(e)` are skipped; junctions outside the box are not expanded.
 * Slot j of junction v is at v*K + j; `count[v]` slots are filled, nearest first.
 */
export function nearestCentres(
  g: RoadGraph, seeds: { node: number; shelter: number; startM: number }[], closed: (e: number) => boolean,
  maxM: number, K: number, box?: [number, number, number, number],
): { label: Int32Array; dist: Float32Array; count: Uint8Array } {
  const label = new Int32Array(g.n * K).fill(-1);
  const dist = new Float32Array(g.n * K).fill(Infinity);
  const count = new Uint8Array(g.n);
  // heap entries point into growable (node, centre) arrays
  let en = new Int32Array(1 << 16), es = new Int32Array(1 << 16), top = 0;
  const heap = new Heap(1 << 16);
  const push = (d: number, v: number, s: number) => {
    if (top === en.length) {
      const a = new Int32Array(top * 2); a.set(en); en = a;
      const b = new Int32Array(top * 2); b.set(es); es = b;
    }
    en[top] = v; es[top] = s; heap.push(d, top++);
  };
  for (const s of seeds) push(s.startM, s.node, s.shelter);
  const has = (v: number, s: number) => {
    for (let j = 0; j < count[v]; j++) if (label[v * K + j] === s) return true;
    return false;
  };
  while (heap.size) {
    const d = heap.peekKey();
    const x = heap.pop();
    const u = en[x], s = es[x];
    if (count[u] >= K || has(u, s)) continue;
    label[u * K + count[u]] = s; dist[u * K + count[u]] = d; count[u]++;
    if (box && (g.lon[u] < box[0] || g.lon[u] > box[2] || g.lat[u] < box[1] || g.lat[u] > box[3])) continue;
    for (let k = g.adjStart[u]; k < g.adjStart[u + 1]; k++) {
      const e = g.adjEdge[k], v = g.adjNode[k];
      if (count[v] >= K || g.cls[e] === 0 || closed(e)) continue;
      const nd = d + g.len[e];
      if (nd <= maxM && !has(v, s)) push(nd, v, s);
    }
  }
  return { label, dist, count };
}
