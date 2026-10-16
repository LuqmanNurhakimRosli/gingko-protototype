// Cut the GeoJSON layers written by 05_basemap.py into Mapbox Vector Tiles.
// Each (layer, zoom band) file gets its own geojson-vt index, so a feature is
// only present in tiles inside its band. Output: <out>/z/x/y.pbf (gzipped).
//   node pipeline/tiles.mjs <job.json>

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { GeoJSONVT } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';

const jobPath = process.argv[2];
const job = JSON.parse(readFileSync(jobPath, 'utf8'));
const dir = dirname(jobPath);

const bands = Object.entries(job.bands).map(([file, b]) => {
  const index = new GeoJSONVT(JSON.parse(readFileSync(join(dir, file), 'utf8')), {
    maxZoom: job.maxzoom, indexMaxZoom: 5, tolerance: 3, extent: 4096, buffer: 64,
  });
  return { ...b, index };
});

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

const [xmin, ymin, xmax, ymax] = job.bbox;
let tiles = 0, bytes = 0;
for (let z = job.minzoom; z <= job.maxzoom; z++) {
  const active = bands.filter(b => b.minzoom <= z && z <= b.maxzoom);
  let zBytes = 0, zTiles = 0, largest = 0;
  for (let x = lon2x(xmin, z); x <= lon2x(xmax, z); x++) {
    for (let y = lat2y(ymax, z); y <= lat2y(ymin, z); y++) {
      const layers = {};
      for (const b of active) {
        const t = b.index.getTile(z, x, y);
        if (!t || !t.features.length) continue;
        if (layers[b.layer]) layers[b.layer].features.push(...t.features);
        else layers[b.layer] = { ...t, features: [...t.features] };
      }
      if (!Object.keys(layers).length) continue;
      const pbf = gzipSync(fromGeojsonVt(layers, { version: 2, extent: 4096 }), { level: 9 });
      mkdirSync(join(job.out, String(z), String(x)), { recursive: true });
      writeFileSync(join(job.out, String(z), String(x), `${y}.pbf`), pbf);
      zBytes += pbf.length; zTiles++; largest = Math.max(largest, pbf.length);
    }
  }
  tiles += zTiles; bytes += zBytes;
  console.log(`  z${z}: ${zTiles} tiles, ${(zBytes / 1e6).toFixed(2)} MB (largest ${(largest / 1e3).toFixed(0)} kB)`);
}
console.log(`  total ${tiles} tiles, ${(bytes / 1e6).toFixed(1)} MB`);
