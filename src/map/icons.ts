// Map icons drawn at runtime (no sprite sheet): facility pins coloured by flood
// class, road shields and the airport glyph. Supplied on demand through the
// map's `styleimagemissing` event, so they survive style switches.

import type { StyleImageMetadata } from 'maplibre-gl';
import { RISK_COLOR } from '../data/format';
import type { FacilityKind } from '../data/types';

const RATIO = 2;

// 24-unit glyph paths (Material-style shapes)
const GLYPH: Record<FacilityKind | 'airport', string> = {
  hospital: 'M6.5 4h3.2v6.3h4.6V4h3.2v16h-3.2v-6.5H9.7V20H6.5z',
  clinic: 'M9.6 4h4.8v5.6H20v4.8h-5.6V20H9.6v-5.6H4V9.6h5.6z',
  school: 'M12 3 1 9l11 6 9-4.9V17h2V9zM5 13.2v4L12 21l7-3.8v-4L12 17z',
  police: 'M12 2 4 5v6c0 5.2 3.4 10.1 8 11 4.6-.9 8-5.8 8-11V5z',
  fire: 'M13.5.7s.7 2.6.7 4.8c0 2-1.3 3.7-3.4 3.7S7.2 7.5 7.2 5.5v-.4C5.2 7.5 4 10.6 4 14a8 8 0 0 0 16 0c0-5.4-2.6-10.2-6.5-13.3z',
  station: 'M12 2C8 2 4 2.5 4 6v9.5C4 17.4 5.6 19 7.5 19L6 20.5v.5h12v-.5L16.5 19c1.9 0 3.5-1.6 3.5-3.5V6c0-3.5-3.6-4-8-4zM7.5 17a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zM11 10H6V6h5zm2 0V6h5v4zm3.5 7a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z',
  airport: 'M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5z',
};

type Made = { image: { width: number; height: number; data: Uint8Array }; options: Partial<StyleImageMetadata> };

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w * RATIO;
  c.height = h * RATIO;
  const ctx = c.getContext('2d')!;
  ctx.scale(RATIO, RATIO);
  return [c, ctx];
}

function done(c: HTMLCanvasElement, ctx: CanvasRenderingContext2D, options: Partial<StyleImageMetadata> = {}): Made {
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { image: { width: c.width, height: c.height, data: new Uint8Array(d.data.buffer) }, options: { pixelRatio: RATIO, ...options } };
}

function glyph(ctx: CanvasRenderingContext2D, path: string, cx: number, cy: number, size: number, color: string) {
  ctx.save();
  ctx.translate(cx - size / 2, cy - size / 2);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = color;
  ctx.fill(new Path2D(path));
  ctx.restore();
}

/** Round pin: red = High, amber = Moderate, white = Low/other; glyph shows the kind. */
function facilityPin(kind: FacilityKind, cls: number): Made {
  const big = kind === 'hospital';
  const s = big ? 24 : 20;
  const [c, ctx] = canvas(s, s);
  const r = s / 2 - 1.5;
  const fill = cls === 3 ? RISK_COLOR.High : cls === 2 ? RISK_COLOR.Moderate : '#FFFFFF';
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 0.5;
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.4;
  ctx.strokeStyle = cls >= 2 ? '#FFFFFF' : '#5F6368';
  ctx.stroke();
  glyph(ctx, GLYPH[kind], s / 2, s / 2, r * 1.15, cls === 3 ? '#FFFFFF' : '#202124');
  return done(c, ctx);
}

function shield(expressway: boolean): Made {
  const [w, h] = [20, 16];
  const [c, ctx] = canvas(w, h);
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 3);
  ctx.fillStyle = expressway ? '#11804A' : '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = expressway ? '#0A5C34' : '#9AA0A6';
  ctx.stroke();
  const px = (v: number) => v * RATIO;
  return done(c, ctx, { stretchX: [[px(5), px(15)]], stretchY: [[px(5), px(11)]], content: [px(4), px(3), px(16), px(13)] });
}

function airport(): Made {
  const [c, ctx] = canvas(22, 22);
  ctx.beginPath();
  ctx.arc(11, 11, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = '#5E7AA8';
  ctx.fill();
  glyph(ctx, GLYPH.airport, 11, 11, 13, '#FFFFFF');
  return done(c, ctx);
}

/** Build the image for a missing icon id, or null if the id is not ours. */
export function makeIcon(id: string): Made | null {
  const fac = /^fac-(\w+)-(\d)$/.exec(id);
  if (fac && fac[1] in GLYPH) return facilityPin(fac[1] as FacilityKind, Number(fac[2]));
  if (id === 'shield-expressway') return shield(true);
  if (id === 'shield-federal') return shield(false);
  if (id === 'poi-airport') return airport();
  return null;
}
