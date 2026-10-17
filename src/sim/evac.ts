// Ginkgo flood drill — who goes to which evacuation centre, and when they fill.
//
// Assumptions (shown in the app):
//  · evacuation orders go out by zone (~740 m squares, like a district order):
//    everyone in a zone whose home will flood leaves when the zone reaches
//    Level 4 — an hour before its first cell floods — or at once if that has passed;
//  · 15% go to a public evacuation centre; the rest go to family or friends or
//    move upstairs (in Dec 2021 about 15,000 people were in Selangor's centres
//    at once, and many in Taman Sri Muda stayed home) — set by EVAC.share;
//  · they walk to the nearest centre that is open and has space, by road,
//    avoiding roads that flood within the hour; if the nearest is full they
//    try the next, up to the 6 nearest within 12 km;
//  · a centre stops taking people an hour before its own cell floods, and when full.
// Anyone with no reachable centre with space is counted as needing rescue.

import type { Grid } from '../data/types';
import type { LonLat } from '../data/analysis';
import { NEVER, type FloodSim } from './flood';
import { metres, nearestNode, type RoadGraph } from './graph';
import { WALK_KMH, nearestCentres, type ShelterIndex } from './route';

export type ShelterKind = 'school' | 'hall' | 'mosque' | 'sports';
export interface Shelter {
  id: number;
  k: ShelterKind;
  n: string;
  c: LonLat;
  d: number;
  s: number;            // score byte of its cell
  safe: 'low' | 'moderate';
  cap: number;          // people
  fp: number;           // footprint m² used for the estimate
  nb: number;           // buildings summed
  est: 'footprint' | 'type default';
  hand: number;         // m above drainage
  elev: number;         // m
}
export interface SheltersFile {
  source: string;
  retrieved: string;
  note: string;
  m2_per_person: number;
  kinds: Record<ShelterKind, string>;
  items: Shelter[];
}

export const EVAC = { share: 0.15, warnMin: 60, binMin: 20, windowMin: 60, stepMin: 5, maxKm: 12, blockCells: 4, zoneCells: 8, choices: 6 };

export interface EvacPlan {
  stepMin: number;
  steps: number;
  occ: Float32Array[];        // per centre: people inside at each step
  closeAt: Float64Array;      // per centre: minute it stops taking people (Infinity if never)
  fullAt: Float64Array;       // per centre: minute it fills (Infinity if never)
  departed: Float32Array;     // people who have left for a centre, by step
  arrived: Float32Array;      // people inside centres, by step
  rescue: Float32Array;       // people with no reachable centre with space, by step
  ms: number;                 // compute time
}

export function closingTimes(sim: FloodSim, grid: Grid, shelters: Shelter[]): Float64Array {
  const out = new Float64Array(shelters.length);
  const { meta } = grid;
  shelters.forEach((s, i) => {
    const c = Math.floor((s.c[0] - meta.x0) / meta.res), r = Math.floor((meta.y1 - s.c[1]) / meta.res);
    const o = sim.onset[r * meta.width + c];
    out[i] = o === NEVER ? Infinity : o - EVAC.warnMin;
  });
  return out;
}

export function planEvacuation(
  sim: FloodSim, grid: Grid, g: RoadGraph, sh: ShelterIndex, shelters: Shelter[], edgeOnset: (e: number) => number,
): EvacPlan {
  const t0 = performance.now();
  const { meta } = grid;
  const { r0, r1, c0, c1 } = sim.bounds;
  const dur = sim.event.durationMin;
  const B = EVAC.blockCells;
  const bw = Math.ceil((c1 - c0 + 1) / B);
  const nbins = Math.floor(dur / EVAC.binMin) + 1;

  // each zone's order time: an hour before its first cell floods
  const Z = EVAC.zoneCells;
  const zw = Math.ceil((c1 - c0 + 1) / Z);
  const zoneFirst = new Uint16Array(zw * Math.ceil((r1 - r0 + 1) / Z)).fill(NEVER);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const o = sim.onset[r * meta.width + c];
      const z = Math.floor((r - r0) / Z) * zw + Math.floor((c - c0) / Z);
      if (o < zoneFirst[z]) zoneFirst[z] = o;
    }
  }
  // demand: people per (departure bin, ~370 m block), with a population-weighted centre
  const demand = new Map<number, { bin: number; people: number; x: number; y: number }>();
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * meta.width + c;
      const o = sim.onset[i];
      if (o === NEVER || o > dur) continue;
      const p = (grid.pop[i] / 10) * EVAC.share;
      if (p <= 0) continue;
      const first = zoneFirst[Math.floor((r - r0) / Z) * zw + Math.floor((c - c0) / Z)];
      const bin = Math.floor(Math.max(0, first - EVAC.warnMin) / EVAC.binMin);
      const key = bin * 1e7 + Math.floor((r - r0) / B) * bw + Math.floor((c - c0) / B);
      const lon = meta.x0 + (c + 0.5) * meta.res, lat = meta.y1 - (r + 0.5) * meta.res;
      const d = demand.get(key);
      if (d) { d.people += p; d.x += lon * p; d.y += lat * p; } else demand.set(key, { bin, people: p, x: lon * p, y: lat * p });
    }
  }
  const byBin: { node: number; people: number; lon: number; lat: number }[][] = Array.from({ length: nbins }, () => []);
  for (const d of demand.values()) {
    const lon = d.x / d.people, lat = d.y / d.people;
    byBin[Math.min(nbins - 1, d.bin)].push({ node: nearestNode(g, lon, lat, 1500), people: d.people, lon, lat });
  }

  const closeAt = closingTimes(sim, grid, shelters);
  const remaining = Float64Array.from(shelters, s => s.cap);
  const fullAt = new Float64Array(shelters.length).fill(Infinity);
  const arrivals: { s: number; t: number; p: number }[] = [];
  const steps = Math.floor(dur / EVAC.stepMin) + 1;
  const departed = new Float32Array(steps), rescue = new Float32Array(steps);
  const toStep = (t: number) => Math.min(steps - 1, Math.max(0, Math.ceil(t / EVAC.stepMin)));
  const pad = 0.08;
  const box: [number, number, number, number] = [
    meta.x0 + c0 * meta.res - pad, meta.y1 - (r1 + 1) * meta.res - pad,
    meta.x0 + (c1 + 1) * meta.res + pad, meta.y1 - r0 * meta.res + pad,
  ];
  const mPerMin = WALK_KMH * 1000 / 60;
  const K = EVAC.choices;
  const perWindow = Math.round(EVAC.windowMin / EVAC.binMin);

  // Road closures are refreshed every window (an hour): a road counts as closed
  // for the whole window if it floods before the window ends.
  for (let w0 = 0; w0 < nbins; w0 += perWindow) {
    const tw = w0 * EVAC.binMin;
    const bins = byBin.slice(w0, w0 + perWindow);
    if (!bins.some(b => b.length)) continue;
    const seeds = [];
    for (let s = 0; s < shelters.length; s++) {
      if (sh.nodeOf[s] < 0 || remaining[s] < 1 || closeAt[s] <= tw) continue;
      seeds.push({ node: sh.nodeOf[s], shelter: s, startM: sh.snapM[s] });
    }
    const near = seeds.length
      ? nearestCentres(g, seeds, e => edgeOnset(e) <= tw + EVAC.windowMin, EVAC.maxKm * 1000, K, box)
      : null;
    bins.forEach((todo, j) => {
      const t = tw + j * EVAC.binMin;
      // nearest first, so the closest neighbourhoods get the space
      const first = (d: (typeof todo)[number]) => (near && d.node >= 0 && near.count[d.node] ? near.dist[d.node * K] : Infinity);
      todo.sort((a, z) => first(a) - first(z));
      for (const d of todo) {
        let left = d.people;
        const n = near && d.node >= 0 ? near.count[d.node] : 0;
        const walk0 = d.node >= 0 ? metres(d.lon, d.lat, g.lon[d.node], g.lat[d.node]) : 0;
        for (let k = 0; k < n && left > 0.5; k++) {
          const s = near!.label[d.node * K + k];
          if (remaining[s] < 1 || closeAt[s] <= t) continue;
          const take = Math.min(left, remaining[s]);
          const arrive = t + (near!.dist[d.node * K + k] + walk0) / mPerMin;
          arrivals.push({ s, t: arrive, p: take });
          departed[toStep(t)] += take;
          remaining[s] -= take;
          left -= take;
          if (remaining[s] < 1 && fullAt[s] === Infinity) fullAt[s] = arrive;
        }
        if (left > 0.5) rescue[toStep(t)] += left;
      }
    });
  }

  const occ = shelters.map(() => new Float32Array(steps));
  const arrived = new Float32Array(steps);
  for (const a of arrivals) { const k = toStep(a.t); occ[a.s][k] += a.p; arrived[k] += a.p; }
  for (const o of occ) for (let k = 1; k < steps; k++) o[k] += o[k - 1];
  for (const arr of [departed, arrived, rescue]) for (let k = 1; k < steps; k++) arr[k] += arr[k - 1];
  return { stepMin: EVAC.stepMin, steps, occ, closeAt, fullAt, departed, arrived, rescue, ms: performance.now() - t0 };
}

export function occupancyAt(plan: EvacPlan, s: number, t: number): number {
  const k = Math.min(plan.steps - 1, Math.max(0, Math.floor(t / plan.stepMin)));
  return plan.occ[s][k];
}
export function seriesAt(arr: Float32Array, plan: EvacPlan, t: number): number {
  return arr[Math.min(plan.steps - 1, Math.max(0, Math.floor(t / plan.stepMin)))];
}

// VACAN-style crowding states
export type Crowding = 'open' | 'busy' | 'crowded' | 'full' | 'closed';
export const CROWDING: Record<Crowding, { label: string; color: string }> = {
  open: { label: 'Space available', color: '#1E8E3E' },
  busy: { label: 'Filling up', color: '#F9AB00' },
  crowded: { label: 'Crowded', color: '#E8710A' },
  full: { label: 'Full', color: '#D93025' },
  closed: { label: 'Closed — flooding', color: '#5F6368' },
};
export const CROWD_CODE: Record<Crowding, number> = { open: 0, busy: 1, crowded: 2, full: 3, closed: 4 };

export function crowdingOf(plan: EvacPlan | null, shelter: Shelter, s: number, t: number): Crowding {
  if (plan && t >= plan.closeAt[s]) return 'closed';
  const share = plan ? occupancyAt(plan, s, t) / shelter.cap : 0;
  return share >= 0.98 ? 'full' : share >= 0.8 ? 'crowded' : share >= 0.5 ? 'busy' : 'open';
}
