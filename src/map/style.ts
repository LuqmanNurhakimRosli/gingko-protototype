// Ginkgo basemap style: a Google-Maps-like look for the self-hosted Selangor
// vector tiles (public/basemap/selangor.pmtiles, built by pipeline/05_basemap.py).
// Mint vegetation, light-grey built-up land, blue water, white streets with soft
// grey casings, yellow expressways, and quiet grey labels.
//
// App layers are inserted at three anchors so the flood overlay sits under the
// streets and labels, the way Google draws traffic or air-quality layers:
//   SLOT_RASTER  above land and water, below roads   (risk, history, built, safe)
//   SLOT_VECTOR  above roads, below labels            (rail, rivers, boundaries, drawn areas)
//   SLOT_MARKERS above labels                         (facilities, sites)

import type { DistributiveOmit, ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';

export type BaseVariant = 'streets' | 'light';
export const SLOT_RASTER = 'slot-raster';
export const SLOT_VECTOR = 'slot-vector';
export const SLOT_MARKERS = 'slot-markers';
/** Base layers carry this so they can be hidden under a Google raster basemap. */
export const BASE_GROUP = 'ginkgo-base';

interface Palette {
  land: string; urban: string; forest: string; scrub: string; farmland: string; wetland: string; barren: string;
  park: string; sport: string; cemetery: string; medical: string; education: string; industrial: string; military: string;
  airport: string; runway: string;
  water: string; waterLine: string; waterLabel: string;
  casing: string; road: string; tunnel: string;
  motorway: string; motorwayCasing: string; trunk: string; trunkCasing: string; primaryCasing: string;
  label: string; labelStrong: string; labelMuted: string; parkLabel: string; halo: string;
}

const STREETS: Palette = {
  land: '#F1F3F4', urban: '#EEF0F3', forest: '#C8E8CF', scrub: '#D6EFDA', farmland: '#DDF1D8', wetland: '#C9E7DE', barren: '#EFEEE8',
  park: '#B5E0BF', sport: '#C2E6C8', cemetery: '#D2EAD4', medical: '#FBE5E5', education: '#F2EDE1', industrial: '#ECEAF1', military: '#EFE6E3',
  airport: '#E7E9EF', runway: '#D2D6DE',
  water: '#9DCBF3', waterLine: '#9DCBF3', waterLabel: '#3B78B5',
  casing: '#D8DBE0', road: '#FFFFFF', tunnel: '#F5F5F6',
  motorway: '#FCDB86', motorwayCasing: '#E3B44A', trunk: '#FEEBB3', trunkCasing: '#E8C56C', primaryCasing: '#D2D5DA',
  label: '#5F6368', labelStrong: '#202124', labelMuted: '#80868B', parkLabel: '#1E7B3C', halo: '#FFFFFF',
};

const LIGHT: Palette = {
  ...STREETS,
  land: '#F5F5F4', urban: '#F2F2F1', forest: '#E5EDE5', scrub: '#E9F0E8', farmland: '#ECF1E8', wetland: '#E4EEEA', barren: '#F2F1EE',
  park: '#DCEADC', sport: '#E0ECE0', cemetery: '#E5EDE5', medical: '#F6EDED', education: '#F3F0EA', industrial: '#EFEEF1', military: '#F1EDEC',
  airport: '#EEEFF2', runway: '#DEE0E4',
  water: '#CFE0EE', waterLine: '#CFE0EE', waterLabel: '#6A8BAA',
  casing: '#E2E3E5', motorway: '#FFFFFF', motorwayCasing: '#CDD0D4', trunk: '#FFFFFF', trunkCasing: '#D5D7DB', primaryCasing: '#DCDEE1',
  label: '#70757A', labelStrong: '#3C4043', labelMuted: '#9AA0A6', parkLabel: '#5B8466',
};

const FONT = { regular: ['NotoSans-Regular'], medium: ['NotoSans-Medium'], italic: ['NotoSans-Italic'] };

const z = (stops: [number, number | ExpressionSpecification][], base = 1.6): ExpressionSpecification =>
  ['interpolate', ['exponential', base], ['zoom'], ...stops.flat()] as ExpressionSpecification;

/** Road widths in px at each zoom, per kind (links are drawn at 60 %). */
const WIDTH: Record<string, [number, number][]> = {
  motorway: [[5, 0.6], [8, 1.3], [10, 2], [12, 3.2], [14, 6], [16, 12], [18, 24]],
  trunk: [[6, 0.5], [8, 1.1], [10, 1.7], [12, 2.8], [14, 5.2], [16, 10], [18, 20]],
  primary: [[8, 0.6], [10, 1.4], [12, 2.8], [14, 5], [16, 10], [18, 20]],
  secondary: [[9, 0.5], [10, 1], [12, 2.2], [14, 4.4], [16, 9], [18, 18]],
  tertiary: [[10, 0.5], [12, 1.5], [14, 3.6], [16, 8], [18, 16]],
  minor: [[12, 0.4], [14, 2.2], [16, 6], [18, 14]],
  service: [[14, 0.6], [15, 1.4], [16, 3], [18, 8]],
  track: [[14, 0.5], [16, 1.2], [18, 2.5]],
  path: [[14, 0.5], [16, 1.2], [18, 2.5]],
};
const ZOOMS = [5, 6, 8, 9, 10, 12, 13, 14, 15, 16, 18];
const KINDS = Object.keys(WIDTH);

function widthAt(kind: string, zoom: number): number {
  const s = WIDTH[kind];
  if (zoom <= s[0][0]) return zoom < s[0][0] ? 0 : s[0][1];
  for (let i = 1; i < s.length; i++) {
    if (zoom <= s[i][0]) {
      const [z0, w0] = s[i - 1], [z1, w1] = s[i];
      return w0 + ((w1 - w0) * (zoom - z0)) / (z1 - z0);
    }
  }
  return s[s.length - 1][1];
}

/** Data-driven road width: zoom outside, kind inside; `extra` adds casing width from a zoom. */
function roadWidth(extra: (zoom: number, kind: string) => number = () => 0): ExpressionSpecification {
  const stops: [number, ExpressionSpecification][] = ZOOMS.map(zoom => {
    const match = ['match', ['get', 'kind'], ...KINDS.flatMap(k => [k, +(widthAt(k, zoom) + (widthAt(k, zoom) > 0 ? extra(zoom, k) : 0)).toFixed(2)]), 0] as unknown as ExpressionSpecification;
    return [zoom, ['*', ['case', ['==', ['get', 'link'], 1], 0.6, 1], match]];
  });
  return z(stops, 1.5);
}

/** Casings appear once a road is wide enough to read as two strokes. */
const CASING_FROM: Record<string, number> = { motorway: 8, trunk: 9, primary: 11, secondary: 12, tertiary: 13, minor: 14, service: 15, track: 99, path: 99 };
const casingExtra = (zoom: number, kind: string) => (zoom >= CASING_FROM[kind] ? (zoom >= 16 ? 2 : 1.4) : 0);
const ROAD_RANK: ExpressionSpecification = ['match', ['get', 'kind'], 'motorway', 9, 'trunk', 8, 'primary', 7, 'secondary', 6, 'tertiary', 5, 'minor', 4, 'service', 3, 2];

function base(id: string, layer: DistributiveOmit<LayerSpecification, 'id'>): LayerSpecification {
  return { id, ...layer, metadata: { group: BASE_GROUP } } as LayerSpecification;
}

function slot(id: string): LayerSpecification {
  return { id, type: 'background', layout: { visibility: 'none' }, paint: { 'background-opacity': 0 } };
}

export interface StyleUrls { tiles: string; glyphs: string }

export function basemapStyle(variant: BaseVariant, urls: StyleUrls): StyleSpecification {
  const P = variant === 'light' ? LIGHT : STREETS;
  const roadFill: ExpressionSpecification = ['match', ['get', 'kind'], 'motorway', P.motorway, 'trunk', P.trunk, P.road];
  const roadCasing: ExpressionSpecification = ['match', ['get', 'kind'], 'motorway', P.motorwayCasing, 'trunk', P.trunkCasing,
    ['primary', 'secondary'], P.primaryCasing, P.casing];
  const notTunnel: ExpressionSpecification = ['!=', ['get', 'tunnel'], 1];

  const layers: LayerSpecification[] = [
    { id: 'background', type: 'background', paint: { 'background-color': P.land }, metadata: { group: BASE_GROUP } } as LayerSpecification,
    base('landcover', {
      type: 'fill', source: 'base', 'source-layer': 'landcover',
      paint: {
        'fill-color': ['match', ['get', 'kind'], 'forest', P.forest, 'mangrove', P.forest, ['scrub', 'grass'], P.scrub,
          'farmland', P.farmland, 'wetland', P.wetland, 'barren', P.barren, P.urban],
        'fill-antialias': false,
      },
    }),
    base('landuse', {
      type: 'fill', source: 'base', 'source-layer': 'landuse',
      paint: {
        'fill-color': ['match', ['get', 'kind'], 'park', P.park, 'golf', P.park, 'sport', P.sport, 'cemetery', P.cemetery,
          'medical', P.medical, 'education', P.education, 'industrial', P.industrial, 'military', P.military,
          'farmland', P.farmland, 'grass', P.scrub, P.urban],
        'fill-opacity': z([[8, 0.7], [12, 1]]),
      },
    }),
    base('aeroway-area', {
      type: 'fill', source: 'base', 'source-layer': 'aeroway', filter: ['match', ['get', 'kind'], ['airport', 'apron'], true, false],
      paint: { 'fill-color': ['match', ['get', 'kind'], 'apron', P.runway, P.airport] },
    }),
    base('water', { type: 'fill', source: 'base', 'source-layer': 'water', paint: { 'fill-color': P.water } }),
    base('waterway', {
      type: 'line', source: 'base', 'source-layer': 'waterway',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': P.waterLine,
        'line-width': z([
          [9, ['match', ['get', 'kind'], 'river', 0.8, 0.3]],
          [12, ['match', ['get', 'kind'], 'river', 1.8, 'canal', 1.2, 0.6]],
          [15, ['match', ['get', 'kind'], 'river', 4, 'canal', 3, 'stream', 1.6, 1.1]],
          [18, ['match', ['get', 'kind'], 'river', 10, 'canal', 7, 'stream', 3.5, 2.5]],
        ], 1.4),
      },
    }),
    base('aeroway-line', {
      type: 'line', source: 'base', 'source-layer': 'aeroway', filter: ['match', ['get', 'kind'], ['runway', 'taxiway'], true, false],
      paint: {
        'line-color': P.runway,
        'line-width': z([[10, ['match', ['get', 'kind'], 'runway', 1.5, 0.5]], [14, ['match', ['get', 'kind'], 'runway', 14, 3]], [18, ['match', ['get', 'kind'], 'runway', 90, 18]]], 2),
      },
    }),
    slot(SLOT_RASTER),

    // tunnels: pale fill with dashed casing
    base('road-tunnel', {
      type: 'line', source: 'base', 'source-layer': 'roads', filter: ['==', ['get', 'tunnel'], 1],
      paint: { 'line-color': P.tunnel, 'line-width': roadWidth(), 'line-opacity': 0.9 },
    }),
    base('road-casing', {
      type: 'line', source: 'base', 'source-layer': 'roads', filter: notTunnel, minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ROAD_RANK },
      paint: { 'line-color': roadCasing, 'line-width': roadWidth(casingExtra) },
    }),
    base('road-fill', {
      type: 'line', source: 'base', 'source-layer': 'roads', filter: notTunnel,
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ROAD_RANK },
      paint: {
        'line-color': roadFill,
        'line-width': roadWidth(),
        // white roads are invisible on light land at low zoom; tint them slightly until casings appear
        'line-opacity': ['match', ['get', 'kind'], ['track', 'path'], 0.85, 1],
      },
    }),
    base('road-lowzoom-tint', {
      type: 'line', source: 'base', 'source-layer': 'roads', maxzoom: 11,
      filter: ['match', ['get', 'kind'], ['primary', 'secondary', 'tertiary'], true, false],
      paint: { 'line-color': P.primaryCasing, 'line-width': z([[8, 0.4], [11, 0.8]]), 'line-opacity': 0.6, 'line-gap-width': roadWidth() },
    }),
    base('road-bridge-casing', {
      type: 'line', source: 'base', 'source-layer': 'roads', filter: ['==', ['get', 'bridge'], 1], minzoom: 13,
      layout: { 'line-join': 'round', 'line-sort-key': ROAD_RANK },
      paint: { 'line-color': roadCasing, 'line-width': roadWidth((zz, k) => casingExtra(Math.max(zz, CASING_FROM[k]), k) + 0.6) },
    }),
    base('road-bridge-fill', {
      type: 'line', source: 'base', 'source-layer': 'roads', filter: ['==', ['get', 'bridge'], 1], minzoom: 13,
      layout: { 'line-join': 'round', 'line-sort-key': ROAD_RANK },
      paint: { 'line-color': roadFill, 'line-width': roadWidth() },
    }),
    slot(SLOT_VECTOR),

    // ── labels ──
    base('waterway-label', {
      type: 'symbol', source: 'base', 'source-layer': 'waterway', minzoom: 11,
      filter: ['all', ['has', 'name'], ['match', ['get', 'kind'], ['river', 'canal'], true, false]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 400, 'text-field': ['get', 'name'], 'text-font': FONT.italic,
        'text-size': z([[11, 10], [16, 13]], 1.2), 'text-letter-spacing': 0.04, 'text-max-angle': 30,
      },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
    }),
    base('water-label', {
      type: 'symbol', source: 'base', 'source-layer': 'labels', filter: ['match', ['get', 'kind'], ['water', 'sea'], true, false],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.italic, 'text-max-width': 8,
        'text-size': ['match', ['get', 'kind'], 'sea', 14, 11.5], 'text-letter-spacing': ['match', ['get', 'kind'], 'sea', 0.2, 0.03],
      },
      paint: { 'text-color': P.waterLabel, 'text-halo-color': P.halo, 'text-halo-width': 1 },
    }),
    base('road-label', {
      type: 'symbol', source: 'base', 'source-layer': 'roads', minzoom: 12,
      filter: ['all', ['has', 'name'], ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'], true, false]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': 350, 'text-field': ['get', 'name'], 'text-font': FONT.regular,
        'text-size': z([[12, ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary'], 10.5, 9.5]], [16, ['match', ['get', 'kind'], ['motorway', 'trunk', 'primary'], 13, 12]]], 1.2),
        'text-max-angle': 30, 'text-padding': 6,
        'symbol-sort-key': ['-', 10, ROAD_RANK],
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.6 },
    }),
    base('road-shield', {
      type: 'symbol', source: 'base', 'source-layer': 'roads', minzoom: 8,
      filter: ['all', ['has', 'ref'], ['!=', ['get', 'link'], 1]],
      layout: {
        'symbol-placement': 'line', 'symbol-spacing': z([[8, 260], [14, 520]], 1), 'text-field': ['get', 'ref'],
        'text-font': FONT.medium, 'text-size': 10, 'text-rotation-alignment': 'viewport', 'text-padding': 12,
        'icon-image': ['case', ['==', ['slice', ['get', 'ref'], 0, 1], 'E'], 'shield-expressway', 'shield-federal'],
        'icon-text-fit': 'both', 'icon-text-fit-padding': [2, 4, 2, 4], 'icon-rotation-alignment': 'viewport',
        'symbol-sort-key': ['-', 10, ROAD_RANK],
      },
      paint: { 'text-color': ['case', ['==', ['slice', ['get', 'ref'], 0, 1], 'E'], '#FFFFFF', '#3C4043'] },
    }),
    base('park-label', {
      type: 'symbol', source: 'base', 'source-layer': 'labels', minzoom: 11, filter: ['==', ['get', 'kind'], 'park'],
      layout: { 'text-field': ['get', 'name'], 'text-font': FONT.medium, 'text-size': 11, 'text-max-width': 7, 'text-padding': 4 },
      paint: { 'text-color': P.parkLabel, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
    }),
    base('airport-label', {
      type: 'symbol', source: 'base', 'source-layer': 'labels', filter: ['==', ['get', 'kind'], 'airport'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.medium, 'text-size': 11.5, 'text-max-width': 8,
        'icon-image': 'poi-airport', 'icon-size': 1, 'text-offset': [0, 1.3], 'text-anchor': 'top',
      },
      paint: { 'text-color': '#4E5D78', 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
    }),
    base('place-neighbourhood', {
      type: 'symbol', source: 'base', 'source-layer': 'places', minzoom: 11,
      filter: ['match', ['get', 'kind'], ['suburb', 'neighbourhood'], true, false],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.regular, 'text-max-width': 7, 'text-padding': 3,
        'text-size': z([[11, ['match', ['get', 'kind'], 'suburb', 11.5, 10.5]], [16, ['match', ['get', 'kind'], 'suburb', 14, 12.5]]], 1.2),
        'text-transform': ['match', ['get', 'kind'], 'suburb', 'uppercase', 'none'],
        'text-letter-spacing': ['match', ['get', 'kind'], 'suburb', 0.08, 0],
        'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': P.labelMuted, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    }),
    base('place-village', {
      type: 'symbol', source: 'base', 'source-layer': 'places',
      filter: ['match', ['get', 'kind'], ['village', 'hamlet'], true, false],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.regular, 'text-max-width': 7, 'text-padding': 3,
        'text-size': z([[10, 10.5], [15, 13]], 1.2), 'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': P.label, 'text-halo-color': P.halo, 'text-halo-width': 1.4 },
    }),
    base('place-town', {
      type: 'symbol', source: 'base', 'source-layer': 'places', filter: ['==', ['get', 'kind'], 'town'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.medium, 'text-max-width': 7,
        'text-size': z([[8, 11], [12, 13.5], [15, 16]], 1.2), 'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.5 },
    }),
    base('place-city', {
      type: 'symbol', source: 'base', 'source-layer': 'places', filter: ['==', ['get', 'kind'], 'city'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.medium, 'text-max-width': 8,
        'text-size': z([[6, 11.5], [9, 13.5], [12, 17], [15, 20]], 1.2), 'symbol-sort-key': ['get', 'rank'],
      },
      paint: { 'text-color': P.labelStrong, 'text-halo-color': P.halo, 'text-halo-width': 1.8 },
    }),
    base('place-state', {
      type: 'symbol', source: 'base', 'source-layer': 'places', maxzoom: 8, filter: ['==', ['get', 'kind'], 'state'],
      layout: {
        'text-field': ['get', 'name'], 'text-font': FONT.regular, 'text-transform': 'uppercase',
        'text-size': 12, 'text-letter-spacing': 0.25, 'text-max-width': 9,
      },
      paint: { 'text-color': P.labelMuted, 'text-halo-color': P.halo, 'text-halo-width': 1.2 },
    }),
    slot(SLOT_MARKERS),
  ];

  return {
    version: 8,
    name: `Ginkgo ${variant}`,
    glyphs: urls.glyphs,
    sources: {
      base: {
        type: 'vector', url: urls.tiles,
        attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · <a href="https://overturemaps.org">Overture Maps</a> · ESA WorldCover',
      },
    },
    layers,
  };
}

/** Absolute URLs for the bundled tiles and glyphs (MapLibre needs absolute URLs). */
export function bundledUrls(): StyleUrls {
  const root = `${location.origin}${import.meta.env.BASE_URL}`;
  return { tiles: `pmtiles://${root}basemap/selangor.pmtiles`, glyphs: `${root}basemap/fonts/{fontstack}/{range}.pbf` };
}
