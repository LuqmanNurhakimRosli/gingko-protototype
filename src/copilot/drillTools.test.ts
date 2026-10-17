// Flood drill tools on the real data: what the model reads matches the drill engine.

import { describe, expect, it } from 'vitest';
import { loadBundle, loadRoads, loadShelters } from '../test/realData';
import { indexShelters } from '../sim/route';
import { runTool, type ToolContext } from './agentTools';
import type { DrillSnapshot } from './drillTools';

const bundle = loadBundle();
const graph = loadRoads();
const shelters = loadShelters();
const data = { graph, shelters, index: indexShelters(graph, shelters.items.map(s => s.c)), raw: new ArrayBuffer(0) };

function context() {
  let drill: DrillSnapshot = { active: false, sim: null, t: 0, plan: null, data };
  const calls: string[] = [];
  const ctx = {
    bundle, grid: bundle.grid,
    daerahCells: () => new Int32Array(0),
    getView: () => ({ scenario: 'normal', selectedDaerah: null, activeArea: null, lastCell: null, layers: [] }),
    actions: { showArea: () => {}, showPoint: () => {}, setView: () => { throw new Error('unused'); }, showSites: () => {} },
    getDrill: () => drill,
    setDrill: (d: DrillSnapshot) => { drill = d; },
    drillActions: {
      startDrill: (id: string, _i: unknown, minute: number) => calls.push(`start ${id} ${minute}`),
      routeFrom: (_lon: number, _lat: number, label: string, mode: string) => calls.push(`route ${label} ${mode}`),
    },
  } as unknown as ToolContext;
  return { ctx, calls };
}

describe('flood drill tools', { timeout: 30000 }, () => {
  it('needs a running drill before reading its status', () => {
    const { ctx } = context();
    const out = runTool(ctx, 'get_drill_status', {});
    expect(out.isError).toBe(true);
  });

  it('runs a drill, shows it, and reports alerts and capacity', () => {
    const { ctx, calls } = context();
    const out = runTool(ctx, 'run_flood_drill', { event: 'klang-valley', intensity: null, at_minute: 30 });
    expect(out.isError).toBeFalsy();
    expect(calls).toEqual(['start klang-valley 30']);
    const r = out.result as Record<string, any>;
    expect(r.drill_clock).toBe('T+0:30');
    expect(r.rain_over).toContain('Klang');
    expect(r.places_by_alert_level.level_4_within_1h).toBeGreaterThan(0);
    expect(r.most_urgent_places.length).toBeGreaterThan(0);
    expect(r.evacuation_centres_in_rain_area.count).toBeGreaterThan(100);
    const status = runTool(ctx, 'get_drill_status', {}).result as Record<string, any>;
    expect(status.drill_clock).toBe('T+0:30');
  });

  it('plans a route from Taman Sri Muda with a leave-by time', () => {
    const { ctx, calls } = context();
    runTool(ctx, 'run_flood_drill', { event: 'klang-valley', intensity: null, at_minute: 0 });
    const out = runTool(ctx, 'plan_evacuation_route', { latitude: 3.02954, longitude: 101.53446, label: 'Taman Sri Muda', mode: 'walk', depart_minute: null });
    expect(out.isError).toBeFalsy();
    const r = out.result as Record<string, any>;
    expect(r.best.minutes).toBeGreaterThan(5);
    expect(r.best.centre.capacity).toBeGreaterThan(0);
    expect(r.last_dry_departure).toMatch(/^T\+\d:\d\d$/);
    expect(calls).toContain('route Taman Sri Muda walk');
  });

  it('lists centres nearest a point first', () => {
    const { ctx } = context();
    const out = runTool(ctx, 'list_evacuation_centres', { daerah: null, near_latitude: 3.0738, near_longitude: 101.5183, limit: 5 });
    const list = (out.result as Record<string, any>).centres as { straight_line_km: number }[];
    expect(list).toHaveLength(5);
    for (let i = 1; i < list.length; i++) expect(list[i].straight_line_km).toBeGreaterThanOrEqual(list[i - 1].straight_line_km);
  });
});
