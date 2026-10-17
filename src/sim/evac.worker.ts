// Ginkgo flood drill — evacuation planning off the main thread.

import type { Grid, GridMeta } from '../data/types';
import type { FloodEvent, FloodSim } from './flood';
import { decodeRoads, type RoadGraph, type RoadsMeta } from './graph';
import { indexShelters, type ShelterIndex } from './route';
import { planEvacuation, type EvacPlan, type Shelter } from './evac';

export interface WorkerInit { type: 'init'; raw: ArrayBuffer; roads: RoadsMeta; shelters: Shelter[]; meta: GridMeta; pop: Uint16Array }
export interface PlanRequest { type: 'plan'; id: number; onset: Uint16Array; bounds: FloodSim['bounds']; event: FloodEvent }
export interface PlanReply { id: number; plan: EvacPlan }

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<WorkerInit | PlanRequest>) => void) | null;
  postMessage: (m: PlanReply, transfer: Transferable[]) => void;
};

let ready: { g: RoadGraph; sh: ShelterIndex; shelters: Shelter[]; grid: Grid } | null = null;

scope.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const g = decodeRoads(msg.raw, msg.roads);
    ready = { g, sh: indexShelters(g, msg.shelters.map(s => s.c)), shelters: msg.shelters, grid: { meta: msg.meta, pop: msg.pop } as Grid };
    return;
  }
  if (!ready) return;
  const { g, sh, shelters, grid } = ready;
  const sim = { onset: msg.onset, bounds: msg.bounds, event: msg.event } as FloodSim;
  const onset = msg.onset;
  const plan = planEvacuation(sim, grid, g, sh, shelters, ev => (g.low[ev] >= 0 ? onset[g.low[ev]] : 65535));
  scope.postMessage({ id: msg.id, plan }, plan.occ.map(o => o.buffer as ArrayBuffer));
};
