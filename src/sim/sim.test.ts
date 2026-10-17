// Flood drill tests on the real Selangor data: the time-lapse ends on the
// scenario's High class, alert levels follow the lead time, routes avoid
// flooded roads and centres never take more people than they hold.

import { describe, expect, it } from 'vitest';
import { classOf } from '../data/analysis';
import { loadBundle, loadRoads, loadShelters } from '../test/realData';
import { EVENTS, NEVER, levelOf, placeRisks, simulate, totalsAt } from './flood';
import { nearestNode } from './graph';
import { edgeMinutes, indexShelters, routeToShelter, MARGIN_MIN } from './route';
import { EVAC, crowdingOf, occupancyAt, planEvacuation, seriesAt } from './evac';

const bundle = loadBundle();
const { grid, model } = bundle;
const g = loadRoads();
const shelters = loadShelters().items;
const event = EVENTS.find(e => e.id === 'klang-valley')!;
const sim = simulate(grid, model, event);
const edgeOnset = (e: number) => (g.low[e] >= 0 ? sim.onset[g.low[e]] : NEVER);
const sh = indexShelters(g, shelters.map(s => s.c));

describe('flood time-lapse', { timeout: 20000 }, () => {
  it('reaches exactly the scenario High class inside the rain area by the peak', () => {
    const extreme = model.scenarios.find(s => s.key === 'extreme')!;
    const rain = new Set(event.daerah);
    let high = 0, flooded = 0, early = 0, outside = 0;
    for (let i = 0; i < grid.score.length; i++) {
      if (!rain.has(grid.daerah[i])) { if (sim.onset[i] !== NEVER) outside++; continue; }
      if (classOf(grid.score[i], extreme) === 3) high++;
      if (sim.onset[i] <= event.peakMin) flooded++;
      if (sim.onset[i] < event.firstMin) early++;
    }
    expect(outside).toBe(0);
    expect(flooded).toBe(high);
    expect(early).toBe(0);
  });

  it('floods more ground and people as time passes', () => {
    const a = totalsAt(sim, grid, 90), b = totalsAt(sim, grid, 180), c = totalsAt(sim, grid, 300);
    expect(a.floodedKm2).toBeLessThan(b.floodedKm2);
    expect(b.floodedPeople).toBeLessThan(c.floodedPeople);
    expect(c.floodedPeople).toBeCloseTo(c.peakPeople, -2);
  });

  it('maps lead time to Japan-style alert levels', () => {
    expect(levelOf(NEVER, 0)).toBe(0);
    expect(levelOf(100, 120)).toBe(5);
    expect(levelOf(150, 100)).toBe(4);
    expect(levelOf(200, 100)).toBe(3);
    expect(levelOf(250, 100)).toBe(2);
    expect(levelOf(400, 100)).toBe(0);
  });

  it('warns Taman Sri Muda (flooded in December 2021) before the peak', () => {
    const risks = placeRisks(sim, grid, bundle.places, bundle.facilities.items);
    const sriMuda = risks.find(r => r.name === 'Taman Sri Muda');
    expect(sriMuda).toBeDefined();
    expect(sriMuda!.onset).toBeLessThan(event.peakMin);
    expect(sriMuda!.people).toBeGreaterThan(1000);
  });
});

describe('evacuation centres', () => {
  it('are on ground that stays dry in the drill and mostly reach the road network', () => {
    const never = shelters.filter(s => {
      const c = Math.floor((s.c[0] - grid.meta.x0) / grid.meta.res), r = Math.floor((grid.meta.y1 - s.c[1]) / grid.meta.res);
      return sim.onset[r * grid.meta.width + c] === NEVER;
    });
    expect(never.length).toBe(shelters.length);
    const snapped = Array.from(sh.nodeOf).filter(v => v >= 0).length;
    expect(snapped / shelters.length).toBeGreaterThan(0.97);
  });
});

describe('routing', () => {
  // the drill's warning for Taman Sri Muda, as the alert list shows it
  const place = placeRisks(sim, grid, bundle.places, []).find(r => r.name === 'Taman Sri Muda')!;
  const sriMuda = place.point;
  const o = place.onset;

  it('leads from Taman Sri Muda at Level 4 to an open centre on dry roads', () => {
    const depart = Math.max(0, o - 60);
    const res = routeToShelter(g, sh, {
      origin: sriMuda, departMin: depart, mode: 'walk', edgeOnset, originOnset: o, accepts: () => true,
    });
    expect(res.ok).toBe(true);
    const best = res.routes[0];
    expect(best.metres).toBeGreaterThan(200);
    expect(best.minutes).toBeLessThan(120);
    expect(best.wadeMetres).toBe(0);
    expect(best.path.length).toBeGreaterThan(3);
    expect(res.routes.length).toBe(3);
    expect(res.routes[1].metres).toBeGreaterThanOrEqual(best.metres - 1);
  });

  it('never uses a road that floods before the walker is clear of it', () => {
    const depart = Math.max(0, o - 60);
    const res = routeToShelter(g, sh, { origin: sriMuda, departMin: depart, mode: 'walk', edgeOnset, originOnset: o, accepts: () => true });
    const best = res.routes[0];
    const end = best.path[best.path.length - 1];
    expect(nearestNode(g, end[0], end[1], 5)).toBe(sh.nodeOf[best.shelter]);
    // re-walk the path: every road on it stays dry until the walker is past it (plus the margin)
    let t = depart + res.snapMetres / 75;
    for (const e of best.edges) {
      t += edgeMinutes(g, e, 'walk');
      expect(edgeOnset(e)).toBeGreaterThan(t + MARGIN_MIN);
    }
    expect(Math.abs(t + (best.metres - best.edges.reduce((a, e) => a + g.len[e], 0) - res.snapMetres) / 75 - best.arriveMin)).toBeLessThan(1);
  });

  it('reports when the start point is already deep in the flood', () => {
    const res = routeToShelter(g, sh, { origin: sriMuda, departMin: o + 200, mode: 'drive', edgeOnset, originOnset: o, accepts: () => true });
    expect(res.startFlooded).toBe(true);
    if (res.ok) expect(res.routes[0].wadeMetres).toBeGreaterThan(0);
    else expect(res.reason).toMatch(/under water/);
  });

  it('skips centres that will be full when you arrive', () => {
    const depart = Math.max(0, o - 60);
    const first = routeToShelter(g, sh, { origin: sriMuda, departMin: depart, mode: 'walk', edgeOnset, originOnset: o, accepts: () => true });
    const full = first.routes[0].shelter;
    const again = routeToShelter(g, sh, { origin: sriMuda, departMin: depart, mode: 'walk', edgeOnset, originOnset: o, accepts: s => s !== full });
    expect(again.routes[0].shelter).not.toBe(full);
  });
});

describe('evacuation plan', { timeout: 30000 }, () => {
  const plan = planEvacuation(sim, grid, g, sh, shelters, edgeOnset);

  it('runs fast enough for a background worker', () => {
    expect(plan.ms).toBeLessThan(8000);
  });

  it('never fills a centre past its capacity', () => {
    shelters.forEach((s, i) => expect(occupancyAt(plan, i, event.durationMin)).toBeLessThanOrEqual(s.cap + 1));
  });

  it('accounts for everyone who leaves: sheltered or needing rescue', () => {
    let want = 0;
    for (let i = 0; i < sim.onset.length; i++) if (sim.onset[i] <= event.durationMin) want += (grid.pop[i] / 10) * EVAC.share;
    const end = event.durationMin;
    const sheltered = seriesAt(plan.arrived, plan, end + 120);
    const rescue = seriesAt(plan.rescue, plan, end);
    expect(sheltered + rescue).toBeGreaterThan(want * 0.95);
    expect(sheltered + rescue).toBeLessThan(want * 1.01);
    // the Klang Valley has more people in the flood than centre places within walking reach
    expect(sheltered).toBeGreaterThan(want * 0.3);
    expect(rescue).toBeGreaterThan(0);
  });

  it('shows centres filling over time', () => {
    const used = shelters.map((s, i) => [s, i] as const).filter(([, i]) => occupancyAt(plan, i, event.durationMin) > 0);
    expect(used.length).toBeGreaterThan(100);
    const full = used.filter(([s, i]) => crowdingOf(plan, s, i, event.durationMin) === 'full');
    expect(full.length).toBeGreaterThan(10);
    for (const [s, i] of full.slice(0, 20)) {
      expect(crowdingOf(plan, s, i, 0)).not.toBe('full');
      expect(plan.fullAt[i]).toBeLessThan(Infinity);
    }
  });
});
