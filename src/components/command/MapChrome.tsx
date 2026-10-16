// Ginkgo Command Center — map chrome in the style of a consumer map app:
// floating search, quick-filter chips, layers panel, locate-me and reset buttons,
// drawing hint and a compact legend.

import { useState, type FC } from 'react';
import { BUILT_RGB, HISTORY_RGB, RISK_COLOR, RIVER_COLOR, SAFE_RGB } from '../../data/format';
import type { Place, Scenario } from '../../data/types';
import type { Basemap, DrawMode, LayerState } from './MapView';
import { PlaceSearch } from './PlaceSearch';

const rgb = ([r, g, b]: number[]) => `rgb(${r},${g},${b})`;

interface Props {
  places: Place[];
  scenario: Scenario;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  basemap: Basemap;
  onBasemap: (b: Basemap) => void;
  googleAvailable: boolean;
  detailReady: boolean;
  drawMode: DrawMode;
  onDrawMode: (m: DrawMode) => void;
  hasArea: boolean;
  onClearArea: () => void;
  onPick: (p: Place) => void;
  onAsk: () => void;
  onLocate: () => void;
  locating: boolean;
  onReset: () => void;
  notice: string | null;
  onDismissNotice: () => void;
}

const CHIPS: { key: keyof LayerState; label: string; icon: string; needsDetail?: boolean }[] = [
  { key: 'hospital', label: 'Hospitals', icon: '✚' },
  { key: 'school', label: 'Schools', icon: '◆' },
  { key: 'emergency', label: 'Police & Bomba', icon: '⛑' },
  { key: 'rail', label: 'Rail', icon: '⇄' },
  { key: 'clinic', label: 'Clinics', icon: '+' },
  { key: 'safe', label: 'Safe land', icon: '◍', needsDetail: true },
  { key: 'sites', label: 'Dec 2021 floods', icon: '◎' },
];

const BASEMAPS: { key: Basemap; label: string; swatch: string; google?: boolean }[] = [
  { key: 'streets', label: 'Streets', swatch: 'linear-gradient(135deg,#f2efe9 55%,#fbd9a6 55% 62%,#aad3df 62%)' },
  { key: 'light', label: 'Light', swatch: 'linear-gradient(135deg,#f5f5f3 60%,#dcdcdc 60% 66%,#d4dadc 66%)' },
  { key: 'osm', label: 'OpenStreetMap', swatch: 'linear-gradient(135deg,#f2efe9 50%,#e8a5a5 50% 57%,#cdebb0 57%)' },
  { key: 'google', label: 'Google Map', swatch: 'linear-gradient(135deg,#e8f5e9 52%,#fde293 52% 58%,#9fd3f0 58%)', google: true },
  { key: 'google-sat', label: 'Satellite', swatch: 'linear-gradient(135deg,#3d5a3a 40%,#6b7d4f 40% 70%,#2c4a5e 70%)', google: true },
  { key: 'none', label: 'No base', swatch: 'repeating-linear-gradient(45deg,#f3f4f6 0 6px,#e5e7eb 6px 12px)' },
];

const OVERLAYS: { key: keyof LayerState; label: string; color: string; needsDetail?: boolean; sub?: boolean }[] = [
  { key: 'susceptibility', label: 'Flood susceptibility', color: RISK_COLOR.High },
  { key: 'showLow', label: 'Shade Low class too', color: RISK_COLOR.Low, sub: true },
  { key: 'history', label: 'Water history 1984–2021 (JRC)', color: rgb(HISTORY_RGB) },
  { key: 'sites', label: 'Reported floods, Dec 2021', color: '#111111' },
  { key: 'rivers', label: 'Rivers & canals', color: RIVER_COLOR },
  { key: 'rail', label: 'Rail lines & stations', color: '#374151' },
  { key: 'boundaries', label: 'Daerah boundaries', color: '#111111' },
  { key: 'built', label: 'Built-up 2021', color: rgb(BUILT_RGB) },
  { key: 'safe', label: 'Safe land (screened)', color: rgb(SAFE_RGB), needsDetail: true },
];

export const MapChrome: FC<Props> = (p) => {
  const [panel, setPanel] = useState(false);
  const [legendOpen, setLegendOpen] = useState(true);
  const toggle = (k: keyof LayerState) => p.onLayers({ ...p.layers, [k]: !p.layers[k] });
  const facilitiesOn = p.layers.hospital || p.layers.clinic || p.layers.school || p.layers.emergency || p.layers.rail;

  return (
    <>
      <div className="gm-top">
        <PlaceSearch
          places={p.places}
          onPick={p.onPick}
          placeholder="Search Selangor"
          leading={<span className="gm-brand" aria-hidden>G</span>}
          trailing={<button className="gm-ask-btn" onClick={p.onAsk} aria-label="Ask Ginkgo">✦</button>}
        />
        <div className="gm-chips" role="toolbar" aria-label="Quick layers">
          <button className="gm-chip ask" onClick={p.onAsk}><span aria-hidden>✦</span> Ask Ginkgo</button>
          {CHIPS.map(c => (
            <button key={c.key} className="gm-chip" aria-pressed={p.layers[c.key]}
              disabled={c.needsDetail && !p.detailReady}
              title={c.needsDetail && !p.detailReady ? 'Loading terrain layers…' : undefined}
              onClick={() => toggle(c.key)}>
              <span aria-hidden>{c.icon}</span> {c.label}
            </button>
          ))}
          <span className="gm-chip-sep" aria-hidden />
          <button className="gm-chip" aria-pressed={p.drawMode === 'rect'} onClick={() => p.onDrawMode(p.drawMode === 'rect' ? 'none' : 'rect')}>▭ Rectangle</button>
          <button className="gm-chip" aria-pressed={p.drawMode === 'poly'} onClick={() => p.onDrawMode(p.drawMode === 'poly' ? 'none' : 'poly')}>⬠ Polygon</button>
          {p.hasArea && <button className="gm-chip" onClick={p.onClearArea}>✕ Clear area</button>}
        </div>
      </div>

      {p.drawMode !== 'none' && (
        <div className="draw-hint" role="status">
          {p.drawMode === 'rect'
            ? 'Drag on the map to draw a rectangle · Esc to cancel'
            : 'Tap to add points · double-click or tap the first point to finish · Backspace undoes · Esc cancels'}
        </div>
      )}
      {p.notice && (
        <div className="gm-notice" role="status">
          <span>{p.notice}</span>
          <button className="gm-icon-btn" onClick={p.onDismissNotice} aria-label="Dismiss">✕</button>
        </div>
      )}

      <div className="gm-fabs">
        <button className={`gm-fab${panel ? ' on' : ''}`} onClick={() => setPanel(v => !v)} aria-label="Layers" aria-expanded={panel}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path fill="currentColor" d="M12 3 2 8.5l10 5.5 10-5.5L12 3Zm-7.6 9.2L2 13.5 12 19l10-5.5-2.4-1.3L12 16.4l-7.6-4.2Z" /></svg>
        </button>
        <button className="gm-fab" onClick={p.onReset} aria-label="Reset view" title="Reset view">
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden><path fill="#DC2626" d="m12 2 4 10h-8z" /><path fill="#9CA3AF" d="m12 22-4-10h8z" /></svg>
        </button>
      </div>
      <button className="gm-fab gm-locate" onClick={p.onLocate} aria-label="Check my location" title="Check my location" disabled={p.locating}>
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden><circle cx="12" cy="12" r="4.5" fill={p.locating ? '#9CA3AF' : '#1A73E8'} /><circle cx="12" cy="12" r="8" fill="none" stroke={p.locating ? '#9CA3AF' : '#1A73E8'} strokeWidth="2" opacity=".35" /></svg>
      </button>

      {panel && (
        <div className="gm-panel" role="dialog" aria-label="Map layers">
          <div className="gm-panel-head">
            <strong>Map type</strong>
            <button className="gm-icon-btn" onClick={() => setPanel(false)} aria-label="Close">✕</button>
          </div>
          <div className="gm-basemaps">
            {BASEMAPS.map(b => {
              const off = b.google && !p.googleAvailable;
              return (
                <button key={b.key} className="gm-base" aria-pressed={p.basemap === b.key} disabled={off}
                  title={off ? 'Add VITE_GOOGLE_MAPS_API_KEY to enable Google basemaps' : undefined}
                  onClick={() => p.onBasemap(b.key)}>
                  <span className="sw" style={{ background: b.swatch }} />
                  <span>{b.label}</span>
                </button>
              );
            })}
          </div>
          {!p.googleAvailable && <div className="source-line" style={{ marginTop: 4 }}>Google basemaps need a Map Tiles API key (see docs/ARCHITECTURE.md).</div>}
          <div className="gm-panel-head" style={{ marginTop: 12 }}><strong>Map details</strong></div>
          <div className="gm-overlays">
            {OVERLAYS.map(o => (
              <label key={o.key} className={`gm-ov${o.sub ? ' sub' : ''}`}>
                <input type="checkbox" checked={p.layers[o.key]} onChange={() => toggle(o.key)}
                  disabled={(o.key === 'showLow' && !p.layers.susceptibility) || (o.needsDetail && !p.detailReady)} />
                <i style={{ background: o.color }} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className={`map-legend${legendOpen ? '' : ' closed'}`} aria-label="Map legend">
        <button className="legend-toggle" onClick={() => setLegendOpen(v => !v)} aria-expanded={legendOpen}>
          <strong>Flood susceptibility · {p.scenario.label}</strong><span aria-hidden>{legendOpen ? '▾' : '▸'}</span>
        </button>
        {legendOpen && (
          <>
            {p.layers.susceptibility && (['High', 'Moderate', ...(p.layers.showLow ? ['Low'] : [])] as ('High' | 'Moderate' | 'Low')[]).map(c => (
              <div className="row" key={c}><i style={{ background: RISK_COLOR[c], opacity: c === 'Low' ? 0.5 : 0.8 }} />{c}</div>
            ))}
            {facilitiesOn && <div className="row"><i className="dot" style={{ background: RISK_COLOR.High }} />Facility in High (dot colour = class)</div>}
            {p.layers.safe && <div className="row"><i style={{ background: rgb(SAFE_RGB), opacity: 0.7 }} />Safe land (screened)</div>}
            {p.layers.history && <div className="row"><i style={{ background: rgb(HISTORY_RGB) }} />Seen as water 1984–2021</div>}
            {p.layers.sites && <div className="row"><i className="dot" />Reported flood, Dec 2021</div>}
            {p.layers.rivers && <div className="row"><i className="line" style={{ background: RIVER_COLOR }} />River / canal (OSM)</div>}
            {p.layers.rail && <div className="row"><i className="line" style={{ background: '#374151' }} />Rail{p.layers.susceptibility ? '' : ' (operator colours)'}</div>}
            {p.layers.built && <div className="row"><i style={{ background: rgb(BUILT_RGB), opacity: 0.6 }} />Built-up 2021</div>}
            {p.layers.boundaries && <div className="row"><i style={{ background: '#9CA3AF', opacity: 0.6 }} />Federal territory (excluded)</div>}
          </>
        )}
      </div>
    </>
  );
};
