// Ginkgo Command Center — centre map (MapLibre GL over a self-hosted,
// Google-Maps-style vector basemap). Shows precomputed layers, lets the user
// pick a daerah, inspect a cell, and draw a rectangle or polygon. All numbers
// shown come from the grid.

import { useEffect, useLayoutEffect, useRef, type FC } from 'react';
import {
  addProtocol, AttributionControl, LngLatBounds, Map as MLMap, Marker, NavigationControl, Popup, ScaleControl, setWorkerUrl,
  type ExpressionSpecification, type FilterSpecification, type GeoJSONSource, type ImageSource, type LayerSpecification, type LngLat, type MapGeoJSONFeature,
  type MapMouseEvent, type MapTouchEvent, type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre parses tiles in a module worker; let Vite bundle it and hand over its URL
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Protocol } from 'pmtiles';
import type { Feature, FeatureCollection, Point } from 'geojson';
import { classOf, CLASS_NAME, queryCell, type CandidateSite, type CellInfo, type Ring } from '../../data/analysis';
import { fmtCoord, fmtHa, fmtInt, RISK_COLOR, RIVER_COLOR } from '../../data/format';
import { googleCopyright, googleSession, googleTileUrl, type GoogleMapType } from '../../data/googleTiles';
import { builtCanvas, canvasToUrl, classCanvas, gridCorners, historyCanvas, safeCanvas, sitesCanvas } from '../../data/overlays';
import type { AppDataBundle, FacilityKind, Grid, RiskClass, Scenario } from '../../data/types';
import { makeIcon } from '../../map/icons';
import { BASE_GROUP, basemapStyle, bundledUrls, SLOT_MARKERS, SLOT_RASTER, SLOT_VECTOR, type BaseVariant } from '../../map/style';

export type DrawMode = 'none' | 'rect' | 'poly';
export type Basemap = 'streets' | 'light' | 'google' | 'google-sat' | 'none';
export interface LayerState {
  susceptibility: boolean;
  showLow: boolean;
  history: boolean;
  sites: boolean;
  rivers: boolean;
  boundaries: boolean;
  built: boolean;
  safe: boolean;
  rail: boolean;
  hospital: boolean;
  clinic: boolean;
  school: boolean;
  emergency: boolean;
}
/** bounds as [[south, west], [north, east]]; point as [lat, lon]. */
export interface MapFocus { bounds: [[number, number], [number, number]]; label: string; point: [number, number]; token: number }
export interface MapInspect { lat: number; lon: number; title?: string; me?: boolean; token: number }
export interface MapPadding { top: number; bottom: number; left: number; right: number }
/** Candidate sites from the site screen (AI or manual), shown as numbered pins. */
export interface SiteSet { list: CandidateSite[]; label: string; lowUnder: string; token: number }

interface Props {
  bundle: AppDataBundle;
  /** bundle.grid plus terrain detail once loaded (cell popups read it). */
  grid: Grid;
  scenario: Scenario;
  layers: LayerState;
  basemap: Basemap;
  selectedDaerah: number | null;
  drawn: Ring[] | null;
  drawMode: DrawMode;
  focus: MapFocus | null;
  inspect: MapInspect | null;
  resetToken: number;
  sites: SiteSet | null;
  /** room taken by floating chrome, so fitted views are not hidden under it */
  padding: MapPadding;
  onSelectDaerah: (id: number | null) => void;
  onDrawn: (rings: Ring[]) => void;
  onDrawModeChange: (m: DrawMode) => void;
  onCellPick: (info: CellInfo) => void;
  onBasemapError: (message: string) => void;
}

const DATA_ATTRIBUTION = 'Flood model: Copernicus GLO-30 · JRC GSW · ESA WorldCover · Meta HRSL';
const KIND_LABEL: Record<FacilityKind, string> = {
  hospital: 'Hospital', clinic: 'Clinic', school: 'School', police: 'Police station', fire: 'Fire & rescue', station: 'Rail station',
};
const LAYER_KINDS: Record<'hospital' | 'clinic' | 'school' | 'emergency', FacilityKind[]> = {
  hospital: ['hospital'], clinic: ['clinic'], school: ['school'], emergency: ['police', 'fire'],
};
const DRAW_COLOR = '#1A73E8';
const BLANK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const RASTERS = ['built', 'risk', 'history', 'safe', 'cand'] as const;
type RasterId = typeof RASTERS[number];
const INTERACTIVE = ['fac-icons', 'fac-stations', 'sites-circle', 'rail-line', 'daerah-fill'];

let protocolReady = false;
function ensureProtocol() {
  if (protocolReady) return;
  setWorkerUrl(workerUrl);
  addProtocol('pmtiles', new Protocol().tile);
  protocolReady = true;
}

// ── small DOM helpers (popups/tooltips are built as nodes: OSM names are untrusted) ──
function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
function lines(...rows: (string | [string, 'strong' | 'em'])[]): HTMLElement {
  const box = el('div');
  rows.forEach((r, i) => {
    if (i) box.append(el('br'));
    if (typeof r === 'string') box.append(document.createTextNode(r));
    else box.append(el(r[1], undefined, r[0]));
  });
  return box;
}

function riskChip(cls: string): HTMLElement {
  const chip = el('span', 'risk-chip');
  const sw = el('i');
  sw.style.background = cls in RISK_COLOR ? RISK_COLOR[cls as RiskClass] : '#9CA3AF';
  chip.append(sw, document.createTextNode(cls));
  return chip;
}

function cellPopup(info: CellInfo, sc: Scenario, onAsk: () => void, title?: string): HTMLElement {
  const root = el('div', 'cell-pop');
  const head = el('div', 'head');
  const name = title ?? (info.federal ? 'Federal territory' : info.daerah ?? '—');
  head.append(el('strong', undefined, name), riskChip(info.federal ? 'Outside scope' : String(CLASS_NAME[info.cls[sc.key]])));
  root.append(head);
  if (title && info.daerah) root.append(el('div', 'muted', info.daerah));
  const dl = el('dl');
  const add = (k: string, v: string) => { dl.append(el('dt', undefined, k), el('dd', undefined, v)); };
  add('Scenario', sc.label);
  if (info.score !== null) add('Score', info.score.toFixed(2));
  if (info.hand !== undefined) {
    add('Above drainage', `${info.hand.toFixed(1)} m`);
    add('To river/canal', `${fmtInt(info.river_m!)} m`);
    add('Slope', `${info.slope!.toFixed(1)}°`);
    add('Elevation', `${info.elev} m`);
  }
  add('Water history', `${info.hist}%`);
  add('Built-up', `${info.built}%`);
  add('People (est.)', info.pop < 1 ? '0' : `~${fmtInt(info.pop)}`);
  root.append(dl);
  root.append(el('div', 'coords', fmtCoord(info.lonlat)));
  const actions = el('div', 'actions');
  const ask = el('button', 'btn btn-subtle btn-sm', '✦ Ask Ginkgo about this spot');
  ask.onclick = onAsk;
  actions.append(ask);
  root.append(actions);
  return root;
}

function pinElement(label: string, me: boolean): HTMLElement {
  const root = el('div', me ? 'gm-me' : 'gm-pin');
  if (me) {
    root.append(el('span', 'halo'), el('span', 'dot'));
  } else {
    root.innerHTML = '<svg viewBox="0 0 27 43" width="27" height="43" aria-hidden="true"><path d="M13.5 0C6 0 0 6 0 13.4 0 23.5 13.5 43 13.5 43S27 23.5 27 13.4C27 6 21 0 13.5 0z" fill="#EA4335"/><path d="M13.5 1.2c6.8 0 12.3 5.4 12.3 12.2 0 8.6-10.2 24.4-12.3 27.6C11.4 37.8 1.2 22 1.2 13.4 1.2 6.6 6.7 1.2 13.5 1.2z" fill="none" stroke="#B31412" stroke-width="1.2" opacity=".55"/><circle cx="13.5" cy="13.5" r="4.6" fill="#7A0E0E"/></svg>';
  }
  root.append(el('span', 'gm-pin-label', label));
  return root;
}

const ringBounds = (ring: [number, number][]) => {
  const b = new LngLatBounds();
  ring.forEach(p => b.extend(p));
  return b;
};

/** Label points for the daerah: the daerah's own cell nearest its cell centroid (always inside). */
function daerahLabels(bundle: AppDataBundle): FeatureCollection<Point> {
  const { meta, daerah } = bundle.grid;
  const sum = Array.from({ length: 10 }, () => [0, 0, 0]);
  for (let i = 0; i < daerah.length; i++) {
    const d = daerah[i];
    if (d < 1 || d > 9) continue;
    sum[d][0] += i % meta.width; sum[d][1] += Math.floor(i / meta.width); sum[d][2]++;
  }
  const best = sum.map(([cx, cy, n]) => ({ cx: cx / n, cy: cy / n, d: Infinity, i: -1 }));
  for (let i = 0; i < daerah.length; i++) {
    const d = daerah[i];
    if (d < 1 || d > 9) continue;
    const b = best[d];
    const dd = (i % meta.width - b.cx) ** 2 + (Math.floor(i / meta.width) - b.cy) ** 2;
    if (dd < b.d) { b.d = dd; b.i = i; }
  }
  return {
    type: 'FeatureCollection',
    features: bundle.stats.daerah.map(s => {
      const i = best[s.id].i;
      const lon = meta.x0 + (i % meta.width + 0.5) * meta.res;
      const lat = meta.y1 - (Math.floor(i / meta.width) + 0.5) * meta.res;
      return { type: 'Feature', properties: { name: s.name }, geometry: { type: 'Point', coordinates: [lon, lat] } };
    }),
  };
}

/** Map labels use the bundled Latin glyphs only; other scripts are dropped from the label (not the tooltip). */
const NON_LATIN = /[^\u0020-\u02ff\u1e00-\u1eff\u2000-\u206f]/g;
const labelText = (s: string) => s.replace(NON_LATIN, '').replace(/\(\s*\)|\s{2,}/g, ' ').trim();

function facilityData(bundle: AppDataBundle, sc: Scenario): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: bundle.facilities.items.map((f, i) => ({
      type: 'Feature', id: i,
      // facilities in the federal territories are outside the analysis: neutral pin
      properties: { i, k: f.k, n: f.n, label: labelText(f.n), c: f.d >= 1 && f.d <= 9 ? classOf(f.s, sc) : 0 },
      geometry: { type: 'Point', coordinates: f.c },
    })),
  };
}

function siteData(bundle: AppDataBundle): FeatureCollection<Point> {
  return {
    type: 'FeatureCollection',
    features: bundle.validation.sites.map((s, i) => ({
      type: 'Feature', id: i,
      properties: { i, name: labelText(s.name), flood: s.kind === 'reported_flood' ? 1 : 0 },
      geometry: { type: 'Point', coordinates: s.lonlat },
    })),
  };
}

/** Every app source and layer; inserted at the base style's slots. */
function addAppLayers(m: MLMap, bundle: AppDataBundle) {
  const corners = gridCorners(bundle.grid.meta);
  const rasterOpacity: Record<RasterId, unknown> = {
    built: 0.55,
    risk: ['interpolate', ['linear'], ['zoom'], 7, 0.62, 11, 0.5, 14, 0.42, 17, 0.36],
    history: 0.8,
    safe: 0.7,
    cand: 0.9,
  };
  for (const id of RASTERS) {
    m.addSource(id, { type: 'image', url: BLANK_PNG, coordinates: corners });
    add(m, {
      id: `${id}-layer`, type: 'raster', source: id, layout: { visibility: 'none' },
      paint: { 'raster-opacity': rasterOpacity[id], 'raster-resampling': 'linear', 'raster-fade-duration': 0 },
    } as LayerSpecification, SLOT_RASTER);
  }

  const railColor = ['match', ['get', 'k'], ...Object.entries(bundle.rail.lines).flatMap(([k, v]) => [k, v.color]), '#6B7280'] as unknown as ExpressionSpecification;
  m.addSource('rivers', { type: 'geojson', data: bundle.rivers });
  m.addSource('daerah', { type: 'geojson', data: bundle.daerah, promoteId: 'id' });
  m.addSource('daerah-labels', { type: 'geojson', data: daerahLabels(bundle) });
  m.addSource('rail', { type: 'geojson', data: bundle.rail });
  m.addSource('drawn', { type: 'geojson', data: EMPTY });
  m.addSource('draft', { type: 'geojson', data: EMPTY });
  m.addSource('facilities', { type: 'geojson', data: EMPTY });
  m.addSource('sites', { type: 'geojson', data: siteData(bundle) });

  const vec: LayerSpecification[] = [
    { id: 'rivers-line', type: 'line', source: 'rivers', layout: { visibility: 'none', 'line-cap': 'round' },
      paint: { 'line-color': RIVER_COLOR, 'line-opacity': 0.85,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, ['match', ['get', 'c'], 'river', 1.2, 0.5], 14, ['match', ['get', 'c'], 'river', 3, 'canal', 2, 1.2]] } },
    { id: 'daerah-fill', type: 'fill', source: 'daerah',
      paint: {
        'fill-color': ['case', ['boolean', ['get', 'excluded'], false], '#9AA0A6', '#202124'],
        'fill-opacity': ['case', ['boolean', ['get', 'excluded'], false], 0.16,
          ['boolean', ['feature-state', 'dim'], false], 0.07, ['boolean', ['feature-state', 'hover'], false], 0.035, 0],
      } },
    { id: 'daerah-line', type: 'line', source: 'daerah', layout: { 'line-join': 'round' },
      paint: { 'line-color': '#5F6368', 'line-opacity': 0.75, 'line-dasharray': [3, 2],
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.9, 13, 1.6] } },
    { id: 'daerah-selected-casing', type: 'line', source: 'daerah', filter: ['==', ['get', 'id'], -1], layout: { 'line-join': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-width': 5.5, 'line-opacity': 0.8 } },
    { id: 'daerah-selected', type: 'line', source: 'daerah', filter: ['==', ['get', 'id'], -1], layout: { 'line-join': 'round' },
      paint: { 'line-color': '#202124', 'line-width': 2.6 } },
    { id: 'rail-casing', type: 'line', source: 'rail', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': '#FFFFFF', 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 2.4, 13, 3.8, 16, 5.2] } },
    { id: 'rail-line', type: 'line', source: 'rail', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': railColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 1.3, 13, 2.2, 16, 3.2] } },
    { id: 'drawn-fill', type: 'fill', source: 'drawn', paint: { 'fill-color': DRAW_COLOR, 'fill-opacity': 0.07 } },
    { id: 'drawn-casing', type: 'line', source: 'drawn', layout: { 'line-join': 'round' }, paint: { 'line-color': '#FFFFFF', 'line-width': 5, 'line-opacity': 0.85 } },
    { id: 'drawn-line', type: 'line', source: 'drawn', layout: { 'line-join': 'round' }, paint: { 'line-color': DRAW_COLOR, 'line-width': 2.5 } },
    { id: 'draft-fill', type: 'fill', source: 'draft', filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': DRAW_COLOR, 'fill-opacity': 0.1 } },
    { id: 'draft-line', type: 'line', source: 'draft', filter: ['!=', ['geometry-type'], 'Point'],
      paint: { 'line-color': DRAW_COLOR, 'line-width': ['case', ['==', ['get', 'guide'], 1], 1.5, 2.5], 'line-dasharray': [2, 1.5] } },
    { id: 'draft-vertex', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': ['case', ['==', ['get', 'first'], 1], 6, 4], 'circle-color': '#FFFFFF', 'circle-stroke-color': DRAW_COLOR, 'circle-stroke-width': 2 } },
  ];
  vec.forEach(l => add(m, l, SLOT_VECTOR));

  const markers: LayerSpecification[] = [
    { id: 'daerah-label', type: 'symbol', source: 'daerah-labels', maxzoom: 10.5,
      layout: { 'text-field': ['get', 'name'], 'text-font': ['NotoSans-Medium'], 'text-size': 11.5, 'text-transform': 'uppercase',
        'text-letter-spacing': 0.14, 'text-max-width': 8 },
      paint: { 'text-color': '#5F6368', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.6 } },
    { id: 'sites-circle', type: 'circle', source: 'sites', layout: { visibility: 'none' },
      paint: { 'circle-radius': 6.5, 'circle-color': ['case', ['==', ['get', 'flood'], 1], '#FFFFFF', '#202124'],
        'circle-stroke-color': ['case', ['==', ['get', 'flood'], 1], '#202124', '#FFFFFF'], 'circle-stroke-width': 2.5 } },
    { id: 'sites-label', type: 'symbol', source: 'sites', minzoom: 10, layout: { visibility: 'none',
      'text-field': ['get', 'name'], 'text-font': ['NotoSans-Medium'], 'text-size': 11.5, 'text-anchor': 'left', 'text-offset': [0.9, 0], 'text-optional': true },
      paint: { 'text-color': '#202124', 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 } },
    { id: 'fac-icons', type: 'symbol', source: 'facilities', filter: ['in', ['get', 'k'], ['literal', []]],
      layout: { 'icon-image': ['concat', 'fac-', ['get', 'k'], '-', ['to-string', ['get', 'c']]], 'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.62, 12, 0.85, 15, 1.05], 'symbol-sort-key': ['get', 'c'] } },
    { id: 'fac-stations', type: 'symbol', source: 'facilities', minzoom: 12, filter: ['==', ['get', 'k'], 'station'],
      layout: { visibility: 'none', 'icon-image': ['concat', 'fac-station-', ['to-string', ['get', 'c']]], 'icon-allow-overlap': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.75, 15, 1], 'symbol-sort-key': ['get', 'c'] } },
    { id: 'fac-labels', type: 'symbol', source: 'facilities', minzoom: 14, filter: ['in', ['get', 'k'], ['literal', []]],
      layout: { 'text-field': ['get', 'label'], 'text-font': ['NotoSans-Medium'], 'text-size': 11, 'text-anchor': 'left',
        'text-offset': [1, 0], 'text-max-width': 9, 'text-optional': true, 'symbol-sort-key': ['-', 3, ['get', 'c']] },
      paint: { 'text-color': ['match', ['get', 'c'], 3, '#B91C1C', 2, '#92400E', '#3C4043'], 'text-halo-color': '#FFFFFF', 'text-halo-width': 1.6 } },
  ];
  markers.forEach(l => add(m, l, SLOT_MARKERS));
}

function add(m: MLMap, layer: LayerSpecification, slot: string) {
  m.addLayer({ ...layer, metadata: { slot } } as LayerSpecification, slot);
}

/** Keep app layers and sources across a basemap style swap (streets ↔ light). */
function carryOver(prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  if (!prev) return next;
  const app = prev.layers.filter(l => (l.metadata as { slot?: string } | undefined)?.slot);
  const layers: LayerSpecification[] = [];
  for (const l of next.layers) {
    layers.push(...app.filter(a => (a.metadata as { slot: string }).slot === l.id));
    layers.push(l);
  }
  const sources = { ...next.sources };
  for (const [k, v] of Object.entries(prev.sources)) if (k !== 'base' && k !== 'google') sources[k] = v;
  return { ...next, sources, layers };
}

const setVis = (m: MLMap, id: string, on: boolean) => {
  if (m.getLayer(id)) m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
};

export const MapView: FC<Props> = (props) => {
  const { bundle, grid, scenario, layers, basemap, selectedDaerah, drawn, drawMode, focus, inspect, resetToken, sites } = props;
  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  // map handlers are bound once; they read the latest props through this ref
  const cb = useRef(props);
  useLayoutEffect(() => { cb.current = props; });
  const r = useRef<{
    ready?: boolean;
    variant?: BaseVariant;
    urls: Partial<Record<RasterId, string>>;
    painted: Partial<Record<RasterId, string>>;
    popup?: Popup;
    pin?: Marker;
    sitePins: Marker[];
    hover?: number | null;
    googleAttr?: HTMLElement;
    selangor?: LngLatBounds;
    /** a rectangle drag ends with a click event; ignore clicks until this time */
    quietUntil?: number;
    onReady: (() => void)[];
  }>({ urls: {}, painted: {}, onReady: [], sitePins: [] });

  /** Run now if the style and app layers are ready, else once they are. */
  const whenReady = (fn: () => void) => {
    if (r.current.ready && map.current) fn();
    else r.current.onReady.push(fn);
  };

  const openCellPopup = (lng: number, lat: number, title?: string) => {
    const m = map.current;
    const p = cb.current;
    if (!m) return;
    const info = queryCell(p.grid, p.bundle.model, lng, lat);
    if (!info) return;
    r.current.popup?.remove();
    r.current.popup = new Popup({ maxWidth: '290px', offset: 10, className: 'cc-popup', focusAfterOpen: false })
      .setLngLat([lng, lat])
      .setDOMContent(cellPopup(info, p.scenario, () => { cb.current.onCellPick(info); r.current.popup?.remove(); }, title))
      .addTo(m);
  };
  const openRef = useRef(openCellPopup);
  useLayoutEffect(() => { openRef.current = openCellPopup; });

  // ── init once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!box.current || map.current) return;
    ensureProtocol();
    const sel = new LngLatBounds();
    for (const f of bundle.daerah.features) {
      if (f.properties?.excluded) continue;
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      polys.forEach(p => sel.extend(ringBounds(p[0] as [number, number][])));
    }
    r.current.selangor = sel;
    r.current.variant = cb.current.basemap === 'light' ? 'light' : 'streets';
    const m = new MLMap({
      container: box.current,
      style: basemapStyle(r.current.variant, bundledUrls()),
      bounds: sel, fitBoundsOptions: { padding: cb.current.padding },
      minZoom: 7, maxZoom: 18.5,
      // the bundled tiles cover the study window; keep the view inside it
      maxBounds: [[100.66, 2.46], [102.09, 3.99]],
      renderWorldCopies: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
      attributionControl: false, fadeDuration: 150,
    });
    map.current = m;
    if (import.meta.env.DEV) (window as unknown as { __ginkgoMap?: MLMap }).__ginkgoMap = m;
    m.touchZoomRotate.disableRotation();
    m.keyboard.disableRotation();
    m.addControl(new AttributionControl({ compact: true, customAttribution: DATA_ATTRIBUTION }), 'bottom-right');
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(new ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-right');
    m.setMissingStyleImageResolver(id => {
      const icon = makeIcon(id);
      if (icon && !m.hasImage(id)) m.addImage(id, icon.image, icon.options);
    });

    m.once('load', () => {
      // compact attribution starts expanded; start collapsed like a consumer map
      m.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      addAppLayers(m, bundle);
      r.current.ready = true;
      const queued = r.current.onReady.splice(0);
      queued.forEach(fn => fn());
    });

    // hover: one tooltip for facilities, sites, rail and daerah
    const hoverDaerah = (id: number | null) => {
      const prev = r.current.hover;
      if (prev === id) return;
      if (prev != null) m.setFeatureState({ source: 'daerah', id: prev }, { hover: false });
      if (id != null) m.setFeatureState({ source: 'daerah', id }, { hover: true });
      r.current.hover = id;
    };
    m.on('mousemove', (e: MapMouseEvent) => {
      const t = tip.current;
      if (!t || !r.current.ready) return;
      if (cb.current.drawMode !== 'none') { t.hidden = true; return; }
      const layersOn = INTERACTIVE.filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = m.queryRenderedFeatures(e.point, { layers: layersOn });
      const f = hit[0];
      const content = f ? tooltipFor(f) : null;
      const daerahHit = hit.find(h => h.layer.id === 'daerah-fill');
      hoverDaerah(daerahHit && !daerahHit.properties.excluded ? Number(daerahHit.id) : null);
      m.getCanvas().style.cursor = f && f.layer.id !== 'daerah-fill' ? 'pointer' : '';
      if (!content) { t.hidden = true; return; }
      t.replaceChildren(content);
      t.hidden = false;
      const { width, height } = m.getContainer().getBoundingClientRect();
      const x = Math.min(e.point.x + 14, width - t.offsetWidth - 8);
      const y = e.point.y + 16 + t.offsetHeight > height ? e.point.y - t.offsetHeight - 10 : e.point.y + 16;
      t.style.transform = `translate(${x}px, ${y}px)`;
    });
    m.getCanvas().addEventListener('mouseleave', () => {
      if (tip.current) tip.current.hidden = true;
      hoverDaerah(null);
    });

    const tooltipFor = (f: MapGeoJSONFeature): HTMLElement | null => {
      const p = f.properties;
      const sc = cb.current.scenario;
      switch (f.layer.id) {
        case 'fac-icons':
        case 'fac-stations':
          return lines([KIND_LABEL[p.k as FacilityKind], 'strong'], String(p.n),
            Number(p.c) ? `${CLASS_NAME[Number(p.c)]} · ${sc.label} rain` : 'Federal territory — outside Selangor scope');
        case 'sites-circle': {
          const s = bundle.validation.sites[Number(p.i)];
          const v = s.scenarios[sc.key];
          const rows: (string | [string, 'strong' | 'em'])[] = [[s.name, 'strong'],
            s.kind === 'reported_flood' ? 'Reported flood, Dec 2021' : 'Hilly control (DEM-selected)',
            `Model (${sc.label}): ${v.point} · expected ${s.expect}`];
          if (s.outside_scope) rows.push(['Outside Selangor — regression check only', 'em']);
          return lines(...rows);
        }
        case 'rail-line':
          return lines([bundle.rail.lines[String(p.k)]?.name ?? 'Rail', 'strong']);
        case 'daerah-fill': {
          if (p.excluded) return lines([String(p.name), 'strong'], 'Federal territory — outside Selangor scope');
          const st = bundle.stats.daerah.find(d => d.id === Number(p.id));
          if (!st) return null;
          const s = st.scenarios[sc.key];
          return lines([String(p.name), 'strong'], `${s.high_pct.toFixed(1)}% High · ${s.moderate_pct.toFixed(1)}% Moderate (${sc.label})`);
        }
      }
      return null;
    };

    // click: facility/site → cell popup; daerah → select; otherwise inspect the cell
    m.on('click', (e: MapMouseEvent) => {
      if (!r.current.ready || cb.current.drawMode !== 'none' || Date.now() < (r.current.quietUntil ?? 0)) return;
      const layersOn = INTERACTIVE.filter(id => m.getLayer(id) && m.getLayoutProperty(id, 'visibility') !== 'none');
      const hit = m.queryRenderedFeatures(e.point, { layers: layersOn });
      const pt = hit.find(h => h.layer.id !== 'daerah-fill' && h.layer.id !== 'rail-line');
      if (pt) {
        const [lng, lat] = (pt.geometry as Point).coordinates;
        const title = pt.layer.id === 'sites-circle' ? bundle.validation.sites[Number(pt.properties.i)].name : String(pt.properties.n);
        openRef.current(lng, lat, title);
        return;
      }
      const d = hit.find(h => h.layer.id === 'daerah-fill');
      if (d && !d.properties.excluded && cb.current.selectedDaerah !== Number(d.properties.id)) {
        cb.current.onSelectDaerah(Number(d.properties.id));
        return;
      }
      openRef.current(e.lngLat.lng, e.lngLat.lat);
    });

    const ro = new ResizeObserver(() => m.resize());
    ro.observe(box.current);
    const state = r.current;
    return () => { ro.disconnect(); m.remove(); map.current = null; state.ready = false; };
  }, [bundle]);

  // ── basemap: bundled vector style (streets / light), Google raster, or plain ──
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    let cancelled = false;
    let onMove: (() => void) | null = null;
    whenReady(() => {
      if (cancelled) return;
      const variant: BaseVariant = basemap === 'light' ? 'light' : 'streets';
      if (variant !== r.current.variant) {
        r.current.variant = variant;
        m.setStyle(basemapStyle(variant, bundledUrls()), { transformStyle: carryOver });
      }
      const showBase = (on: boolean) => {
        for (const l of m.getStyle().layers) {
          if ((l.metadata as { group?: string } | undefined)?.group === BASE_GROUP && l.id !== 'background') setVis(m, l.id, on);
        }
      };
      const dropGoogle = () => {
        if (m.getLayer('google-layer')) m.removeLayer('google-layer');
        if (m.getSource('google')) m.removeSource('google');
        r.current.googleAttr?.remove();
        r.current.googleAttr = undefined;
      };
      dropGoogle();
      if (basemap !== 'google' && basemap !== 'google-sat') {
        showBase(basemap !== 'none');
        return;
      }
      const type: GoogleMapType = basemap === 'google' ? 'roadmap' : 'satellite';
      googleSession(type).then(session => {
        if (cancelled) return;
        m.addSource('google', { type: 'raster', tiles: [googleTileUrl(session)], tileSize: 256, maxzoom: 21 });
        m.addLayer({ id: 'google-layer', type: 'raster', source: 'google' }, 'landcover');
        showBase(false);
        const attr = el('div', 'google-attr-box');
        r.current.googleAttr = attr;
        m.getContainer().append(attr);
        const setAttr = (text: string) => {
          attr.replaceChildren(el('span', 'google-attr', 'Google'), document.createTextNode(` ${text}`));
        };
        setAttr(`Map data ©${new Date().getFullYear()} Google`);
        let t: ReturnType<typeof setTimeout> | undefined;
        onMove = () => {
          clearTimeout(t);
          t = setTimeout(async () => {
            const b = m.getBounds();
            const c = await googleCopyright(session, { north: b.getNorth(), south: b.getSouth(), east: b.getEast(), west: b.getWest() }, m.getZoom());
            if (c && !cancelled) setAttr(c);
          }, 500);
        };
        m.on('moveend', onMove);
        onMove();
      }).catch(err => {
        if (!cancelled) cb.current.onBasemapError(`Google basemap unavailable (${err.message}). Showing the Ginkgo map instead.`);
      });
    });
    return () => { cancelled = true; if (onMove) m.off('moveend', onMove); };
  }, [basemap]);

  // ── raster overlays: risk re-painted per scenario; the others on first use ──
  const showRaster = (id: RasterId, on: boolean, paintKey: string | null, paint: () => HTMLCanvasElement) => {
    whenReady(() => {
      const m = map.current!;
      setVis(m, `${id}-layer`, on);
      if (!on || paintKey === null || r.current.painted[id] === paintKey) return;
      r.current.painted[id] = paintKey;
      canvasToUrl(paint()).then(url => {
        if (r.current.painted[id] !== paintKey || !map.current) { URL.revokeObjectURL(url); return; }
        const old = r.current.urls[id];
        (map.current.getSource(id) as ImageSource | undefined)?.updateImage({ url });
        r.current.urls[id] = url;
        if (old) setTimeout(() => URL.revokeObjectURL(old), 2000);
      });
    });
  };
  useEffect(() => {
    showRaster('risk', layers.susceptibility, `${scenario.key}:${layers.showLow}`, () => classCanvas(bundle.grid, scenario, layers.showLow));
    r.current.popup?.remove();
  }, [bundle, scenario, layers.susceptibility, layers.showLow]);
  useEffect(() => { showRaster('history', layers.history, 'h', () => historyCanvas(bundle.grid)); }, [bundle, layers.history]);
  useEffect(() => { showRaster('built', layers.built, 'b', () => builtCanvas(bundle.grid)); }, [bundle, layers.built]);
  useEffect(() => {
    showRaster('safe', layers.safe && Boolean(grid.detail), grid.detail ? 's' : null, () => safeCanvas(grid, bundle.model));
  }, [bundle, grid, layers.safe]);

  // ── vector layers on/off ───────────────────────────────────────────────
  useEffect(() => {
    whenReady(() => {
      const m = map.current!;
      setVis(m, 'rivers-line', layers.rivers);
      for (const id of ['daerah-fill', 'daerah-line', 'daerah-label', 'daerah-selected-casing', 'daerah-selected']) setVis(m, id, layers.boundaries);
      for (const id of ['sites-circle', 'sites-label']) setVis(m, id, layers.sites);
      for (const id of ['rail-casing', 'rail-line', 'fac-stations']) setVis(m, id, layers.rail);
      const kinds = (Object.keys(LAYER_KINDS) as (keyof typeof LAYER_KINDS)[]).filter(k => layers[k]).flatMap(k => LAYER_KINDS[k]);
      const filter = ['in', ['get', 'k'], ['literal', kinds]] as unknown as FilterSpecification;
      m.setFilter('fac-icons', filter);
      m.setFilter('fac-labels', ['in', ['get', 'k'], ['literal', layers.rail ? [...kinds, 'station'] : kinds]] as unknown as FilterSpecification);
    });
  }, [layers]);

  // facility pins follow the scenario's class thresholds
  useEffect(() => {
    whenReady(() => (map.current!.getSource('facilities') as GeoJSONSource).setData(facilityData(bundle, scenario)));
  }, [bundle, scenario]);

  // ── daerah selection: outline it, dim the rest, fly there ─────────────
  useEffect(() => {
    whenReady(() => {
      const m = map.current!;
      for (const s of bundle.stats.daerah) {
        m.setFeatureState({ source: 'daerah', id: s.id }, { dim: selectedDaerah !== null && s.id !== selectedDaerah });
      }
      const only: FilterSpecification = ['all', ['==', ['get', 'id'], selectedDaerah ?? -1], ['!', ['has', 'excluded']]];
      m.setFilter('daerah-selected', only);
      m.setFilter('daerah-selected-casing', only);
      if (!selectedDaerah) return;
      const f = bundle.daerah.features.find(x => x.properties?.id === selectedDaerah && !x.properties?.excluded);
      if (!f) return;
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      const b = new LngLatBounds();
      polys.forEach(p => b.extend(ringBounds(p[0] as [number, number][])));
      m.fitBounds(b, { padding: pad(cb.current.padding, 24), duration: 700 });
    });
  }, [bundle, selectedDaerah]);

  // ── reset view ─────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !r.current.selangor || resetToken === 0) return;
    r.current.popup?.remove();
    m.fitBounds(r.current.selangor, { padding: cb.current.padding, duration: 600 });
  }, [resetToken]);

  // ── search / agent focus: Google-style red pin ─────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !focus) return;
    r.current.pin?.remove();
    const [lat, lon] = focus.point;
    r.current.pin = new Marker({ element: pinElement(focus.label, false), anchor: 'bottom' }).setLngLat([lon, lat]).addTo(m);
    const [[s, w], [n, e]] = focus.bounds;
    if (n - s < 0.004 && e - w < 0.004) m.flyTo({ center: [lon, lat], zoom: 15, offset: centerOffset(cb.current.padding), duration: 700 });
    else m.fitBounds([[w, s], [e, n]], { padding: pad(cb.current.padding, 40), maxZoom: 15, duration: 700 });
  }, [focus]);

  // ── open a cell popup on request (locate-me, copilot, facility lists) ──
  useEffect(() => {
    const m = map.current;
    if (!m || !inspect) return;
    if (inspect.me) {
      r.current.pin?.remove();
      r.current.pin = new Marker({ element: pinElement('You are here', true) }).setLngLat([inspect.lon, inspect.lat]).addTo(m);
    }
    m.flyTo({ center: [inspect.lon, inspect.lat], zoom: Math.max(m.getZoom(), 14), offset: centerOffset(cb.current.padding), duration: 700 });
    m.once('moveend', () => openRef.current(inspect.lon, inspect.lat, inspect.title));
  }, [inspect]);

  // ── candidate sites: green blocks + numbered pins ─────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    r.current.sitePins.forEach(p => p.remove());
    r.current.sitePins = [];
    const list = sites?.list ?? [];
    const cells = list.flatMap(x => Array.from(x.cells));
    showRaster('cand', list.length > 0, list.length ? `c${sites!.token}` : null, () => sitesCanvas(bundle.grid, cells));
    if (!list.length) return;
    for (const x of list) {
      const e = el('button', 'site-pin');
      e.type = 'button';
      e.append(el('b', undefined, `S${x.rank}`), el('span', undefined, fmtHa(x.area_km2)));
      e.title = `${sites!.label} candidate S${x.rank} · ${fmtHa(x.area_km2)}`;
      e.addEventListener('click', ev => {
        ev.stopPropagation();
        openRef.current(x.centre[0], x.centre[1], `Candidate S${x.rank} · ${fmtHa(x.area_km2)}`);
      });
      r.current.sitePins.push(new Marker({ element: e, anchor: 'center' }).setLngLat(x.centre).addTo(m));
    }
    const b = new LngLatBounds();
    list.forEach(x => b.extend(x.centre));
    m.fitBounds(b, { padding: pad(cb.current.padding, 70), maxZoom: 14, duration: 700 });
  }, [bundle, sites]);

  // ── drawn polygon ──────────────────────────────────────────────────────
  useEffect(() => {
    whenReady(() => {
      const data: FeatureCollection = drawn
        ? { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: drawn.map(ring => [...ring, ring[0]]) } }] }
        : EMPTY;
      (map.current!.getSource('drawn') as GeoJSONSource).setData(data);
    });
  }, [drawn]);

  // ── drawing tools ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || drawMode === 'none') return;
    const canvas = m.getCanvas();
    canvas.style.cursor = 'crosshair';
    r.current.popup?.remove();
    if (tip.current) tip.current.hidden = true;
    const draft = (features: Feature[]) => (m.getSource('draft') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features });
    const finish = (pts: [number, number][]) => {
      cleanup();
      if (pts.length >= 3) cb.current.onDrawn([pts]);
      cb.current.onDrawModeChange('none');
    };
    const cancel = () => { cleanup(); cb.current.onDrawModeChange('none'); };
    let cleanup = () => {};

    if (drawMode === 'rect') {
      m.dragPan.disable();
      m.boxZoom.disable();
      let start: LngLat | null = null;
      let last: LngLat | null = null;
      const corners = (a: LngLat, b: LngLat): [number, number][] => [[a.lng, a.lat], [b.lng, a.lat], [b.lng, b.lat], [a.lng, b.lat]];
      const down = (e: MapMouseEvent | MapTouchEvent) => {
        if ('button' in e.originalEvent && e.originalEvent.button !== 0) return;
        start = last = e.lngLat;
        e.preventDefault();
      };
      const move = (e: MapMouseEvent | MapTouchEvent) => {
        if (!start) return;
        last = e.lngLat;
        const ring = corners(start, last);
        draft([{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } }]);
      };
      const up = () => {
        if (!start || !last) return;
        const [a, b] = [start, last];
        start = null;
        r.current.quietUntil = Date.now() + 400;
        const pa = m.project(a), pb = m.project(b);
        if (Math.hypot(pa.x - pb.x, pa.y - pb.y) < 8) { draft([]); return; }
        finish(corners(a, b));
      };
      m.on('mousedown', down); m.on('mousemove', move); m.on('mouseup', up);
      m.on('touchstart', down); m.on('touchmove', move); m.on('touchend', up);
      cleanup = () => {
        m.off('mousedown', down); m.off('mousemove', move); m.off('mouseup', up);
        m.off('touchstart', down); m.off('touchmove', move); m.off('touchend', up);
        draft([]); m.dragPan.enable(); m.boxZoom.enable(); canvas.style.cursor = '';
      };
    } else {
      m.doubleClickZoom.disable();
      const pts: [number, number][] = [];
      let cursor: [number, number] | null = null;
      const near = (a: [number, number], b: [number, number]) => {
        const pa = m.project(a), pb = m.project(b);
        return Math.hypot(pa.x - pb.x, pa.y - pb.y) < 10;
      };
      const render = () => {
        const fs: Feature[] = [];
        if (pts.length >= 2) fs.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: pts } });
        if (pts.length && cursor) fs.push({ type: 'Feature', properties: { guide: 1 }, geometry: { type: 'LineString', coordinates: [pts[pts.length - 1], cursor, pts[0]] } });
        if (pts.length >= 3) fs.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]]] } });
        pts.forEach((p, i) => fs.push({ type: 'Feature', properties: { first: i === 0 ? 1 : 0 }, geometry: { type: 'Point', coordinates: p } }));
        draft(fs);
      };
      const click = (e: MapMouseEvent) => {
        const p: [number, number] = [e.lngLat.lng, e.lngLat.lat];
        if (pts.length >= 3 && near(p, pts[0])) { finish(pts.slice()); return; }
        if (pts.length && near(p, pts[pts.length - 1])) return; // second click of a double-click
        pts.push(p);
        render();
      };
      const move = (e: MapMouseEvent) => { cursor = [e.lngLat.lng, e.lngLat.lat]; if (pts.length) render(); };
      const dbl = (e: MapMouseEvent) => { e.preventDefault(); if (pts.length >= 3) finish(pts.slice()); };
      const key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && pts.length >= 3) finish(pts.slice());
        if (e.key === 'Backspace' && pts.length) { pts.pop(); render(); }
      };
      m.on('click', click); m.on('mousemove', move); m.on('dblclick', dbl);
      window.addEventListener('keydown', key);
      cleanup = () => {
        m.off('click', click); m.off('mousemove', move); m.off('dblclick', dbl);
        window.removeEventListener('keydown', key);
        draft([]);
        setTimeout(() => m.doubleClickZoom.enable(), 300);
        canvas.style.cursor = '';
      };
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    if (drawMode === 'rect') window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); cleanup(); };
  }, [drawMode]);

  return (
    <div ref={box} className="ml-map" aria-label="Map of Selangor">
      <div ref={tip} className="map-tip" hidden role="tooltip" />
    </div>
  );
};

/** Shift a fly-to target so it lands in the middle of the uncovered part of the map. */
function centerOffset(p: MapPadding): [number, number] {
  return [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
}

function pad(p: MapPadding, extra: number): MapPadding {
  return { top: p.top + extra, bottom: p.bottom + extra, left: p.left + extra, right: p.right + extra };
}
