// Ginkgo Command Center — paints grid layers into canvases for the map's image overlays.
// Pure rendering of precomputed values; class thresholds come from model.json.

import { classOf, isCandidateCell } from './analysis';
import { BUILT_RGB, HISTORY_RGB, RISK_RGB, SAFE_RGB } from './format';
import type { Grid, GridMeta, ModelSpec, Scenario } from './types';

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** Source grid row for each image row. The map stretches an image linearly in
 *  Web Mercator, so rows are spaced in Mercator y (≤ 30 m shift otherwise). */
function mercatorRows(meta: GridMeta): Int32Array {
  const { y1, res, height } = meta;
  const top = mercY(y1), bottom = mercY(y1 - height * res);
  const rows = new Int32Array(height);
  for (let r = 0; r < height; r++) {
    const lat = latOf(top + ((bottom - top) * (r + 0.5)) / height);
    rows[r] = Math.min(height - 1, Math.max(0, Math.floor((y1 - lat) / res)));
  }
  return rows;
}

function paint(grid: Grid, fill: (i: number, px: Uint8ClampedArray, o: number) => void): HTMLCanvasElement {
  const { width, height } = grid.meta;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const px = img.data;
  const rows = mercatorRows(grid.meta);
  for (let r = 0, o = 0; r < height; r++) {
    const base = rows[r] * width;
    for (let c = 0; c < width; c++, o += 4) fill(base + c, px, o);
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function classCanvas(grid: Grid, sc: Scenario, showLow: boolean): HTMLCanvasElement {
  // opacity is applied by the map layer; Low is a light wash so it never competes with High
  const alpha = { 3: 255, 2: 215, 1: showLow ? 110 : 0 } as Record<number, number>;
  const rgb = { 3: RISK_RGB.High, 2: RISK_RGB.Moderate, 1: RISK_RGB.Low } as Record<number, [number, number, number]>;
  return paint(grid, (i, px, o) => {
    const dz = grid.daerah[i];
    if (dz < 1 || dz > 9) return;            // outside Selangor or federal territory
    const c = classOf(grid.score[i], sc);
    if (c < 1) return;                         // permanent water
    const [r, g, b] = rgb[c];
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = alpha[c];
  });
}

/** Share of each cell seen as water in some (not most) Landsat scenes, 1984–2021. */
export function historyCanvas(grid: Grid): HTMLCanvasElement {
  const [r, g, b] = HISTORY_RGB;
  return paint(grid, (i, px, o) => {
    const h = grid.hist[i];
    if (!h || grid.daerah[i] < 1) return;
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
    px[o + 3] = Math.min(230, 60 + h * 3.4);
  });
}

export function builtCanvas(grid: Grid): HTMLCanvasElement {
  const [r, g, b] = BUILT_RGB;
  return paint(grid, (i, px, o) => {
    const v = grid.built[i];
    if (v < 10 || grid.daerah[i] < 1) return;
    px[o] = r; px[o + 1] = g; px[o + 2] = b;
    px[o + 3] = Math.round(v * 1.6);
  });
}

/** Screened candidate land: the same test as the report's development screen. */
export function safeCanvas(grid: Grid, model: ModelSpec): HTMLCanvasElement {
  const [r, g, b] = SAFE_RGB;
  return paint(grid, (i, px, o) => {
    if (!isCandidateCell(grid, model, i)) return;
    px[o] = r; px[o + 1] = g; px[o + 2] = b; px[o + 3] = 175;
  });
}

/** Candidate sites found by the site screen, in a deeper green than the safe-land layer. */
export function sitesCanvas(grid: Grid, cells: Iterable<number>): HTMLCanvasElement {
  const on = new Uint8Array(grid.meta.width * grid.meta.height);
  for (const i of cells) on[i] = 1;
  return paint(grid, (i, px, o) => {
    if (!on[i]) return;
    px[o] = 11; px[o + 1] = 128; px[o + 2] = 67; px[o + 3] = 235;
  });
}

export function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('canvas encode failed'))), 'image/png'));
}

/** Image corners for the map: top-left, top-right, bottom-right, bottom-left as [lon, lat]. */
export function gridCorners(meta: GridMeta): [[number, number], [number, number], [number, number], [number, number]] {
  const { x0, y1, res, width, height } = meta;
  const x1 = x0 + width * res, y0 = y1 - height * res;
  return [[x0, y1], [x1, y1], [x1, y0], [x0, y0]];
}
