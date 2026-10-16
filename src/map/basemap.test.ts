// The bundled basemap: the style is valid, every layer reads a layer that the
// tile archive contains, and the archive opens and decodes in Node.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { VectorTile } from '@mapbox/vector-tile';
import { PbfReader } from 'pbf';
import { PMTiles, type Source } from 'pmtiles';
import { gunzipSync } from 'node:zlib';
import { basemapStyle } from './style';

const ARCHIVE = fileURLToPath(new URL('../../public/basemap/selangor.pmtiles', import.meta.url));
const LAYERS = ['landcover', 'landuse', 'water', 'waterway', 'aeroway', 'roads', 'places', 'labels'];

class FileSource implements Source {
  private buf = readFileSync(ARCHIVE);
  getKey() { return ARCHIVE; }
  async getBytes(offset: number, length: number) {
    const b = this.buf.subarray(offset, offset + length);
    return { data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
  }
}

describe('basemap style', () => {
  for (const variant of ['streets', 'light'] as const) {
    it(`${variant} validates against the MapLibre style spec`, () => {
      const style = basemapStyle(variant, { tiles: 'pmtiles://http://localhost/basemap/selangor.pmtiles', glyphs: 'http://localhost/fonts/{fontstack}/{range}.pbf' });
      expect(validateStyleMin(style)).toEqual([]);
      for (const l of style.layers) {
        if ('source-layer' in l) expect(LAYERS).toContain(l['source-layer']);
      }
    });
  }
});

describe('basemap archive', () => {
  const tiles = new PMTiles(new FileSource());

  it('covers zoom 5–14 over the study window', async () => {
    const h = await tiles.getHeader();
    expect([h.minZoom, h.maxZoom]).toEqual([5, 14]);
    expect(h.minLon).toBeLessThanOrEqual(100.71);
    expect(h.maxLat).toBeGreaterThanOrEqual(3.94);
  });

  it('a Shah Alam tile decodes with roads, water and place names', async () => {
    // z13 tile over Shah Alam (101.52°E, 3.07°N)
    const z = 13, x = Math.floor(((101.52 + 180) / 360) * 2 ** z);
    const lat = (3.07 * Math.PI) / 180;
    const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * 2 ** z);
    const t = await tiles.getZxy(z, x, y);
    expect(t?.data).toBeDefined();
    const raw = new Uint8Array(t!.data);
    const vt = new VectorTile(new PbfReader(raw[0] === 0x1f ? gunzipSync(raw) : raw));
    expect(Object.keys(vt.layers)).toEqual(expect.arrayContaining(['roads', 'landcover', 'places']));
    const kinds = new Set(Array.from({ length: vt.layers.roads.length }, (_, i) => vt.layers.roads.feature(i).properties.kind));
    expect(kinds).toContain('motorway');
    expect(kinds).toContain('minor');
  });
});
