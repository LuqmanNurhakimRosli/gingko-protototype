// Ginkgo Command Center — loads the precomputed data files.
// No analysis happens here: the grid is decoded into typed arrays and handed on.

import type { FeatureCollection } from 'geojson';
import type {
  AppDataBundle, FacilitiesFile, Grid, GridDetail, GridMeta, LayerIndex, ModelSpec, Place, RailFile, StatsFile,
  ValidationFile,
} from './types';

const BASE = `${import.meta.env.BASE_URL}data/`;

export async function json<T>(name: string): Promise<T> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

/** Fetch a .gz file. Some static hosts already decode it (Content-Encoding),
 *  others serve the raw gzip bytes; check the magic number and handle both. */
export async function gunzip(name: string): Promise<ArrayBuffer> {
  const res = await fetch(BASE + name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const head = new Uint8Array(buf, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return buf;
  const stream = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

function view(buf: ArrayBuffer, layer: LayerIndex, n: number) {
  switch (layer.dtype) {
    case 'uint8': return new Uint8Array(buf, layer.offset, n);
    case 'uint16': return new Uint16Array(buf, layer.offset, n);
    case 'int16': return new Int16Array(buf, layer.offset, n);
  }
}

function decode(buf: ArrayBuffer, layers: LayerIndex[], n: number): Record<string, ArrayLike<number>> {
  const out: Record<string, ArrayLike<number>> = {};
  for (const l of layers) out[l.name] = view(buf, l, n);
  return out;
}

export async function loadCore(): Promise<AppDataBundle> {
  const [meta, stats, model, validation, daerah, rivers, places, facilities, rail] = await Promise.all([
    json<GridMeta>('grid.json'),
    json<StatsFile>('stats.json'),
    json<ModelSpec>('model.json'),
    json<ValidationFile>('validation.json'),
    json<FeatureCollection>('daerah.json'),
    json<FeatureCollection>('rivers.json'),
    json<Place[]>('places.json'),
    json<FacilitiesFile>('facilities.json'),
    json<RailFile>('rail.json'),
  ]);
  const n = meta.width * meta.height;
  const core = decode(await gunzip('grid_core.bin.gz'), meta.files['grid_core.bin.gz'], n);
  const grid = { meta, ...core } as unknown as Grid;
  return { grid, stats, model, validation, daerah, rivers, places, facilities, rail };
}

export async function loadDetail(meta: GridMeta): Promise<GridDetail> {
  const n = meta.width * meta.height;
  const d = decode(await gunzip('grid_detail.bin.gz'), meta.files['grid_detail.bin.gz'], n);
  return d as unknown as GridDetail;
}
