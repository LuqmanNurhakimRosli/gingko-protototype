// Ginkgo Command Center — centre map (Leaflet).
// Shows precomputed layers, lets the user pick a daerah, inspect a cell, and
// draw a rectangle or polygon. All numbers shown come from the grid.

import { useEffect, useLayoutEffect, useRef, type FC } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { Feature } from 'geojson';
import { classOf, CLASS_NAME, queryCell, type CellInfo, type Ring } from '../../data/analysis';
import { fmtCoord, fmtInt, RAIL_NEUTRAL, RISK_COLOR, RIVER_COLOR } from '../../data/format';
import { googleCopyright, googleSession, googleTileUrl, type GoogleMapType } from '../../data/googleTiles';
import { builtCanvas, canvasToUrl, classCanvas, gridBounds, historyCanvas, safeCanvas } from '../../data/overlays';
import type { AppDataBundle, Facility, FacilityKind, Grid, RiskClass, Scenario } from '../../data/types';

export type DrawMode = 'none' | 'rect' | 'poly';
export type Basemap = 'streets' | 'light' | 'osm' | 'google' | 'google-sat' | 'none';
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
export interface MapFocus { bounds: [[number, number], [number, number]]; label: string; point: [number, number]; token: number }
export interface MapInspect { lat: number; lon: number; title?: string; token: number }

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
  onSelectDaerah: (id: number | null) => void;
  onDrawn: (rings: Ring[]) => void;
  onDrawModeChange: (m: DrawMode) => void;
  onCellPick: (info: CellInfo) => void;
  onBasemapError: (message: string) => void;
}

type TileBase = Exclude<Basemap, 'none' | 'google' | 'google-sat'>;
const TILES: Record<TileBase, [string, L.TileLayerOptions]> = {
  // CARTO Voyager: OpenStreetMap data in a soft, Google-like street style
  streets: ['https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }],
  light: ['https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 20, subdomains: 'abcd',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
  }],
  osm: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }],
};

const DATA_ATTRIBUTION = 'Layers: Copernicus GLO-30, JRC GSW, ESA WorldCover, Meta HRSL, Overture Maps';
const KIND_LABEL: Record<FacilityKind, string> = {
  hospital: 'Hospital', clinic: 'Clinic', school: 'School', police: 'Police station', fire: 'Fire & rescue', station: 'Rail station',
};
const KIND_RADIUS: Record<FacilityKind, number> = { hospital: 7, clinic: 4, school: 4.5, police: 5, fire: 5.5, station: 5 };
const LAYER_KINDS: Record<'hospital' | 'clinic' | 'school' | 'emergency' | 'rail', FacilityKind[]> = {
  hospital: ['hospital'], clinic: ['clinic'], school: ['school'], emergency: ['police', 'fire'], rail: ['station'],
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
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
  const coords = el('div', 'muted', fmtCoord(info.lonlat));
  coords.style.fontSize = '10px';
  coords.style.marginTop = '4px';
  root.append(coords);
  const actions = el('div', 'actions');
  const ask = el('button', 'btn btn-subtle btn-sm', 'Ask copilot about this spot');
  ask.onclick = onAsk;
  actions.append(ask);
  root.append(actions);
  return root;
}

function facilityStyle(f: Facility, sc: Scenario): L.CircleMarkerOptions {
  const c = classOf(f.s, sc);
  const fill = c === 3 ? RISK_COLOR.High : c === 2 ? RISK_COLOR.Moderate : '#FFFFFF';
  return { radius: KIND_RADIUS[f.k], weight: f.k === 'hospital' ? 2.5 : 1.6, color: '#111111', fillColor: fill, fillOpacity: 1 };
}

export const MapView: FC<Props> = (props) => {
  const { bundle, grid, scenario, layers, basemap, selectedDaerah, drawn, drawMode, focus, inspect, resetToken } = props;
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  // Leaflet handlers are bound once; they read the latest props through this ref.
  const cb = useRef(props);
  useLayoutEffect(() => { cb.current = props; });
  const refs = useRef<{
    tiles?: L.TileLayer; googleAttr?: string; googleSessionId?: string;
    susc?: L.ImageOverlay; suscUrl?: string;
    hist?: L.ImageOverlay; histPainted?: boolean;
    built?: L.ImageOverlay; builtPainted?: boolean;
    safe?: L.ImageOverlay; safeUrl?: string;
    rivers?: L.GeoJSON; bounds?: L.GeoJSON; sites?: L.LayerGroup;
    rail?: L.LayerGroup; railLines?: { line: L.Polyline; key: string }[];
    facilities?: Record<string, L.LayerGroup>; facilityMarkers?: { m: L.CircleMarker; f: Facility }[];
    drawn?: L.Polygon; focusMarker?: L.CircleMarker;
    selangor?: L.LatLngBounds;
    /** a rectangle drag ends with a click event; ignore clicks until this time */
    quietUntil?: number;
  }>({});

  const openCellPopup = (latlng: L.LatLng, title?: string) => {
    const m = map.current;
    const p = cb.current;
    if (!m) return;
    const info = queryCell(p.grid, p.bundle.model, latlng.lng, latlng.lat);
    if (!info) return;
    L.popup({ maxWidth: 270 })
      .setLatLng(latlng)
      .setContent(cellPopup(info, p.scenario, () => { cb.current.onCellPick(info); m.closePopup(); }, title))
      .openOn(m);
  };
  const openRef = useRef(openCellPopup);
  useLayoutEffect(() => { openRef.current = openCellPopup; });

  // ── init once ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!box.current || map.current) return;
    const m = L.map(box.current, { zoomControl: false, minZoom: 8, maxZoom: 19, zoomSnap: 0.25, attributionControl: true });
    map.current = m;
    L.control.zoom({ position: 'bottomright' }).addTo(m);
    L.control.scale({ position: 'bottomright', imperial: false }).addTo(m);
    m.attributionControl.addAttribution(DATA_ATTRIBUTION);
    for (const [name, z] of [['raster', 350], ['history', 360], ['safe', 365], ['rivers', 420], ['rail', 425], ['bounds', 430], ['drawn', 450], ['facilities', 455], ['sites', 460]] as const) {
      m.createPane(name).style.zIndex = String(z);
    }
    for (const p of ['raster', 'history', 'safe']) m.getPane(p)!.style.pointerEvents = 'none';

    const r = refs.current;
    const gb = gridBounds(bundle.grid);
    r.susc = L.imageOverlay('', gb, { pane: 'raster', className: 'pixelated', interactive: false });
    r.hist = L.imageOverlay('', gb, { pane: 'history', className: 'pixelated', interactive: false });
    r.built = L.imageOverlay('', gb, { pane: 'raster', className: 'pixelated', interactive: false });
    r.safe = L.imageOverlay('', gb, { pane: 'safe', className: 'pixelated', interactive: false });

    // rivers on a canvas renderer (thousands of lines)
    const riverRenderer = L.canvas({ pane: 'rivers', padding: 0.3 });
    r.rivers = L.geoJSON(bundle.rivers, {
      pane: 'rivers',
      style: (f?: Feature) => {
        const c = f?.properties?.c;
        return { renderer: riverRenderer, color: RIVER_COLOR, weight: c === 'river' ? 1.6 : c === 'canal' ? 1.1 : 0.8, opacity: c === 'stream' ? 0.55 : 0.8 } as L.PathOptions;
      },
      interactive: false,
    });

    // rail: white casing under each line, so lines read on any basemap
    const railRenderer = L.canvas({ pane: 'rail', padding: 0.3 });
    r.rail = L.layerGroup([], { pane: 'rail' });
    r.railLines = [];
    for (const f of bundle.rail.features) {
      const key = String(f.properties?.k ?? 'other');
      const name = bundle.rail.lines[key]?.name ?? 'Rail';
      const gj = L.geoJSON(f, { style: () => ({ renderer: railRenderer, color: '#FFFFFF', weight: 6, opacity: 0.9 } as L.PathOptions), interactive: false });
      const line = L.geoJSON(f, { style: () => ({ renderer: railRenderer, color: RAIL_NEUTRAL, weight: 3.2, opacity: 1 } as L.PathOptions) });
      line.bindTooltip(name, { sticky: true, className: 'cc-tip' });
      r.rail.addLayer(gj).addLayer(line);
      line.eachLayer(l => r.railLines!.push({ line: l as L.Polyline, key }));
    }

    // facilities, one group per toggle, on a shared canvas renderer
    const facRenderer = L.canvas({ pane: 'facilities', padding: 0.3, tolerance: 4 });
    r.facilities = {};
    r.facilityMarkers = [];
    for (const [group, kinds] of Object.entries(LAYER_KINDS)) {
      const lg = L.layerGroup([], { pane: 'facilities' });
      for (const f of bundle.facilities.items.filter(x => kinds.includes(x.k))) {
        const mk = L.circleMarker([f.c[1], f.c[0]], { ...facilityStyle(f, cb.current.scenario), pane: 'facilities', renderer: facRenderer });
        mk.bindTooltip(() => {
          const sc = cb.current.scenario;
          return `<strong>${KIND_LABEL[f.k]}</strong><br>${f.n.replace(/[<>&]/g, '')}<br>${CLASS_NAME[classOf(f.s, sc)]} (${sc.label})`;
        }, { className: 'cc-tip', direction: 'top', offset: [0, -4] });
        mk.on('click', (e: L.LeafletMouseEvent) => {
          L.DomEvent.stopPropagation(e);
          if (cb.current.drawMode !== 'none') return;
          openRef.current(L.latLng(f.c[1], f.c[0]), f.n);
        });
        lg.addLayer(mk);
        r.facilityMarkers.push({ m: mk, f });
      }
      r.facilities[group] = lg;
    }

    // daerah boundaries — interactive; federal territories drawn as excluded
    r.bounds = L.geoJSON(bundle.daerah, {
      pane: 'bounds',
      style: () => ({}),
      onEachFeature: (f, layer) => {
        const p = f.properties as { id: number; name: string; excluded?: boolean };
        if (p.excluded) {
          layer.bindTooltip(`${p.name} — federal territory, outside Selangor scope`, { sticky: true, className: 'cc-tip' });
          return;
        }
        const st = bundle.stats.daerah.find(d => d.id === p.id)!;
        layer.bindTooltip(() => {
          const sc = cb.current.scenario;
          const s = st.scenarios[sc.key];
          return `<strong>${p.name}</strong><br>${s.high_pct.toFixed(1)}% High · ${s.moderate_pct.toFixed(1)}% Moderate (${sc.label})`;
        }, { sticky: true, className: 'cc-tip' });
        layer.on('click', (e: L.LeafletMouseEvent) => {
          if (cb.current.drawMode !== 'none' || Date.now() < (refs.current.quietUntil ?? 0)) return;
          if (cb.current.selectedDaerah !== p.id) {
            L.DomEvent.stopPropagation(e);
            cb.current.onSelectDaerah(p.id);
          }
        });
      },
    });

    // validation sites (Flow D self-audit)
    r.sites = L.layerGroup([], { pane: 'sites' });
    for (const s of bundle.validation.sites) {
      const isFlood = s.kind === 'reported_flood';
      const mk = L.circleMarker([s.lonlat[1], s.lonlat[0]], {
        pane: 'sites', radius: 6, weight: 2.5, color: '#111111',
        fillColor: isFlood ? '#FFFFFF' : '#111111', fillOpacity: 1,
      });
      mk.bindTooltip(() => {
        const sc = cb.current.scenario;
        const v = s.scenarios[sc.key];
        const tag = isFlood ? 'Reported flood, Dec 2021' : 'Hilly control (DEM-selected)';
        return `<strong>${s.name}</strong><br>${tag}<br>Model (${sc.label}): ${v.point} · expected ${s.expect}${s.outside_scope ? '<br><em>Outside Selangor — regression check only</em>' : ''}`;
      }, { className: 'cc-tip', direction: 'top', offset: [0, -6] });
      mk.on('click', (e: L.LeafletMouseEvent) => L.DomEvent.stopPropagation(e));
      r.sites.addLayer(mk);
    }

    // Selangor extent = union of the nine daerah
    const sel = L.latLngBounds([]);
    r.bounds.eachLayer(l => {
      const f = (l as L.Polygon).feature as Feature;
      if (!f.properties?.excluded) sel.extend((l as L.Polygon).getBounds());
    });
    r.selangor = sel;
    m.fitBounds(sel, { padding: [16, 16] });

    // map click → inspect a cell
    m.on('click', (e: L.LeafletMouseEvent) => {
      if (cb.current.drawMode !== 'none' || Date.now() < (refs.current.quietUntil ?? 0)) return;
      openRef.current(e.latlng);
    });

    const ro = new ResizeObserver(() => m.invalidateSize());
    ro.observe(box.current);
    return () => { ro.disconnect(); m.remove(); map.current = null; };
  }, [bundle]);

  // ── basemap (incl. optional Google Map Tiles API) ─────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m) return;
    let cancelled = false;
    const clearGoogleAttr = () => {
      if (r.googleAttr) m.attributionControl.removeAttribution(r.googleAttr);
      r.googleAttr = undefined;
    };
    r.tiles?.remove();
    r.tiles = undefined;
    clearGoogleAttr();
    if (basemap === 'none') return;
    if (basemap === 'google' || basemap === 'google-sat') {
      const type: GoogleMapType = basemap === 'google' ? 'roadmap' : 'satellite';
      let onMove: (() => void) | null = null;
      googleSession(type).then(session => {
        if (cancelled) return;
        r.googleSessionId = session;
        r.tiles = L.tileLayer(googleTileUrl(session), { maxZoom: 21, attribution: '' }).addTo(m);
        const setAttr = (text: string) => {
          clearGoogleAttr();
          r.googleAttr = `<span class="google-attr">Google</span> ${text.replace(/[<>&]/g, '')}`;
          m.attributionControl.addAttribution(r.googleAttr);
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
        if (!cancelled) cb.current.onBasemapError(`Google basemap unavailable (${err.message}). Showing Streets instead.`);
      });
      return () => { cancelled = true; if (onMove) m.off('moveend', onMove); };
    }
    const [url, opt] = TILES[basemap];
    r.tiles = L.tileLayer(url, opt).addTo(m);
    return () => { cancelled = true; };
  }, [basemap]);

  // ── susceptibility overlay (re-painted on scenario change) ─────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.susc) return;
    if (!layers.susceptibility) { r.susc.remove(); return; }
    let cancelled = false;
    canvasToUrl(classCanvas(bundle.grid, scenario, layers.showLow)).then(url => {
      if (cancelled) { URL.revokeObjectURL(url); return; }
      const old = r.suscUrl;
      r.susc!.setUrl(url);
      r.suscUrl = url;
      if (!m.hasLayer(r.susc!)) r.susc!.addTo(m);
      if (old) setTimeout(() => URL.revokeObjectURL(old), 1000);
    });
    m.closePopup();
    return () => { cancelled = true; };
  }, [bundle, scenario, layers.susceptibility, layers.showLow]);

  // ── history / built-up / safe-land overlays (painted on first use) ─────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.hist) return;
    if (!layers.history) { r.hist.remove(); return; }
    if (!r.histPainted) {
      r.histPainted = true;
      canvasToUrl(historyCanvas(bundle.grid)).then(url => { r.hist!.setUrl(url); });
    }
    r.hist.addTo(m);
  }, [bundle, layers.history]);

  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.built) return;
    if (!layers.built) { r.built.remove(); return; }
    if (!r.builtPainted) {
      r.builtPainted = true;
      canvasToUrl(builtCanvas(bundle.grid)).then(url => { r.built!.setUrl(url); });
    }
    r.built.addTo(m);
  }, [bundle, layers.built]);

  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.safe) return;
    if (!layers.safe || !grid.detail) { r.safe.remove(); return; }
    if (!r.safeUrl) {
      canvasToUrl(safeCanvas(grid, bundle.model)).then(url => { r.safeUrl = url; r.safe!.setUrl(url); });
    }
    r.safe.addTo(m);
  }, [bundle, grid, layers.safe]);

  // ── vector layers on/off ───────────────────────────────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m) return;
    const sync = (layer: L.Layer | undefined, on: boolean) => {
      if (!layer) return;
      if (on && !m.hasLayer(layer)) layer.addTo(m);
      if (!on && m.hasLayer(layer)) layer.remove();
    };
    sync(r.rivers, layers.rivers);
    sync(r.bounds, layers.boundaries);
    sync(r.sites, layers.sites);
    sync(r.rail, layers.rail);
    sync(r.facilities?.rail, layers.rail);
    sync(r.facilities?.hospital, layers.hospital);
    sync(r.facilities?.clinic, layers.clinic);
    sync(r.facilities?.school, layers.school);
    sync(r.facilities?.emergency, layers.emergency);
  }, [layers.rivers, layers.boundaries, layers.sites, layers.rail, layers.hospital, layers.clinic, layers.school, layers.emergency]);

  // facility colours follow the scenario; rail takes operator colours only
  // when the risk layer is off (their reds/oranges/blues would read as risk classes)
  useEffect(() => {
    const r = refs.current;
    for (const { m, f } of r.facilityMarkers ?? []) m.setStyle(facilityStyle(f, scenario));
  }, [scenario]);
  useEffect(() => {
    const r = refs.current;
    for (const { line, key } of r.railLines ?? []) {
      line.setStyle({ color: layers.susceptibility ? RAIL_NEUTRAL : bundle.rail.lines[key]?.color ?? RAIL_NEUTRAL });
    }
  }, [bundle, layers.susceptibility]);

  // ── daerah styling + zoom on selection ─────────────────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.bounds) return;
    r.bounds.setStyle((f?: Feature) => {
      const p = f?.properties as { id: number; excluded?: boolean };
      if (p.excluded) return { color: '#6B7280', weight: 1, dashArray: '4 3', fillColor: '#9CA3AF', fillOpacity: 0.32 };
      const on = p.id === selectedDaerah;
      return {
        color: '#111111', weight: on ? 3 : 1.1, opacity: on ? 1 : 0.75,
        fillColor: '#111111', fillOpacity: selectedDaerah && !on ? 0.06 : 0.0001,
      };
    });
    if (selectedDaerah) {
      r.bounds.eachLayer(l => {
        const pl = l as L.Polygon;
        if ((pl.feature as Feature).properties?.id === selectedDaerah && !(pl.feature as Feature).properties?.excluded) {
          pl.bringToFront();
          m.flyToBounds(pl.getBounds(), { padding: [24, 24], duration: 0.6 });
        }
      });
    }
  }, [selectedDaerah]);

  // ── reset view ─────────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !r.selangor || resetToken === 0) return;
    m.closePopup();
    m.flyToBounds(r.selangor, { padding: [16, 16], duration: 0.5 });
  }, [resetToken]);

  // ── search / agent focus ───────────────────────────────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m || !focus) return;
    r.focusMarker?.remove();
    r.focusMarker = L.circleMarker(focus.point, { pane: 'sites', radius: 7, color: '#08A045', weight: 3, fillColor: '#fff', fillOpacity: 1 })
      .bindTooltip(focus.label, { permanent: true, direction: 'right', className: 'cc-tip', offset: [8, 0] })
      .addTo(m);
    const b = L.latLngBounds(focus.bounds);
    if (b.getNorth() - b.getSouth() < 0.004) m.flyTo(focus.point, 15, { duration: 0.6 });
    else m.flyToBounds(b, { padding: [40, 40], maxZoom: 15, duration: 0.6 });
  }, [focus]);

  // ── open a cell popup on request (locate-me, copilot) ─────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || !inspect) return;
    const ll = L.latLng(inspect.lat, inspect.lon);
    m.flyTo(ll, Math.max(m.getZoom(), 14), { duration: 0.6 });
    m.once('moveend', () => openRef.current(ll, inspect.title));
  }, [inspect]);

  // ── drawn polygon ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current, r = refs.current;
    if (!m) return;
    r.drawn?.remove();
    r.drawn = undefined;
    if (drawn) {
      r.drawn = L.polygon(drawn.map(ring => ring.map(([x, y]) => [y, x] as [number, number])), {
        pane: 'drawn', color: '#111111', weight: 2.5, fillColor: '#111111', fillOpacity: 0.05, interactive: false,
      }).addTo(m);
    }
  }, [drawn]);

  // ── drawing tools ──────────────────────────────────────────────────────
  useEffect(() => {
    const m = map.current;
    if (!m || drawMode === 'none') return;
    const container = m.getContainer();
    container.style.cursor = 'crosshair';
    m.closePopup();
    const style = { pane: 'drawn', color: '#08A045', weight: 2.5, fillColor: '#08A045', fillOpacity: 0.08, interactive: false };
    const finish = (latlngs: L.LatLng[]) => {
      cleanup();
      if (latlngs.length >= 3) cb.current.onDrawn([latlngs.map(p => [p.lng, p.lat] as [number, number])]);
      cb.current.onDrawModeChange('none');
    };
    const cancel = () => { cleanup(); cb.current.onDrawModeChange('none'); };
    let cleanup = () => {};

    if (drawMode === 'rect') {
      m.dragging.disable();
      let start: L.LatLng | null = null;
      let rect: L.Rectangle | null = null;
      const down = (e: L.LeafletMouseEvent) => { start = e.latlng; };
      const move = (e: L.LeafletMouseEvent) => {
        if (!start) return;
        const b = L.latLngBounds(start, e.latlng);
        if (rect) rect.setBounds(b); else rect = L.rectangle(b, style).addTo(m);
      };
      const up = (e: L.LeafletMouseEvent) => {
        if (!start) return;
        const b = L.latLngBounds(start, e.latlng);
        start = null;
        refs.current.quietUntil = Date.now() + 400;
        const px = m.latLngToContainerPoint(b.getNorthEast()).distanceTo(m.latLngToContainerPoint(b.getSouthWest()));
        if (px < 8) { rect?.remove(); rect = null; return; }
        finish([b.getNorthWest(), b.getNorthEast(), b.getSouthEast(), b.getSouthWest()]);
      };
      m.on('mousedown', down); m.on('mousemove', move); m.on('mouseup', up);
      cleanup = () => {
        m.off('mousedown', down); m.off('mousemove', move); m.off('mouseup', up);
        rect?.remove(); m.dragging.enable(); container.style.cursor = '';
      };
    } else {
      m.doubleClickZoom.disable();
      const pts: L.LatLng[] = [];
      const line = L.polyline([], { ...style, dashArray: undefined }).addTo(m);
      const guide = L.polyline([], { ...style, weight: 1.5, opacity: 0.7 }).addTo(m);
      const vertices = L.layerGroup().addTo(m);
      const near = (a: L.LatLng, b: L.LatLng) => m.latLngToContainerPoint(a).distanceTo(m.latLngToContainerPoint(b)) < 10;
      const click = (e: L.LeafletMouseEvent) => {
        if (pts.length >= 3 && near(e.latlng, pts[0])) { finish(pts.slice()); return; }
        if (pts.length && near(e.latlng, pts[pts.length - 1])) return; // second click of a double-click
        pts.push(e.latlng);
        line.setLatLngs(pts);
        L.circleMarker(e.latlng, { pane: 'drawn', radius: pts.length === 1 ? 6 : 4, color: '#08A045', weight: 2, fillColor: '#fff', fillOpacity: 1, interactive: false }).addTo(vertices);
      };
      const move = (e: L.LeafletMouseEvent) => { if (pts.length) guide.setLatLngs([pts[pts.length - 1], e.latlng, pts[0]]); };
      const dbl = () => { if (pts.length >= 3) finish(pts.slice()); };
      const key = (e: KeyboardEvent) => {
        if (e.key === 'Escape') cancel();
        if (e.key === 'Enter' && pts.length >= 3) finish(pts.slice());
        if (e.key === 'Backspace' && pts.length) {
          pts.pop(); line.setLatLngs(pts);
          const ls = vertices.getLayers(); if (ls.length) vertices.removeLayer(ls[ls.length - 1]);
        }
      };
      m.on('click', click); m.on('mousemove', move); m.on('dblclick', dbl);
      window.addEventListener('keydown', key);
      cleanup = () => {
        m.off('click', click); m.off('mousemove', move); m.off('dblclick', dbl);
        window.removeEventListener('keydown', key);
        line.remove(); guide.remove(); vertices.remove();
        setTimeout(() => m.doubleClickZoom.enable(), 300);
        container.style.cursor = '';
      };
    }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') cancel(); };
    if (drawMode === 'rect') window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('keydown', esc); cleanup(); };
  }, [drawMode]);

  return <div ref={box} style={{ position: 'absolute', inset: 0 }} aria-label="Map of Selangor" />;
};
