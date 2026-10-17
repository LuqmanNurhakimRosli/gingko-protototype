// Ginkgo flood drill — state for drill mode: the event, the clock, the
// evacuation plan (from the worker) and the route for a chosen start point.
// Per-run state (clock, plan, chosen centre) is keyed by the run's id, so a
// new drill starts from T+0 without resetting anything in an effect.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LonLat } from '../data/analysis';
import type { AppDataBundle, Grid } from '../data/types';
import { EVENTS, onsetAt, placeRisks, simulate, totalsAt, type FloodEvent, type FloodSim, type Intensity, type PlaceRisk } from './flood';
import { crowdingOf, occupancyAt, type Crowding, type EvacPlan } from './evac';
import { edgeOnsetOf, loadEvac, Planner, type EvacData } from './load';
import { routeToShelter, type Mode, type RouteResult } from './route';

export interface DrillOrigin { point: LonLat; label: string }

export interface Drill {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string | null;
  data: EvacData | null;
  event: FloodEvent;
  setEvent: (id: string) => void;
  setIntensity: (i: Intensity) => void;
  /** start an event at a given drill minute (used by the AI agent) */
  startAt: (id: string, intensity: Intensity | null, minute: number) => void;
  sim: FloodSim | null;
  t: number;
  setT: (t: number) => void;
  playing: boolean;
  setPlaying: (p: boolean) => void;
  speed: number;
  setSpeed: (s: number) => void;
  plan: EvacPlan | null;
  planning: boolean;
  risks: PlaceRisk[];
  totals: ReturnType<typeof totalsAt> | null;
  origin: DrillOrigin | null;
  setOrigin: (o: DrillOrigin | null) => void;
  mode: Mode;
  setMode: (m: Mode) => void;
  route: RouteResult | null;
  routeAt: number | null;       // drill minute the route was planned for
  leaveBy: number | null;       // latest departure with a dry route out (null: none, even at T+0)
  pick: number;                 // which route option is shown
  setPick: (i: number) => void;
  shelter: number | null;
  setShelter: (id: number | null) => void;
  crowding: (id: number) => Crowding;
  occupancy: (id: number) => number;
}

export function useDrill(active: boolean, bundle: AppDataBundle | null, grid: Grid | null): Drill {
  const [data, setData] = useState<EvacData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eventId, setEventId] = useState(EVENTS[0].id);
  const [intensity, setIntensityState] = useState<Intensity | null>(null);
  // the clock belongs to an event: switching events starts from T+0
  const [clock, setClock] = useState({ key: '', t: 0, playing: false });
  const [speed, setSpeed] = useState(20);
  const [planned, setPlanned] = useState<{ run: number; plan: EvacPlan } | null>(null);
  const [origin, setOriginState] = useState<DrillOrigin | null>(null);
  const [mode, setModeState] = useState<Mode>('walk');
  const [picked, setPicked] = useState({ key: '', i: 0 });
  const [chosen, setChosen] = useState<{ run: number; id: number | null }>({ run: 0, id: null });
  const loading = useRef(false);
  const planner = useRef<Planner | null>(null);

  // load the road graph and centres the first time the drill opens
  useEffect(() => {
    if (!active || loading.current) return;
    loading.current = true;
    loadEvac().then(setData).catch(e => setError(String(e?.message ?? e)));
  }, [active]);
  const [opened, setOpened] = useState(false);
  if (active && !opened) setOpened(true); // remembered so leaving the drill keeps the data loaded
  const status: Drill['status'] = data ? 'ready' : error ? 'error' : opened ? 'loading' : 'idle';

  const event: FloodEvent = useMemo(() => {
    const base = EVENTS.find(e => e.id === eventId) ?? EVENTS[0];
    return intensity && intensity !== base.intensity ? { ...base, intensity } : base;
  }, [eventId, intensity]);

  const sim = useMemo(
    () => (active && bundle && grid ? simulate(grid, bundle.model, event) : null),
    [active, bundle, grid, event],
  );
  const run = sim?.id ?? 0;
  const key = `${event.id}:${event.intensity}`;
  const t = clock.key === key ? clock.t : 0;
  const playing = clock.key === key && clock.playing;
  const plan = planned?.run === run ? planned.plan : null;
  const shelter = chosen.run === run ? chosen.id : null;

  // the evacuation plan for this run, from the worker
  useEffect(() => {
    if (!sim || !data || !grid) return;
    planner.current ??= new Planner(data, grid);
    let alive = true;
    planner.current.plan(sim).then(p => { if (alive) setPlanned({ run: sim.id, plan: p }); });
    return () => { alive = false; };
  }, [sim, data, grid]);
  useEffect(() => () => planner.current?.dispose(), []);

  // clock: `speed` drill minutes per second
  useEffect(() => {
    if (!playing || !sim) return;
    let raf = 0, last = performance.now();
    const end = sim.event.durationMin;
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setClock(c => {
        const next = Math.min(end, (c.key === key ? c.t : 0) + dt * speed);
        return { key, t: next, playing: next < end };
      });
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, speed, sim, key]);

  const setT = useCallback((v: number) => setClock(c => ({ ...c, key, t: v })), [key]);
  const setPlaying = useCallback((p: boolean) => setClock(c => ({ key, t: c.key === key ? c.t : 0, playing: p })), [key]);
  const setEvent = useCallback((id: string) => { setEventId(id); setIntensityState(null); }, []);
  const startAt = useCallback((id: string, i: Intensity | null, minute: number) => {
    const base = EVENTS.find(e => e.id === id) ?? EVENTS[0];
    setEventId(base.id);
    setIntensityState(i);
    setClock({ key: `${base.id}:${i ?? base.intensity}`, t: minute, playing: false });
  }, []);
  const setShelter = useCallback((id: number | null) => setChosen({ run, id }), [run]);

  const risks = useMemo(
    () => (sim && bundle && grid ? placeRisks(sim, grid, bundle.places, bundle.facilities.items) : []),
    [sim, bundle, grid],
  );
  // totals move in whole minutes
  const minute = Math.floor(t);
  const totals = useMemo(() => (sim && grid ? totalsAt(sim, grid, minute) : null), [sim, grid, minute]);

  // route: re-planned every 5 drill minutes, and whenever the start, mode or plan changes
  const step = Math.floor(t / 5) * 5;
  const route = useMemo(() => {
    if (!sim || !data || !grid || !origin) return null;
    const items = data.shelters.items;
    const query = {
      origin: origin.point, departMin: step, mode, edgeOnset: edgeOnsetOf(data.graph, sim.onset),
      originOnset: onsetAt(sim, grid, origin.point[0], origin.point[1]),
    };
    const res = routeToShelter(data.graph, data.index, {
      ...query, accepts: (s, at) => !plan || (at < plan.closeAt[s] && occupancyAt(plan, s, at) < items[s].cap * 0.98),
    });
    if (res.ok || !plan) return res;
    // nothing with space: show the nearest open centres anyway, flagged as full
    const open = routeToShelter(data.graph, data.index, { ...query, accepts: (s, at) => at < plan.closeAt[s] });
    return open.ok ? { ...open, full: true } : res;
  }, [sim, data, grid, origin, mode, plan, step]);
  // the latest departure that still has a dry route out (like a personal "My Timeline")
  const leaveBy = useMemo(() => {
    if (!sim || !data || !grid || !origin) return null;
    const edgeOnset = edgeOnsetOf(data.graph, sim.onset);
    const originOnset = onsetAt(sim, grid, origin.point[0], origin.point[1]);
    const ok = (dep: number) => {
      const r = routeToShelter(data.graph, data.index, {
        origin: origin.point, departMin: dep, mode, edgeOnset, originOnset, alternatives: 0, accepts: () => true,
      });
      return r.ok && !r.startFlooded;
    };
    let lo = 0, hi = sim.event.durationMin;
    if (!ok(lo)) return null;
    if (ok(hi)) return hi;
    while (hi - lo > 5) { const mid = Math.floor((lo + hi) / 2); if (ok(mid)) lo = mid; else hi = mid; }
    return lo;
  }, [sim, data, grid, origin, mode]);
  // the chosen option resets when the start point or mode changes
  const pickKey = origin ? `${origin.point.join(',')}:${mode}` : '';
  const pick = picked.key === pickKey ? picked.i : 0;
  const setPick = useCallback((i: number) => setPicked({ key: pickKey, i }), [pickKey]);

  const crowding = useCallback(
    (id: number) => (data ? crowdingOf(plan, data.shelters.items[id], id, t) : 'open'),
    [data, plan, t],
  );
  const occupancy = useCallback((id: number) => (plan ? occupancyAt(plan, id, t) : 0), [plan, t]);

  return {
    status, error, data, event, setEvent, setIntensity: setIntensityState, startAt, sim, t, setT, playing, setPlaying, speed, setSpeed,
    plan, planning: Boolean(sim && data && !plan), risks, totals, origin, setOrigin: setOriginState, mode, setMode: setModeState,
    route, routeAt: route ? step : null, leaveBy, pick, setPick, shelter, setShelter, crowding, occupancy,
  };
}
