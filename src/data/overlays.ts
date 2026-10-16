// Ginkgo Command Center — paints grid layers into canvases for Leaflet image overlays.
// Pure rendering of precomputed values; class thresholds come from model.json.

import { classOf } from './analysis';
import { BUILT_RGB, HISTORY_RGB, RISK_RGB } from './format';
import type { Grid, Scenario } from './types';

function paint(grid: Grid, fill: (i: number, px: Uint8ClampedArray, o: number) => void): HTMLCanvasElement {
  const { width, height } = grid.meta;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  const px = img.data;
  for (let i = 0, o = 0; i < width * height; i++, o += 4) fill(i, px, o);
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function classCanvas(grid: Grid, sc: Scenario, showLow: boolean): HTMLCanvasElement {
  const alpha = { 3: 170, 2: 150, 1: showLow ? 70 : 0 } as Record<number, number>;
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

export function canvasToUrl(canvas: HTMLCanvasElement): Promise<string> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(URL.createObjectURL(b)) : reject(new Error('canvas encode failed'))), 'image/png'));
}

/** Leaflet bounds of the grid as [[south, west], [north, east]]. */
export function gridBounds(grid: Grid): [[number, number], [number, number]] {
  const { x0, y1, res, width, height } = grid.meta;
  return [[y1 - height * res, x0], [y1, x0 + width * res]];
}
