// Consistency tests: the browser-side counting in analysis.ts must reproduce the
// numbers the Python pipeline wrote to public/data (same cells, same rules).

import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import type { FeatureCollection, Polygon, MultiPolygon } from 'geojson';
import { describe, expect, it } from 'vitest';
import { analyseCells, analysePolygon, classOf, polygonAreaKm2, queryCell, rasterizePolygon, type Ring } from './analysis';
import type { Grid, GridDetail, GridMeta, LayerIndex, ModelSpec, StatsFile, ValidationFile } from './types';

const dir = new URL('../../public/data/', import.meta.url);
const json = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, dir), 'utf8')) as T;

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

const meta = json<GridMeta>('grid.json');
const n = meta.width * meta.height;
const grid = {
  meta,
  ...decode('grid_core.bin.gz', meta.files['grid_core.bin.gz'], n),
  detail: decode('grid_detail.bin.gz', meta.files['grid_detail.bin.gz'], n) as unknown as GridDetail,
} as unknown as Grid;
const model = json<ModelSpec>('model.json');
const stats = json<StatsFile>('stats.json');
const validation = json<ValidationFile>('validation.json');
const daerahGeo = json<FeatureCollection>('daerah.json');

const cellsOf = (id: number) => {
  const out: number[] = [];
  for (let i = 0; i < n; i++) if (grid.daerah[i] === id) out.push(i);
  return Int32Array.from(out);
};

describe('daerah aggregates match the pipeline', () => {
  for (const d of stats.daerah) {
    it(d.name, () => {
      const r = analyseCells(grid, model, cellsOf(d.id), d.area_km2);
      expect(r.land_km2).toBeCloseTo(d.land_km2, 0);
      for (const sc of model.scenarios) {
        const mine = r.scenarios[sc.key], theirs = d.scenarios[sc.key];
        expect(Math.abs(mine.high_km2 - theirs.high_km2)).toBeLessThan(0.1);
        expect(Math.abs(mine.moderate_km2 - theirs.moderate_km2)).toBeLessThan(0.1);
        expect(mine.zones).toBe(theirs.zones);
        // population is stored ×10 per cell; allow rounding plus the pipeline's round-to-100
        expect(Math.abs(mine.pop_high - theirs.pop_high)).toBeLessThan(Math.max(100, theirs.pop_high * 0.002));
      }
      // total population matches the DOSM census figure the layer was scaled to
      expect(Math.abs(r.population - d.population) / d.population).toBeLessThan(0.001);
      // "Why this score": contributions recomputed from the layers ≈ the stored score
      expect(r.detail).not.toBeNull();
      expect(Math.abs(r.detail!.why_sum - r.score_mean)).toBeLessThan(0.01);
    });
  }
});

describe('drawing', () => {
  it('measures a 0.1° box near 3°N at ~123 km² and rasterizes the matching cell count', () => {
    const ring: Ring = [[101.4, 3.0], [101.5, 3.0], [101.5, 3.1], [101.4, 3.1]];
    const km2 = polygonAreaKm2([ring]);
    expect(km2).toBeGreaterThan(122.5);
    expect(km2).toBeLessThan(124.5);
    const cells = rasterizePolygon(meta, [ring]);
    expect(Math.abs(cells.length * meta.cell_km2 - km2) / km2).toBeLessThan(0.02);
  });

  it('respects holes (even–odd rule)', () => {
    const outer: Ring = [[101.4, 3.0], [101.6, 3.0], [101.6, 3.2], [101.4, 3.2]];
    const hole: Ring = [[101.45, 3.05], [101.55, 3.05], [101.55, 3.15], [101.45, 3.15]];
    const full = rasterizePolygon(meta, [outer]).length;
    const holed = rasterizePolygon(meta, [outer, hole]).length;
    const inner = rasterizePolygon(meta, [hole]).length;
    expect(Math.abs(full - holed - inner)).toBeLessThan(inner * 0.02);
  });

  it('a drawn daerah outline gives the same picture as the daerah itself', () => {
    const f = daerahGeo.features.find(x => x.properties?.name === 'Petaling')!;
    const g = f.geometry as Polygon | MultiPolygon;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    // analyse the largest part (simplified outline → small edge differences expected)
    const rings = polys.sort((a, b) => b[0].length - a[0].length)[0] as Ring[];
    const r = analysePolygon(grid, model, rings);
    const d = stats.daerah.find(x => x.name === 'Petaling')!;
    expect(Math.abs(r.scenarios.normal.high_pct - d.scenarios.normal.high_pct)).toBeLessThan(1.5);
    expect(r.daerah[0].name).toBe('Petaling');
  });
});

describe('validation sites', () => {
  it('cell queries reproduce the pipeline class at every site', () => {
    for (const s of validation.sites) {
      const info = queryCell(grid, model, s.lonlat[0], s.lonlat[1])!;
      expect(info).not.toBeNull();
      for (const sc of model.scenarios) {
        const name = ['Water', 'Low', 'Moderate', 'High'][classOf(info.scoreByte, sc)];
        expect(name, `${s.name} · ${sc.key}`).toBe(s.scenarios[sc.key].point);
      }
    }
  });
});
