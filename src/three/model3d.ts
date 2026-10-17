// Ginkgo 3D view — loads the massing model built by pipeline/07_model3d.py and
// turns it into three.js geometry: white extruded buildings, their outline
// edges (the "drawing" look), streets, rivers and the drill's water surface.

import * as THREE from 'three';
import { gunzip, json } from '../data/load';
import type { Grid } from '../data/types';
import type { LonLat } from '../data/analysis';
import { NEVER, depthAt, type FloodSim } from '../sim/flood';

interface Layout { name: string; dtype: 'uint32' | 'int16' | 'uint16' | 'uint8'; offset: number; length: number }
export interface ModelMeta {
  name: string;
  source: string;
  retrieved: string;
  origin: [number, number];
  bbox: [number, number, number, number];
  metres_per_degree: [number, number];
  unit_m: number;
  note: string;
  buildings: number;
  heights_estimated: number;
  road_classes: string[];
  road_width_m: number[];
  river_classes: string[];
  river_width_m: number[];
  centres: { id: number; n: string; k: string; x: number; y: number }[];
  labels: { n: string; kind: 'place' | 'water' | 'road'; x: number; y: number }[];
  layout: Layout[];
}
export interface Model3D {
  meta: ModelMeta;
  a: Record<string, Uint32Array | Int16Array | Uint16Array | Uint8Array>;
}

const VIEW = { uint32: Uint32Array, int16: Int16Array, uint16: Uint16Array, uint8: Uint8Array } as const;

export async function loadModel3D(): Promise<Model3D> {
  const [meta, buf] = await Promise.all([json<ModelMeta>('model3d.json'), gunzip('model3d.bin.gz')]);
  const a: Model3D['a'] = {};
  for (const l of meta.layout) a[l.name] = new VIEW[l.dtype](buf, l.offset, l.length);
  return { meta, a };
}

/** Local metres (east, north) → three.js (x = east, z = south, y = up). */
export const toLocal = (m: ModelMeta, [lon, lat]: LonLat): [number, number] =>
  [(lon - m.origin[0]) * m.metres_per_degree[0], -(lat - m.origin[1]) * m.metres_per_degree[1]];

function polys(model: Model3D, counts: string, xy: string): [number, number][][] {
  const c = model.a[counts] as Uint32Array, p = model.a[xy] as Int16Array, u = model.meta.unit_m;
  const out: [number, number][][] = [];
  let k = 0;
  for (let i = 0; i < c.length; i++) {
    const ring: [number, number][] = [];
    for (let j = 0; j < c[i]; j++, k += 2) ring.push([p[k] * u, -p[k + 1] * u]);
    out.push(ring);
  }
  return out;
}

/** Buildings as one mesh (walls + flat roofs) and one set of outline edges. */
export function buildingGeometry(model: Model3D): { mesh: THREE.BufferGeometry; edges: THREE.BufferGeometry } {
  const rings = polys(model, 'building_counts', 'building_xy');
  const h = model.a.building_h as Uint16Array;
  const pos: number[] = [];
  const edge: number[] = [];
  rings.forEach((ring, b) => {
    const top = h[b] / 2;
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const [x1, z1] = ring[i], [x2, z2] = ring[(i + 1) % n];
      pos.push(x1, 0, z1, x2, 0, z2, x2, top, z2, x1, 0, z1, x2, top, z2, x1, top, z1);
      edge.push(x1, top, z1, x2, top, z2, x1, 0, z1, x1, top, z1);
    }
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) pos.push(ring[i][0], top, ring[i][1], ring[j][0], top, ring[j][1], ring[k][0], top, ring[k][1]);
  });
  const mesh = new THREE.BufferGeometry();
  mesh.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  mesh.computeVertexNormals();
  const edges = new THREE.BufferGeometry();
  edges.setAttribute('position', new THREE.Float32BufferAttribute(edge, 3));
  return { mesh, edges };
}

/** Flat ribbons along polylines (streets, rivers), widths per class. */
export function ribbonGeometry(model: Model3D, counts: string, xy: string, cls: string, widths: number[], y: number, scale = 1): THREE.BufferGeometry {
  const lines = polys(model, counts, xy);
  const c = model.a[cls] as Uint8Array;
  const pos: number[] = [];
  lines.forEach((line, li) => {
    const w = (widths[c[li]] ?? 6) * scale / 2;
    for (let i = 0; i + 1 < line.length; i++) {
      const [x1, z1] = line[i], [x2, z2] = line[i + 1];
      const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz) || 1;
      const nx = (-dz / len) * w, nz = (dx / len) * w;
      // extend each piece by half a width so joints close
      const ex = (dx / len) * w * 0.5, ez = (dz / len) * w * 0.5;
      const a = [x1 - ex + nx, z1 - ez + nz], b = [x1 - ex - nx, z1 - ez - nz];
      const cc = [x2 + ex - nx, z2 + ez - nz], d = [x2 + ex + nx, z2 + ez + nz];
      pos.push(a[0], y, a[1], b[0], y, b[1], cc[0], y, cc[1], a[0], y, a[1], cc[0], y, cc[1], d[0], y, d[1]);
    }
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function waterPolygons(model: Model3D, y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  for (const ring of polys(model, 'water_counts', 'water_xy')) {
    const tris = THREE.ShapeUtils.triangulateShape(ring.map(([x, z]) => new THREE.Vector2(x, z)), []);
    for (const [i, j, k] of tris) pos.push(ring[i][0], y, ring[i][1], ring[j][0], y, ring[j][1], ring[k][0], y, ring[k][1]);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** The drill's water as a surface over the grid cells in the model box. */
export class FloodSurface {
  readonly geometry: THREE.BufferGeometry;
  private cells: { r0: number; c0: number; nr: number; nc: number };
  private grid: Grid;
  constructor(model: Model3D, grid: Grid) {
    this.grid = grid;
    const { meta } = grid;
    const [w, s, e, n] = model.meta.bbox;
    const c0 = Math.floor((w - meta.x0) / meta.res), c1 = Math.ceil((e - meta.x0) / meta.res);
    const r0 = Math.floor((meta.y1 - n) / meta.res), r1 = Math.ceil((meta.y1 - s) / meta.res);
    this.cells = { r0, c0, nr: r1 - r0, nc: c1 - c0 };
    const pos = new Float32Array((this.cells.nr + 1) * (this.cells.nc + 1) * 3);
    for (let r = 0; r <= this.cells.nr; r++) {
      for (let c = 0; c <= this.cells.nc; c++) {
        const [x, z] = toLocal(model.meta, [meta.x0 + (c0 + c) * meta.res, meta.y1 - (r0 + r) * meta.res]);
        const k = (r * (this.cells.nc + 1) + c) * 3;
        pos[k] = x; pos[k + 1] = -5; pos[k + 2] = z;
      }
    }
    const idx: number[] = [];
    const W = this.cells.nc + 1;
    for (let r = 0; r < this.cells.nr; r++) {
      for (let c = 0; c < this.cells.nc; c++) {
        const a = r * W + c, b = a + 1, d = a + W, cc = d + 1;
        idx.push(a, d, b, b, d, cc);
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.geometry.setIndex(idx);
  }

  /** Set the surface for drill minute t; returns the deepest and typical depth in the box (m). */
  update(sim: FloodSim | null, t: number): { max: number; median: number; flooded: number } {
    const { nr, nc, r0, c0 } = this.cells;
    const { width } = this.grid.meta;
    const depth = new Float32Array(nr * nc).fill(-1);
    const wet: number[] = [];
    if (sim) {
      for (let r = 0; r < nr; r++) {
        for (let c = 0; c < nc; c++) {
          const i = (r0 + r) * width + (c0 + c);
          const o = sim.onset[i];
          if (o === NEVER || o > t) continue;
          const d = depthAt(sim, this.grid.score[i] / 200, t);
          depth[r * nc + c] = d;
          wet.push(d);
        }
      }
    }
    // each corner takes the deepest of its wet neighbours; dry corners sink below ground
    const pos = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let r = 0; r <= nr; r++) {
      for (let c = 0; c <= nc; c++) {
        let d = -1;
        for (const [rr, cc] of [[r - 1, c - 1], [r - 1, c], [r, c - 1], [r, c]]) {
          if (rr >= 0 && cc >= 0 && rr < nr && cc < nc) d = Math.max(d, depth[rr * nc + cc]);
        }
        pos.setY(r * (nc + 1) + c, d > 0 ? d : -4);
      }
    }
    pos.needsUpdate = true;
    this.geometry.computeVertexNormals();
    wet.sort((a, b) => a - b);
    return { max: wet.length ? wet[wet.length - 1] : 0, median: wet.length ? wet[wet.length >> 1] : 0, flooded: wet.length };
  }
}
