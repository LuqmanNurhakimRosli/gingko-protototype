// Test helper: loads the real public/data files from disk (Node only).
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { FeatureCollection } from 'geojson';
import type {
  AppDataBundle, FacilitiesFile, Grid, GridDetail, GridMeta, LayerIndex, ModelSpec, Place, RailFile, StatsFile, ValidationFile,
} from '../data/types';

const dir = new URL('../../public/data/', import.meta.url);
export const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;

function decode(file: string, layers: LayerIndex[], n: number): Record<string, ArrayLike<number>> {
  const raw = gunzipSync(readFileSync(new URL(file, dir)));
  const buf = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer;
  const out: Record<string, ArrayLike<number>> = {};
  for (const l of layers) {
    out[l.name] = l.dtype === 'uint8' ? new Uint8Array(buf, l.offset, n)
      : l.dtype === 'uint16' ? new Uint16Array(buf, l.offset, n) : new Int16Array(buf, l.offset, n);
  }
  return out;
}

export function loadBundle(): AppDataBundle {
  const meta = json<GridMeta>('grid.json');
  const n = meta.width * meta.height;
  const grid = {
    meta,
    ...decode('grid_core.bin.gz', meta.files['grid_core.bin.gz'], n),
    detail: decode('grid_detail.bin.gz', meta.files['grid_detail.bin.gz'], n) as unknown as GridDetail,
  } as unknown as Grid;
  return {
    grid,
    stats: json<StatsFile>('stats.json'),
    model: json<ModelSpec>('model.json'),
    validation: json<ValidationFile>('validation.json'),
    daerah: json<FeatureCollection>('daerah.json'),
    rivers: json<FeatureCollection>('rivers.json'),
    places: json<Place[]>('places.json'),
    facilities: json<FacilitiesFile>('facilities.json'),
    rail: json<RailFile>('rail.json'),
  };
}

export function cellsOf(grid: Grid, id: number): Int32Array {
  const out: number[] = [];
  for (let i = 0; i < grid.daerah.length; i++) if (grid.daerah[i] === id) out.push(i);
  return Int32Array.from(out);
}
