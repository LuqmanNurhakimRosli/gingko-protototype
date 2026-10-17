// Ginkgo flood drill — paints the drill's water and 3-hour look-ahead into one
// canvas for the map's image overlay. Re-painted for every clock tick, so it
// only touches the rows and columns the rain covers.

import { mercatorRows } from '../data/overlays';
import type { Grid } from '../data/types';
import { NEVER, depthAt, type FloodSim } from './flood';

// water by indicative depth, then the look-ahead in JMA Kikikuru colours
const WATER: [number, number, number, number][] = [
  [130, 190, 250, 205],  // < 0.5 m
  [56, 132, 236, 220],   // 0.5–1.5 m
  [20, 70, 170, 235],    // > 1.5 m
];
const AHEAD: [number, number, number, number][] = [
  [170, 0, 170, 165],    // ≤ 1 h  (Level 4, purple)
  [255, 40, 0, 120],     // ≤ 2 h  (Level 3, red)
  [242, 231, 0, 120],    // ≤ 3 h  (Level 2, yellow)
];

export class FloodPainter {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private img: ImageData;
  private rows: Int32Array;
  private last: FloodSim | null = null;
  private grid: Grid;

  constructor(grid: Grid) {
    this.grid = grid;
    const { width, height } = grid.meta;
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx = this.canvas.getContext('2d')!;
    this.img = this.ctx.createImageData(width, height);
    this.rows = mercatorRows(grid.meta);
  }

  paint(sim: FloodSim, t: number, lookahead: boolean): HTMLCanvasElement {
    const { width, height } = this.grid.meta;
    const px = this.img.data;
    if (this.last !== sim) { px.fill(0); this.ctx.clearRect(0, 0, width, height); this.last = sim; }
    const { r0, r1, c0, c1 } = sim.bounds;
    const { onset } = sim;
    const score = this.grid.score;
    let y0 = height, y1 = -1;
    for (let y = 0; y < height; y++) {
      const r = this.rows[y];
      if (r < r0 || r > r1) continue;
      if (y < y0) y0 = y;
      y1 = y;
      const base = r * width;
      for (let c = c0, o = (y * width + c0) * 4; c <= c1; c++, o += 4) {
        const on = onset[base + c];
        let col: [number, number, number, number] | null = null;
        if (on !== NEVER) {
          if (on <= t) {
            const d = depthAt(sim, score[base + c] / 200, t);
            col = WATER[d < 0.5 ? 0 : d < 1.5 ? 1 : 2];
          } else if (lookahead) {
            const lead = on - t;
            col = lead <= 60 ? AHEAD[0] : lead <= 120 ? AHEAD[1] : lead <= 180 ? AHEAD[2] : null;
          }
        }
        if (col) { px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = col[3]; } else px[o + 3] = 0;
      }
    }
    if (y1 >= y0) this.ctx.putImageData(this.img, 0, 0, c0, y0, c1 - c0 + 1, y1 - y0 + 1);
    else this.ctx.clearRect(0, 0, width, height);
    return this.canvas;
  }

  clear() {
    this.img.data.fill(0);
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.last = null;
  }
}
