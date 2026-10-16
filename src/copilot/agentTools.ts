// Ginkgo Copilot — tools the model can call, executed in the browser over the
// precomputed grid. Every number returned here is computed by the same code the
// panels use (src/data/analysis.ts); the model only reads these results.

import {
  analyseCells, CLASS_NAME, classOf, DAERAH_NAMES, FACILITY_KINDS, facilitiesInCells, facilityExposure, findCandidateSites,
  isCandidateCell, queryCell, rasterizePolygon, polygonAreaKm2, type AreaReport, type CandidateSite, type CellInfo, type Ring,
} from '../data/analysis';
import { MAP_LAYERS, type MapLayerName } from './agentSpec';
import { searchPlaces } from '../data/places';
import { CAVEATS, SOURCES } from '../services/exports';
import type { AppDataBundle, Facility, FacilityKind, Grid, Scenario, ScenarioKey } from '../data/types';

export interface AgentView {
  scenario: ScenarioKey;
  selectedDaerah: string | null;
  activeArea: { label: string; rings: Ring[]; report: AreaReport } | null;
  lastCell: CellInfo | null;
  /** map layers currently visible */
  layers: MapLayerName[];
}

export interface ViewChange { scenario: ScenarioKey | null; daerah: string | null; on: MapLayerName[]; off: MapLayerName[] }

export interface AgentActions {
  /** Add an area to the map as a drawn area and open its report. */
  showArea: (rings: Ring[], label: string) => void;
  /** Fly the map to a point and open that cell's details. */
  showPoint: (lat: number, lon: number, label: string) => void;
  /** Apply a view change and return the view as it now stands. `daerah` "all" clears the selection. */
  setView: (change: ViewChange) => AgentView;
  /** Mark candidate sites on the map. */
  showSites: (sites: CandidateSite[], label: string) => void;
}

export interface ToolContext {
  bundle: AppDataBundle;
  grid: Grid;
  daerahCells: (id: number) => Int32Array;
  getView: () => AgentView;
  actions: AgentActions;
}

export interface ToolOutcome { result: unknown; step: string; isError?: boolean }

class ToolInputError extends Error {}

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
/** Population estimates are only good to a few significant figures. */
const pop = (n: number) => (n < 1000 ? Math.round(n / 10) * 10 : Math.round(n / 100) * 100);
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

function num(input: Record<string, unknown>, key: string): number {
  const v = input[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ToolInputError(`${key} must be a number`);
  return v;
}
function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string') throw new ToolInputError(`${key} must be a string`);
  return v;
}
function scenarioOf(ctx: ToolContext, key: unknown): Scenario {
  const sc = ctx.bundle.model.scenarios.find(s => s.key === key);
  if (!sc) throw new ToolInputError('scenario must be normal, heavy or extreme');
  return sc;
}
function daerahId(name: unknown): number {
  const i = DAERAH_NAMES.indexOf(String(name));
  if (i < 0) throw new ToolInputError(`daerah must be one of: ${DAERAH_NAMES.join(', ')}`);
  return i + 1;
}
function insideGrid(ctx: ToolContext, lat: number, lon: number) {
  const { x0, y1, res, width, height } = ctx.grid.meta;
  if (lon < x0 || lon > x0 + width * res || lat > y1 || lat < y1 - height * res) {
    throw new ToolInputError('that location is outside the Selangor analysis area');
  }
}

function zoneOf(ctx: ToolContext, lat: number, lon: number): string | null {
  const info = queryCell(ctx.grid, ctx.bundle.model, lon, lat);
  if (!info) return null;
  return info.federal ? 'Federal territory (outside scope)' : info.daerah;
}

export function facilitySummary(items: Facility[], ctx: ToolContext, namesFor: Scenario | null = null, limit = 8) {
  const out: Record<string, unknown> = {};
  for (const sc of ctx.bundle.model.scenarios) {
    out[sc.key] = Object.fromEntries(facilityExposure(items, sc).filter(e => e.total > 0).map(e => [
      e.kind, { mapped: e.total, in_high: e.high, in_moderate: e.moderate,
        ...(namesFor?.key === sc.key && e.high ? { high_examples: e.highNames.slice(0, limit) } : {}) },
    ]));
  }
  return out;
}

/** The compact, rounded view of an area report the model reads. */
export function summariseReport(ctx: ToolContext, r: AreaReport, facilities: Facility[] | null) {
  const view = ctx.getView();
  const current = scenarioOf(ctx, view.scenario);
  return {
    drawn_area_km2: r2(r.polygon_km2),
    selangor_land_analysed_km2: r2(r.land_km2),
    outside_selangor_km2: r2(r.outside_km2 + r.federal_km2),
    daerah_overlap: r.daerah.map(d => ({ name: d.name, km2: r2(d.km2) })),
    by_scenario: Object.fromEntries(ctx.bundle.model.scenarios.map(sc => {
      const s = r.scenarios[sc.key];
      return [sc.key, {
        rain: sc.rain,
        high_pct: r1(s.high_pct), moderate_pct: r1(s.moderate_pct), low_pct: r1(s.low_pct),
        high_km2: r2(s.high_km2), moderate_km2: r2(s.moderate_km2),
        high_risk_zones: s.zones,
        people_in_high_estimate: pop(s.pop_high), people_in_moderate_estimate: pop(s.pop_moderate),
      }];
    })),
    population_estimate: pop(r.population),
    built_up_pct: r1(r.built_pct),
    river_and_canal_km: r1(r.river_km),
    cells_seen_as_water_1984_2021_pct: r1(r.hist_pct),
    mean_score: r2(r.score_mean),
    ...(r.detail ? {
      terrain: {
        elevation_range_m: [r.detail.elev_min, r.detail.elev_max],
        median_height_above_drainage_m: r1(r.detail.hand_median),
        median_distance_to_river_m: Math.round(r.detail.river_dist_median),
        mean_slope_deg: r1(r.detail.slope_mean),
      },
      score_contributions: r.detail.why.map(w => ({ input: w.label, weight: w.weight, adds: r2(w.contribution), measured: w.input })),
      land_cover_pct: Object.fromEntries(Object.entries(r.detail.landcover).map(([k, v]) => [k, r1(v * 100)])),
      screened_candidate_land_ha: Math.round(r.detail.candidate_km2 * 100),
    } : { terrain: 'terrain layers still loading' }),
    ...(facilities ? { mapped_facilities: facilitySummary(facilities, ctx, current) } : {}),
    small_area_warning: r.land_km2 < 0.5 ? `only ${r.cell_count} cells of ~92 m; treat as indicative` : undefined,
  };
}

function cellSummary(ctx: ToolContext, c: CellInfo) {
  return {
    latitude: Math.round(c.lonlat[1] * 1e4) / 1e4, longitude: Math.round(c.lonlat[0] * 1e4) / 1e4,
    daerah: c.federal ? 'Federal territory (outside scope)' : c.daerah,
    class_by_scenario: Object.fromEntries(ctx.bundle.model.scenarios.map(sc => [sc.key, CLASS_NAME[c.cls[sc.key]]])),
    score: c.score === null ? null : r2(c.score),
    ...(c.hand !== undefined ? {
      height_above_drainage_m: r1(c.hand), distance_to_river_m: c.river_m, slope_deg: r1(c.slope!), elevation_m: c.elev,
    } : {}),
    seen_as_water_1984_2021_pct_of_cell: c.hist,
    built_up_pct: c.built,
    residents_estimate: c.pop < 1 ? 0 : Math.round(c.pop),
  };
}

function circle(lat: number, lon: number, radius_m: number, n = 72): Ring {
  const dLat = radius_m / 111_320;
  const dLon = radius_m / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return [lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)] as [number, number];
  });
}

const KIND_LABEL: Record<string, string> = {
  all: 'facilities', hospital: 'hospitals', clinic: 'clinics', school: 'schools', police: 'police stations',
  fire: 'fire & rescue stations', station: 'rail stations',
};

function run(ctx: ToolContext, name: string, input: Record<string, unknown>): ToolOutcome {
  const { bundle, grid } = ctx;
  const { model, stats } = bundle;
  switch (name) {
    case 'search_places': {
      const q = str(input, 'query');
      const hits = searchPlaces(bundle.places, q, clamp(Math.round(num(input, 'limit')), 1, 10));
      return {
        step: `Searched places for “${q}”`,
        result: hits.length
          ? { results: hits.map(p => ({ name: p.n, type: p.t, latitude: p.c[1], longitude: p.c[0], daerah: zoneOf(ctx, p.c[1], p.c[0]) })) }
          : { results: [], note: 'No match. Try a shorter name or another spelling.' },
      };
    }
    case 'get_current_view': {
      const v = ctx.getView();
      return {
        step: 'Read the current map view',
        result: {
          scenario: v.scenario,
          selected_daerah: v.selectedDaerah,
          active_drawn_area: v.activeArea
            ? { label: v.activeArea.label, ...summariseReport(ctx, v.activeArea.report, facilitiesInCells(grid.meta, bundle.facilities.items, rasterizePolygon(grid.meta, v.activeArea.rings))) }
            : null,
          last_cell_asked_about: v.lastCell ? cellSummary(ctx, v.lastCell) : null,
        },
      };
    }
    case 'analyse_location': {
      const lat = num(input, 'latitude'), lon = num(input, 'longitude');
      insideGrid(ctx, lat, lon);
      const radius = clamp(Math.round(num(input, 'radius_m')), 200, 5000);
      const label = str(input, 'label').slice(0, 60) || 'Copilot area';
      const rings = [circle(lat, lon, radius)];
      const cells = rasterizePolygon(grid.meta, rings);
      const report = analyseCells(grid, model, cells, polygonAreaKm2(rings));
      const facilities = facilitiesInCells(grid.meta, bundle.facilities.items, cells);
      ctx.actions.showArea(rings, label);
      return {
        step: `Analysed ${radius >= 1000 ? `${r1(radius / 1000)} km` : `${radius} m`} around ${label.split('·')[0].trim()}`,
        result: { label, centre: { latitude: lat, longitude: lon }, radius_m: radius, ...summariseReport(ctx, report, facilities) },
      };
    }
    case 'get_daerah_profile': {
      const id = daerahId(input.daerah);
      const d = stats.daerah.find(x => x.id === id)!;
      const report = analyseCells(grid, model, ctx.daerahCells(id), d.area_km2);
      const facilities = bundle.facilities.items.filter(f => f.d === id);
      return {
        step: `Read the ${d.name} profile`,
        result: { daerah: d.name, population_census_2020: d.population, land_km2: d.land_km2, ...summariseReport(ctx, report, facilities) },
      };
    }
    case 'query_point': {
      const lat = num(input, 'latitude'), lon = num(input, 'longitude');
      insideGrid(ctx, lat, lon);
      const info = queryCell(grid, model, lon, lat);
      if (!info) throw new ToolInputError('no data at that location (outside Selangor and the federal territories)');
      return { step: `Checked the cell at ${lat.toFixed(3)}, ${lon.toFixed(3)}`, result: cellSummary(ctx, info) };
    }
    case 'rank_daerah': {
      const sc = scenarioOf(ctx, input.scenario);
      const metric = str(input, 'metric');
      const value = (id: number) => {
        const s = stats.daerah.find(x => x.id === id)!.scenarios[sc.key];
        if (metric === 'high_pct') return s.high_pct;
        if (metric === 'people_in_high') return pop(s.pop_high);
        if (metric === 'zones') return s.zones;
        if (metric === 'facilities_in_high') return bundle.facilities.items.filter(f => f.d === id && classOf(f.s, sc) === 3).length;
        throw new ToolInputError('unknown metric');
      };
      const rows = stats.daerah.map(d => ({ daerah: d.name, value: value(d.id) })).sort((a, b) => b.value - a.value)
        .map((r, i) => ({ rank: i + 1, ...r }));
      return { step: `Ranked daerah by ${metric.replace(/_/g, ' ')} (${sc.label})`, result: { scenario: sc.key, metric, ranking: rows } };
    }
    case 'list_facilities_at_risk': {
      const sc = scenarioOf(ctx, input.scenario);
      const kind = str(input, 'kind');
      const scope = str(input, 'scope');
      const limit = clamp(Math.round(num(input, 'limit')), 1, 25);
      let items = bundle.facilities.items.filter(f => f.d >= 1 && f.d <= 9);
      let where = 'Selangor';
      if (scope === 'daerah') {
        const id = daerahId(input.daerah);
        items = items.filter(f => f.d === id);
        where = DAERAH_NAMES[id - 1];
      } else if (scope === 'active_area') {
        const a = ctx.getView().activeArea;
        if (!a) throw new ToolInputError('there is no active drawn area; ask the user to draw one or use analyse_location');
        items = facilitiesInCells(grid.meta, bundle.facilities.items, rasterizePolygon(grid.meta, a.rings));
        where = a.label;
      }
      const kinds = (kind === 'all' ? FACILITY_KINDS : [kind]) as FacilityKind[];
      if (!kinds.every(k => FACILITY_KINDS.includes(k))) throw new ToolInputError('unknown facility kind');
      items = items.filter(f => kinds.includes(f.k));
      const exp = facilityExposure(items, sc).filter(e => e.total > 0);
      const high = items.filter(f => classOf(f.s, sc) === 3).sort((a, b) => a.n.localeCompare(b.n));
      return {
        step: `Listed ${KIND_LABEL[kind] ?? kind} in High cells — ${where} (${sc.label})`,
        result: {
          scope: where, scenario: sc.key,
          counts: exp.map(e => ({ kind: e.kind, mapped: e.total, in_high: e.high, in_moderate: e.moderate })),
          in_high: high.slice(0, limit).map(f => ({ name: f.n, kind: f.k, latitude: f.c[1], longitude: f.c[0], daerah: DAERAH_NAMES[f.d - 1] ?? null })),
          more_not_listed: Math.max(0, high.length - limit),
          note: 'Facilities are mapped from open data (OpenStreetMap via Overture Maps) and may be incomplete or duplicated.',
        },
      };
    }
    case 'get_method_and_validation': {
      const v = bundle.validation;
      return {
        step: 'Read the method and validation results',
        result: {
          model: model.name, weights_status: model.weights_status,
          terms: model.terms.map(t => ({ input: t.label, weight: t.weight, transform: t.transform })),
          scenarios: model.scenarios.map(s => ({ key: s.key, rain: s.rain, high_from_score: s.high, moderate_from_score: s.moderate })),
          high_risk_zone_min_km2: model.zone_min_km2,
          validation: v.sites.map(s => ({
            site: s.name, kind: s.kind, outside_scope: s.outside_scope, expected: s.expect,
            model_class_normal: s.scenarios.normal.point, passed: s.pass,
            high_within_radius_pct: s.scenarios.normal.high_share_500m === null ? null : Math.round(s.scenarios.normal.high_share_500m * 100),
            radius_m: v.radius_m, report: s.report,
          })),
          sources: SOURCES, limitations: CAVEATS,
        },
      };
    }
    case 'set_map_view': {
      const scen = input.scenario === null ? null : scenarioOf(ctx, input.scenario).key;
      const daerah = input.daerah === null || input.daerah === undefined ? null : String(input.daerah);
      if (daerah !== null && daerah !== 'all') daerahId(daerah);
      const list = (k: string): MapLayerName[] => {
        const v = input[k];
        if (!Array.isArray(v)) throw new ToolInputError(`${k} must be an array`);
        for (const x of v) if (!(MAP_LAYERS as readonly string[]).includes(x)) throw new ToolInputError(`unknown layer ${x}`);
        return v as MapLayerName[];
      };
      const on = list('layers_on'), off = list('layers_off');
      const v = ctx.actions.setView({ scenario: scen, daerah, on, off });
      const what = [scen && `${scen} rain`, daerah && (daerah === 'all' ? 'all Selangor' : daerah), on.length && `+${on.join(', ').replace(/_/g, ' ')}`]
        .filter(Boolean).join(' · ');
      return {
        step: `Set the map${what ? `: ${what}` : ''}`,
        result: { scenario: v.scenario, selected_daerah: v.selectedDaerah, visible_layers: v.layers },
      };
    }
    case 'find_candidate_sites': {
      if (!grid.detail) throw new ToolInputError('terrain layers are still loading; try again in a few seconds');
      const sc = scenarioOf(ctx, input.low_under);
      const minHa = clamp(num(input, 'min_area_ha'), 1, 500);
      const max = clamp(Math.round(num(input, 'max_sites')), 1, 8);
      const purpose = str(input, 'purpose').slice(0, 40) || 'site';
      const area = ctx.getView().activeArea;
      let scope: Int32Array, where: string;
      if (input.daerah !== null && input.daerah !== undefined) {
        const id = daerahId(input.daerah);
        scope = ctx.daerahCells(id); where = DAERAH_NAMES[id - 1];
      } else if (area) {
        scope = rasterizePolygon(grid.meta, area.rings); where = area.label;
      } else {
        scope = ctx.daerahCells(0); where = 'Selangor';
      }
      let screened = 0;
      for (const i of scope) if (isCandidateCell(grid, model, i, sc)) screened++;
      const sites = findCandidateSites(grid, model, scope, sc, minHa / 100, max);
      ctx.actions.showSites(sites, purpose);
      return {
        step: `Screened ${where} for ${purpose} sites (Low under ${sc.label}, ≥ ${minHa} ha)`,
        result: {
          scope: where,
          criteria: { low_under: sc.key, min_area_ha: minHa, max_slope_deg: 12, max_built_up_pct: 20, excludes: 'water and forest-dominated cells' },
          screened_land_ha: Math.round(screened * grid.meta.cell_km2 * 100),
          sites: sites.map(x => ({
            site: `S${x.rank}`, area_ha: Math.round(x.area_km2 * 1000) / 10,
            latitude: Math.round(x.centre[1] * 1e4) / 1e4, longitude: Math.round(x.centre[0] * 1e4) / 1e4,
            daerah: x.daerah, mean_score: r2(x.score_mean), mean_slope_deg: r1(x.slope_mean),
            median_height_above_drainage_m: r1(x.hand_median), nearest_high_cell_m: x.nearest_high_m,
          })),
          note: sites.length
            ? 'Marked on the map as S1, S2, … Screening only: zoning, land status, access and a site flood study are not checked.'
            : 'No block of that size passes the screen here. Try a smaller minimum area, a milder scenario, or another daerah.',
        },
      };
    }
    case 'show_on_map': {
      const lat = num(input, 'latitude'), lon = num(input, 'longitude');
      insideGrid(ctx, lat, lon);
      const label = str(input, 'label').slice(0, 60);
      ctx.actions.showPoint(lat, lon, label);
      return { step: `Showed ${label || 'the spot'} on the map`, result: { shown: true } };
    }
    default:
      throw new ToolInputError(`unknown tool ${name}`);
  }
}

export function runTool(ctx: ToolContext, name: string, input: unknown): ToolOutcome {
  try {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ToolInputError('input must be an object');
    return run(ctx, name, input as Record<string, unknown>);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { step: `Tool ${name} failed: ${msg}`, result: { error: msg }, isError: true };
  }
}
