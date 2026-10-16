// Ginkgo Command Center — data contracts for the precomputed files in public/data.
// Everything here is produced offline by pipeline/*.py; the app only reads it.

import type { FeatureCollection } from 'geojson';

export type ScenarioKey = 'normal' | 'heavy' | 'extreme';
export type RiskClass = 'High' | 'Moderate' | 'Low';

export interface ModelTerm {
  key: 'hand' | 'prox' | 'flat' | 'elev' | 'hist';
  label: string;
  weight: number;
  transform: string;
  why: string;
  scale_m?: number;
  scale_deg?: number;
  scale_share?: number;
}

export interface Scenario {
  key: ScenarioKey;
  label: string;
  rain: string;
  high: number;
  moderate: number;
  note: string;
}

export interface ModelSpec {
  name: string;
  weights_status: string;
  terms: ModelTerm[];
  scenarios: Scenario[];
  zone_min_km2: number;
  anchors: { desc: string; score: number }[];
  built: string;
}

export interface ScenarioStats {
  high_km2: number;
  moderate_km2: number;
  low_km2?: number;
  high_pct: number;
  moderate_pct: number;
  zones: number;
  pop_high: number;
  pop_moderate?: number;
  built_high_km2?: number;
}

export interface DaerahStats {
  id: number;
  name: string;
  area_km2: number;
  land_km2: number;
  population: number;
  population_hrsl: number;
  built_pct: number;
  built_km2: number;
  river_km: number;
  elev_min: number;
  elev_max: number;
  hand_median: number;
  scenarios: Record<ScenarioKey, ScenarioStats>;
}

export interface StatsFile {
  built: string;
  state: {
    area_km2: number;
    land_km2: number;
    population: number;
    scenarios: Record<ScenarioKey, ScenarioStats>;
  };
  daerah: DaerahStats[];
  pop_scale: Record<string, number>;
}

export interface ValidationSite {
  id: string;
  name: string;
  daerah: string;
  kind: 'reported_flood' | 'hilly_control';
  expect: RiskClass;
  pass: boolean;
  outside_scope: boolean;
  lonlat: [number, number];
  score: number;
  inputs: { hand_m: number; river_m: number; slope_deg: number; elev_m: number; hist_pct: number };
  scenarios: Record<ScenarioKey, { point: RiskClass; high_share_500m: number | null }>;
  report: string;
  sources: string[];
  resolved_from?: string;
}

export interface ValidationFile {
  built: string;
  radius_m: number;
  sites: ValidationSite[];
}

export interface Place {
  n: string;
  t: string;
  c: [number, number];
  b: [number, number, number, number];
}

export interface LayerIndex {
  name: string;
  dtype: 'uint8' | 'uint16' | 'int16';
  scale: number;
  offset: number;
  desc: string;
}

export interface GridMeta {
  x0: number;
  y1: number;
  res: number;
  width: number;
  height: number;
  cell_m: [number, number];
  cell_km2: number;
  files: Record<string, LayerIndex[]>;
  built: string;
}

/** Decoded analysis grid. Raw integer arrays; scale factors are in `meta`. */
export interface Grid {
  meta: GridMeta;
  score: Uint8Array;     // 0–200 = score×200, 254 water, 255 outside
  daerah: Uint8Array;    // 1–9 daerah, 10 federal territory, 0 outside
  pop: Uint16Array;      // people × 10
  built: Uint8Array;     // %
  hist: Uint8Array;      // %
  river_len: Uint16Array; // m
  detail?: GridDetail;
}

export interface GridDetail {
  tree: Uint8Array;      // %
  crop: Uint8Array;      // %
  water: Uint8Array;     // %
  hand: Uint16Array;     // m × 10
  slope: Uint8Array;     // ° × 4
  elev: Int16Array;      // m
  river_dist: Uint16Array; // m
}

export interface AppDataBundle {
  grid: Grid;
  stats: StatsFile;
  model: ModelSpec;
  validation: ValidationFile;
  daerah: FeatureCollection;
  rivers: FeatureCollection;
  places: Place[];
}

export const SCORE_WATER = 254;
export const SCORE_OUTSIDE = 255;
export const FEDERAL_TERRITORY = 10;
