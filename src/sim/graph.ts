// Ginkgo flood drill — the road graph built by pipeline/06_evacuation.py.
// Undirected roads between junctions; each edge knows its length, class, name,
// shape and the grid cell with the lowest height above drainage along it.

import type { LonLat } from '../data/analysis';

export interface RoadLayout { name: string; dtype: 'int32' | 'uint32' | 'float32' | 'uint16' | 'uint8'; offset: number; length: number }
export interface RoadsMeta {
  source: string;
  retrieved: string;
  note: string;
  nodes: number;
  edges: number;
  classes: { name: string; kmh: number }[];
  names: string[];
  layout: RoadLayout[];
}

export interface RoadGraph {
  meta: RoadsMeta;
  n: number;            // junctions
  m: number;            // edges
  lon: Float64Array;    // junction coordinates, degrees
  lat: Float64Array;
  ea: Uint32Array; eb: Uint32Array;
  len: Float32Array;    // metres
  cls: Uint8Array;      // index into meta.classes
  name: Int32Array;     // index into meta.names, -1 unnamed
  low: Int32Array;      // grid cell with the lowest HAND along the edge, -1 none
  geo: Uint32Array;     // offsets into the shape points (interior vertices only)
  glon: Int32Array; glat: Int32Array; // micro-degrees
  // adjacency (CSR): for node v, slots adjStart[v]..adjStart[v+1]
  adjStart: Int32Array; adjEdge: Int32Array; adjNode: Int32Array;
  // bucket index for nearest-junction lookups
  bucket: { x0: number; y0: number; size: number; w: number; h: number; start: Int32Array; nodes: Int32Array };
}

const VIEW = {
  int32: Int32Array, uint32: Uint32Array, float32: Float32Array, uint16: Uint16Array, uint8: Uint8Array,
} as const;

export function decodeRoads(buf: ArrayBuffer, meta: RoadsMeta): RoadGraph {
  const a: Record<string, ArrayLike<number>> = {};
  for (const l of meta.layout) a[l.name] = new VIEW[l.dtype](buf, l.offset, l.length);
  const n = meta.nodes, m = meta.edges;
  const lon = new Float64Array(n), lat = new Float64Array(n);
  const ilon = a.node_lon as Int32Array, ilat = a.node_lat as Int32Array;
  for (let i = 0; i < n; i++) { lon[i] = ilon[i] / 1e6; lat[i] = ilat[i] / 1e6; }
  const ea = a.edge_a as Uint32Array, eb = a.edge_b as Uint32Array;

  const deg = new Int32Array(n + 1);
  for (let e = 0; e < m; e++) { deg[ea[e] + 1]++; deg[eb[e] + 1]++; }
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const adjStart = deg;
  const fill = adjStart.slice(0, n);
  const adjEdge = new Int32Array(2 * m), adjNode = new Int32Array(2 * m);
  for (let e = 0; e < m; e++) {
    let s = fill[ea[e]]++; adjEdge[s] = e; adjNode[s] = eb[e];
    s = fill[eb[e]]++; adjEdge[s] = e; adjNode[s] = ea[e];
  }

  // ~550 m buckets
  const size = 0.005;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { x0 = Math.min(x0, lon[i]); x1 = Math.max(x1, lon[i]); y0 = Math.min(y0, lat[i]); y1 = Math.max(y1, lat[i]); }
  const w = Math.floor((x1 - x0) / size) + 1, h = Math.floor((y1 - y0) / size) + 1;
  const key = new Int32Array(n);
  const start = new Int32Array(w * h + 1);
  for (let i = 0; i < n; i++) {
    key[i] = Math.floor((lat[i] - y0) / size) * w + Math.floor((lon[i] - x0) / size);
    start[key[i] + 1]++;
  }
  for (let k = 0; k < w * h; k++) start[k + 1] += start[k];
  const pos = start.slice(0, w * h);
  const nodes = new Int32Array(n);
  for (let i = 0; i < n; i++) nodes[pos[key[i]]++] = i;

  return {
    meta, n, m, lon, lat, ea, eb,
    len: a.edge_len as Float32Array, cls: a.edge_cls as Uint8Array, name: a.edge_name as Int32Array,
    low: a.edge_low as Int32Array, geo: a.edge_geo as Uint32Array,
    glon: a.geo_lon as Int32Array, glat: a.geo_lat as Int32Array,
    adjStart, adjEdge, adjNode,
    bucket: { x0, y0, size, w, h, start, nodes },
  };
}

/** Metres between two points (equirectangular; fine at these distances). */
export function metres(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const kx = 111_320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
  return Math.hypot((lon2 - lon1) * kx, (lat2 - lat1) * 110_574);
}

/** Nearest junction within maxM metres, or -1. `accept` can skip junctions. */
export function nearestNode(g: RoadGraph, lon: number, lat: number, maxM = 1500, accept?: (v: number) => boolean): number {
  const { x0, y0, size, w, h, start, nodes } = g.bucket;
  const bx = Math.floor((lon - x0) / size), by = Math.floor((lat - y0) / size);
  const rings = Math.ceil(maxM / (size * 110_000)) + 1;
  let best = -1, bestD = maxM;
  for (let r = 0; r <= rings; r++) {
    // once a ring is wholly farther than the best hit, stop
    if (best >= 0 && (r - 1) * size * 110_000 > bestD) break;
    for (let y = by - r; y <= by + r; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = bx - r; x <= bx + r; x++) {
        if (x < 0 || x >= w || (Math.abs(x - bx) !== r && Math.abs(y - by) !== r)) continue;
        const k = y * w + x;
        for (let s = start[k]; s < start[k + 1]; s++) {
          const v = nodes[s];
          const d = metres(lon, lat, g.lon[v], g.lat[v]);
          if (d < bestD && (!accept || accept(v))) { bestD = d; best = v; }
        }
      }
    }
  }
  return best;
}

/** Shape of edge e walked from junction `from`, as [lon, lat] points. */
export function edgeShape(g: RoadGraph, e: number, from: number): LonLat[] {
  const pts: LonLat[] = [[g.lon[g.ea[e]], g.lat[g.ea[e]]]];
  for (let s = g.geo[e]; s < g.geo[e + 1]; s++) pts.push([g.glon[s] / 1e6, g.glat[s] / 1e6]);
  pts.push([g.lon[g.eb[e]], g.lat[g.eb[e]]]);
  return from === g.ea[e] ? pts : pts.reverse();
}

export const roadName = (g: RoadGraph, e: number): string | null => (g.name[e] >= 0 ? g.meta.names[g.name[e]] : null);
