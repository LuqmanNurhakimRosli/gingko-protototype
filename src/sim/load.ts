// Ginkgo flood drill — loads the road graph and evacuation centres (only when
// the drill is opened; ~5 MB) and runs the evacuation plan in a worker.

import { gunzip, json } from '../data/load';
import type { Grid } from '../data/types';
import type { FloodSim } from './flood';
import { decodeRoads, type RoadGraph, type RoadsMeta } from './graph';
import { indexShelters, type ShelterIndex } from './route';
import { planEvacuation, type EvacPlan, type SheltersFile } from './evac';
import type { PlanReply, PlanRequest, WorkerInit } from './evac.worker';

export interface EvacData {
  graph: RoadGraph;
  shelters: SheltersFile;
  index: ShelterIndex;
  raw: ArrayBuffer;
}

export async function loadEvac(): Promise<EvacData> {
  const [meta, raw, shelters] = await Promise.all([
    json<RoadsMeta>('roads.json'), gunzip('roads.bin.gz'), json<SheltersFile>('shelters.json'),
  ]);
  const graph = decodeRoads(raw, meta);
  return { graph, shelters, index: indexShelters(graph, shelters.items.map(s => s.c)), raw };
}

export const edgeOnsetOf = (g: RoadGraph, onset: Uint16Array) => (e: number) => (g.low[e] >= 0 ? onset[g.low[e]] : 65535);

/** Evacuation plans in a background worker (2–4 s of graph search), with a main-thread fallback. */
export class Planner {
  private worker: Worker | null = null;
  private seq = 0;
  private waiting = new Map<number, (p: EvacPlan) => void>();
  private data: EvacData;
  private grid: Grid;

  constructor(data: EvacData, grid: Grid) {
    this.data = data;
    this.grid = grid;
    try {
      this.worker = new Worker(new URL('./evac.worker.ts', import.meta.url), { type: 'module' });
      const init: WorkerInit = {
        type: 'init', raw: data.raw.slice(0), roads: data.graph.meta, shelters: data.shelters.items,
        meta: grid.meta, pop: Uint16Array.from(grid.pop),
      };
      this.worker.postMessage(init);
      this.worker.onmessage = (e: MessageEvent<PlanReply>) => {
        this.waiting.get(e.data.id)?.(e.data.plan);
        this.waiting.delete(e.data.id);
      };
      this.worker.onerror = () => { this.worker?.terminate(); this.worker = null; };
    } catch {
      this.worker = null;
    }
  }

  plan(sim: FloodSim): Promise<EvacPlan> {
    if (!this.worker) {
      const { graph, index, shelters } = this.data;
      return Promise.resolve(planEvacuation(sim, this.grid, graph, index, shelters.items, edgeOnsetOf(graph, sim.onset)));
    }
    const id = ++this.seq;
    const req: PlanRequest = { type: 'plan', id, onset: sim.onset.slice(0), bounds: sim.bounds, event: sim.event };
    return new Promise(resolve => {
      this.waiting.set(id, resolve);
      this.worker!.postMessage(req, [req.onset.buffer]);
    });
  }

  dispose() { this.worker?.terminate(); this.worker = null; }
}
