// Ginkgo Copilot — flood drill tools: run a drill, read its state, plan an
// evacuation route and list evacuation centres. Same code as the drill panels
// (src/sim), so the figures the model reads are the ones on screen.

import { DAERAH_NAMES } from '../data/analysis';
import type { Grid, AppDataBundle } from '../data/types';
import {
  EVENTS, LEVELS, fmtClock, levelOf, onsetAt, placeRisks, simulate, totalsAt, type FloodEvent, type FloodSim, type Intensity,
} from '../sim/flood';
import { CROWDING, crowdingOf, occupancyAt, seriesAt, type EvacPlan, type Shelter } from '../sim/evac';
import { metres } from '../sim/graph';
import { edgeOnsetOf, type EvacData } from '../sim/load';
import { routeToShelter, type Mode } from '../sim/route';

/** What the drill looks like right now (kept in a ref, so tools in one answer see each other's changes). */
export interface DrillSnapshot {
  active: boolean;
  sim: FloodSim | null;
  t: number;
  plan: EvacPlan | null;      // null while the worker is still planning, or for another run
  data: EvacData | null;      // null until the road network has loaded
}
export interface DrillActions {
  /** Switch the app to the drill, with this event and clock. */
  startDrill: (eventId: string, intensity: Intensity | null, minute: number) => void;
  /** Show a route from this point in the drill's Evacuate panel. */
  routeFrom: (lon: number, lat: number, label: string, mode: Mode) => void;
}
export interface DrillToolContext {
  bundle: AppDataBundle;
  grid: Grid;
  getDrill: () => DrillSnapshot;
  setDrill: (s: DrillSnapshot) => void;
  drillActions: DrillActions;
}

export class DrillInputError extends Error {}
const KIND: Record<Shelter['k'], string> = { school: 'school', hall: 'community hall', mosque: 'mosque', sports: 'stadium / sports hall' };
const pop = (n: number) => (n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100);
const r1 = (n: number) => Math.round(n * 10) / 10;

function eventOf(id: unknown, intensity: unknown): FloodEvent {
  const base = EVENTS.find(e => e.id === id);
  if (!base) throw new DrillInputError(`event must be one of: ${EVENTS.map(e => e.id).join(', ')}`);
  if (intensity === 'heavy' || intensity === 'extreme') return { ...base, intensity };
  return base;
}

function needDrill(ctx: DrillToolContext): DrillSnapshot & { sim: FloodSim } {
  const d = ctx.getDrill();
  if (!d.active || !d.sim) throw new DrillInputError('no flood drill is running: call run_flood_drill first');
  return d as DrillSnapshot & { sim: FloodSim };
}

/** The headline picture at minute t: water, warnings by level, the most urgent places. */
function situation(ctx: DrillToolContext, sim: FloodSim, t: number, plan: EvacPlan | null, data: EvacData | null) {
  const tot = totalsAt(sim, ctx.grid, t);
  const risks = placeRisks(sim, ctx.grid, ctx.bundle.places, ctx.bundle.facilities.items);
  const counts = { level_5_flooding: 0, level_4_within_1h: 0, level_3_within_2h: 0, level_2_within_3h: 0 };
  const keys = { 5: 'level_5_flooding', 4: 'level_4_within_1h', 3: 'level_3_within_2h', 2: 'level_2_within_3h' } as const;
  for (const r of risks) { const l = levelOf(r.onset, t); if (l) counts[keys[l]]++; }
  const urgent = risks
    .map(r => ({ r, level: levelOf(r.onset, t) }))
    .filter(x => x.level >= 4)
    .sort((a, b) => b.level - a.level || a.r.onset - b.r.onset || b.r.people - a.r.people);
  const places = urgent.filter(x => x.r.kind === 'place').slice(0, 8).map(({ r, level }) => ({
    name: r.name, daerah: r.daerah, level, floods_at: fmtClock(r.onset),
    minutes_until_flooding: Math.max(0, Math.round(r.onset - t)), residents_in_flooding_cells_estimate: pop(r.people),
  }));
  const facilities = urgent.filter(x => x.r.kind === 'facility' && /Hospital|Clinic|Police|Bomba/.test(x.r.sub)).slice(0, 6).map(({ r, level }) => ({
    name: r.name, kind: r.sub, level, floods_at: fmtClock(r.onset),
  }));
  const out: Record<string, unknown> = {
    drill_clock: fmtClock(t),
    minutes_since_rain_started: Math.round(t),
    people_living_in_flooded_cells_estimate: pop(tot.floodedPeople),
    flooded_km2: Math.round(tot.floodedKm2),
    people_in_cells_flooding_within_1h_estimate: pop(tot.level4People),
    people_in_cells_flooding_in_1_to_2h_estimate: pop(tot.level3People),
    places_by_alert_level: counts,
    most_urgent_places: places,
    critical_facilities_at_level_4_or_5: facilities,
  };
  if (data) {
    const rain = new Set(sim.event.daerah);
    const centres = data.shelters.items.filter(s => rain.has(s.d));
    out.evacuation_centres_in_rain_area = { count: centres.length, places: centres.reduce((a, s) => a + s.cap, 0) };
    if (plan) {
      const states: Record<string, number> = { open: 0, busy: 0, crowded: 0, full: 0, closed: 0 };
      for (const s of centres) states[crowdingOf(plan, s, s.id, t)]++;
      out.evacuation = {
        people_in_centres_estimate: pop(seriesAt(plan.arrived, plan, t)),
        people_with_no_centre_within_reach_estimate: pop(seriesAt(plan.rescue, plan, t)),
        centres_with_space: states.open, centres_filling_up: states.busy, centres_crowded: states.crowded, centres_full: states.full,
        assumption: '15% of residents in flooding zones go to a public centre, on foot, when their ~740 m zone reaches Level 4',
      };
    } else out.evacuation = 'centre occupancy is still being computed; ask again in a moment';
  }
  return out;
}

const FRAMING = 'Flood drill: a simulated time-lapse of a rain scenario on the susceptibility grid, for preparedness. Not a forecast; times are drill times (T+h:mm since the rain started).';

export function runDrillTool(ctx: DrillToolContext, name: string, input: Record<string, unknown>): { step: string; result: unknown } | null {
  switch (name) {
    case 'run_flood_drill': {
      const event = eventOf(input.event, input.intensity);
      const minute = typeof input.at_minute === 'number' ? Math.min(event.durationMin, Math.max(0, Math.round(input.at_minute))) : 0;
      const sim = simulate(ctx.grid, ctx.bundle.model, event);
      const prev = ctx.getDrill();
      ctx.setDrill({ active: true, sim, t: minute, plan: null, data: prev.data });
      ctx.drillActions.startDrill(event.id, (input.intensity as Intensity | null) ?? null, minute);
      return {
        step: `Started the flood drill “${event.label}” at ${fmtClock(minute)}`,
        result: {
          framing: FRAMING,
          event: event.label, description: event.desc,
          rain_over: event.daerah.map(d => DAERAH_NAMES[d - 1]),
          peak_reaches: `the ${event.intensity} scenario's High class`, first_flooding_at: fmtClock(event.firstMin), peak_at: fmtClock(event.peakMin),
          drill_length: fmtClock(event.durationMin),
          ...situation(ctx, sim, minute, null, prev.data),
          alert_levels: Object.fromEntries(([5, 4, 3, 2] as const).map(l => [`level_${l}`, LEVELS[l].action])),
        },
      };
    }
    case 'get_drill_status': {
      const d = needDrill(ctx);
      return {
        step: `Read the drill at ${fmtClock(d.t)}`,
        result: { framing: FRAMING, event: d.sim.event.label, ...situation(ctx, d.sim, d.t, d.plan, d.data) },
      };
    }
    case 'plan_evacuation_route': {
      const d = needDrill(ctx);
      if (!d.data) throw new DrillInputError('the road network is still loading; try again in a moment');
      const lat = Number(input.latitude), lon = Number(input.longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new DrillInputError('latitude and longitude must be numbers');
      const mode: Mode = input.mode === 'drive' ? 'drive' : 'walk';
      const label = String(input.label ?? 'Start').slice(0, 60);
      const depart = typeof input.depart_minute === 'number' ? Math.max(0, Math.round(input.depart_minute)) : Math.floor(d.t / 5) * 5;
      const { graph, index, shelters } = d.data;
      const items = shelters.items;
      const plan = d.plan;
      const q = { origin: [lon, lat] as [number, number], departMin: depart, mode, edgeOnset: edgeOnsetOf(graph, d.sim.onset), originOnset: onsetAt(d.sim, ctx.grid, lon, lat) };
      let res = routeToShelter(graph, index, { ...q, accepts: (s, at) => !plan || (at < plan.closeAt[s] && occupancyAt(plan, s, at) < items[s].cap * 0.98) });
      let full = false;
      if (!res.ok && plan) {
        const any = routeToShelter(graph, index, { ...q, accepts: (s, at) => at < plan.closeAt[s] });
        if (any.ok) { res = any; full = true; }
      }
      // latest departure that still has a dry way out
      const ok = (dep: number) => { const r = routeToShelter(graph, index, { ...q, departMin: dep, alternatives: 0, accepts: () => true }); return r.ok && !r.startFlooded; };
      let leaveBy: number | null = null;
      if (ok(0)) {
        let lo = 0, hi = d.sim.event.durationMin;
        if (ok(hi)) leaveBy = hi;
        else { while (hi - lo > 5) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid; } leaveBy = lo; }
      }
      ctx.drillActions.routeFrom(lon, lat, label, mode);
      const describe = (s: number) => ({ name: items[s].n, kind: KIND[items[s].k], daerah: DAERAH_NAMES[items[s].d - 1] ?? 'Federal territory', capacity: items[s].cap });
      return {
        step: `Planned a ${mode === 'walk' ? 'walking' : 'driving'} evacuation route from ${label}`,
        result: {
          framing: FRAMING,
          from: label, mode, leaving_at: fmtClock(depart),
          start_point_already_flooded: res.startFlooded,
          last_dry_departure: leaveBy === null ? 'none: no dry way out at any time in this drill' : leaveBy >= d.sim.event.durationMin ? 'any time in the drill' : fmtClock(leaveBy),
          ...(res.ok ? {
            best: {
              centre: describe(res.routes[0].shelter),
              minutes: Math.round(res.routes[0].minutes), km: r1(res.routes[0].metres / 1000), arrive_at: fmtClock(res.routes[0].arriveMin),
              wading_m: Math.round(res.routes[0].wadeMetres),
              roads: res.routes[0].steps.slice(0, 6).map(s => ({ road: s.name, m: Math.round(s.metres / 10) * 10 })),
            },
            alternatives: res.routes.slice(1).map(r => ({ centre: describe(r.shelter).name, minutes: Math.round(r.minutes), km: r1(r.metres / 1000) })),
            all_centres_in_reach_full_on_arrival: full,
          } : { no_route: res.reason }),
          rules: 'Roads are avoided if they flood before the evacuee is past them (+10 min); centres that will be full on arrival are skipped. Shown on the user\'s map.',
        },
      };
    }
    case 'list_evacuation_centres': {
      const d = ctx.getDrill();
      if (!d.data) throw new DrillInputError('evacuation centres load with the flood drill: call run_flood_drill first');
      const items = d.data.shelters.items;
      const daerah = input.daerah == null ? null : DAERAH_NAMES.indexOf(String(input.daerah)) + 1;
      if (daerah === 0) throw new DrillInputError(`daerah must be one of: ${DAERAH_NAMES.join(', ')}`);
      const nearLat = typeof input.near_latitude === 'number' ? input.near_latitude : null;
      const nearLon = typeof input.near_longitude === 'number' ? input.near_longitude : null;
      const limit = Math.min(15, Math.max(1, Number(input.limit) || 8));
      let list = items.filter(s => !daerah || s.d === daerah).map(s => ({ s, dist: nearLat !== null && nearLon !== null ? metres(nearLon, nearLat, s.c[0], s.c[1]) : 0 }));
      list = nearLat !== null ? list.sort((a, b) => a.dist - b.dist) : list.sort((a, b) => b.s.cap - a.s.cap);
      const t = d.active ? d.t : 0;
      return {
        step: `Listed evacuation centres${daerah ? ` in ${DAERAH_NAMES[daerah - 1]}` : ''}${nearLat !== null ? ' near the point' : ''}`,
        result: {
          note: d.data.shelters.note,
          total_matching: list.length,
          centres: list.slice(0, limit).map(({ s, dist }) => ({
            name: s.n, kind: KIND[s.k], daerah: DAERAH_NAMES[s.d - 1] ?? 'Federal territory', capacity: s.cap,
            ground: s.safe === 'low' ? 'Low under Extreme rain' : 'Moderate under Extreme rain', height_above_drainage_m: s.hand,
            ...(nearLat !== null ? { straight_line_km: r1(dist / 1000) } : {}),
            ...(d.active && d.plan ? { drill_status: CROWDING[crowdingOf(d.plan, s, s.id, t)].label, people_inside_estimate: Math.round(occupancyAt(d.plan, s.id, t)) } : {}),
            latitude: Math.round(s.c[1] * 1e4) / 1e4, longitude: Math.round(s.c[0] * 1e4) / 1e4,
          })),
        },
      };
    }
  }
  return null;
}
