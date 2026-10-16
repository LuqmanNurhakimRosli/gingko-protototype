// Ginkgo Command Center — "Method & validation" drawer.
// States what the model is, what it is not, how it was checked, and where every layer comes from.

import { useEffect, type FC } from 'react';
import { RISK_COLOR } from '../../data/format';
import type { ModelSpec, StatsFile, ValidationFile } from '../../data/types';
import { CAVEATS } from '../../services/exports';

interface Props {
  open: boolean;
  onClose: () => void;
  model: ModelSpec;
  validation: ValidationFile;
  stats: StatsFile;
  onShowSite: (lonlat: [number, number], name: string) => void;
}

const DATA = [
  ['Terrain (slope, HAND, elevation)', 'Copernicus GLO-30 DEM, 1″ → 3″ (~92 m); 3rd-lowest of 9 sub-pixels per cell to reduce building/canopy bias', 'https://registry.opendata.aws/copernicus-dem/'],
  ['Drainage & HAND', 'D8 flow on the burned, depression-filled DEM (pysheds); drainage = mapped rivers/canals + cells draining > 6 km² + coastline', ''],
  ['Rivers, canals, boundaries, place names', 'OpenStreetMap contributors via Overture Maps release 2026-09-23.1 (ODbL)', 'https://overturemaps.org/'],
  ['Observed water history', 'JRC Global Surface Water v1.4, occurrence 1984–2021: share of cell seen as water in 1–50 % of observations', 'https://global-surface-water.appspot.com/'],
  ['Land cover', 'ESA WorldCover 2021 v200, 10 m', 'https://esa-worldcover.org/'],
  ['Population', 'DOSM Census 2020 district totals; 30 m spatial pattern from Meta/CIESIN HRSL v1.5, scaled per daerah to the census', 'https://dataforgood.facebook.com/dfg/tools/high-resolution-population-density-maps'],
] as const;

export const MethodDrawer: FC<Props> = ({ open, onClose, model, validation, stats, onShowSite }) => {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;

  const floods = validation.sites.filter(s => s.kind === 'reported_flood' && !s.outside_scope);
  const ctrls = validation.sites.filter(s => s.kind === 'hilly_control');

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Method and validation">
        <div className="drawer-head">
          <strong style={{ fontSize: 14 }}>Method &amp; validation</strong>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">✕ Close</button>
        </div>
        <div className="drawer-body">
          <h3>What this shows</h3>
          <p>
            <strong>Riverine flood susceptibility</strong> — where flooding from rivers is more likely, given terrain, distance to mapped channels and past surface water.
            It is not a forecast of when a flood will happen, and not a hydraulic simulation (no water depths, no return periods).
          </p>

          <h3>Stage 1 model (the one running here)</h3>
          <div className="formula">
            {`S = ${model.terms.map(t => `${t.weight.toFixed(2)} · ${t.key}`).join('\n  + ')}`}
          </div>
          <table className="data" style={{ marginTop: 10 }}>
            <thead><tr><th>Term</th><th className="num">Weight</th><th>0–1 transform</th></tr></thead>
            <tbody>
              {model.terms.map(t => (
                <tr key={t.key}><td title={t.why}>{t.label}</td><td className="num">{t.weight.toFixed(2)}</td><td className="mono" style={{ fontSize: 10.5 }}>{t.transform}</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 8 }}>Weights are <strong>{model.weights_status}</strong>. Class thresholds were fixed from worked examples before the validation sites were checked:</p>
          <ul>
            {model.anchors.map(a => <li key={a.desc}>{a.desc} → score {a.score.toFixed(2)}</li>)}
          </ul>

          <h3>Rain scenarios (rule table)</h3>
          <table className="data">
            <thead><tr><th>Scenario</th><th>Rain label</th><th className="num">High from</th><th className="num">Moderate from</th><th className="num">Selangor High</th></tr></thead>
            <tbody>
              {model.scenarios.map(s => (
                <tr key={s.key}><td>{s.label}</td><td>{s.rain}</td><td className="num">{s.high.toFixed(2)}</td><td className="num">{s.moderate.toFixed(2)}</td><td className="num">{stats.state.scenarios[s.key].high_pct.toFixed(1)}%</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 6 }}>Heavier rain lowers the score needed for each class. The 120 mm/hr case is a hypothetical stress test, not an observed event.</p>

          <h3>Validation gate</h3>
          <p>
            Places reported flooded in December 2021 (news and fire-department reports) should come out <span style={{ color: RISK_COLOR.High, fontWeight: 650 }}>High</span>;
            hilly controls, chosen from the DEM by slope, should come out Low. Coordinates are matched to OpenStreetMap names, not typed by hand.
            Result: <strong>{floods.filter(s => s.pass).length} of {floods.length}</strong> flood sites High at the point,
            <strong> {ctrls.filter(s => s.pass).length} of {ctrls.length}</strong> controls Low. This is a sanity check, not an accuracy score.
          </p>
          <table className="data">
            <thead><tr><th>Site</th><th>Model (Normal)</th><th className="num">High ≤ {validation.radius_m} m</th><th>Inputs</th></tr></thead>
            <tbody>
              {validation.sites.map(s => (
                <tr key={s.id}>
                  <td>
                    <button className="btn btn-ghost btn-sm" style={{ padding: 0, fontWeight: 600 }} onClick={() => onShowSite(s.lonlat, s.name)}>{s.name}</button>
                    <div className="muted" style={{ fontSize: 10.5 }}>
                      {s.report}
                      {s.outside_scope && ' · outside Selangor: regression check only'}
                      {s.sources.map((u, i) => <span key={u}> <a href={u} target="_blank" rel="noreferrer">[{i + 1}]</a></span>)}
                    </div>
                  </td>
                  <td>
                    <span className={s.pass ? 'pass' : 'fail'}>{s.scenarios.normal.point}</span>
                    <span className="muted"> · expected {s.expect}</span>
                  </td>
                  <td className="num">{s.scenarios.normal.high_share_500m === null ? '—' : `${Math.round(s.scenarios.normal.high_share_500m * 100)}%`}</td>
                  <td className="mono" style={{ fontSize: 10 }}>
                    HAND {s.inputs.hand_m} m · river {s.inputs.river_m} m · {s.inputs.slope_deg}° · {s.inputs.elev_m} m
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Stage 2 (not in this build)</h3>
          <p>
            A learned model (e.g. random forest on these terms plus land cover) needs official flood-extent labels from JPS / DID, split by flood event or
            sub-catchment (not random pixels) so neighbouring cells don’t leak between training and test. Those labels were not available, so Stage 1 is the product.
          </p>

          <h3>Data</h3>
          <table className="data">
            <tbody>
              {DATA.map(([k, v, u]) => (
                <tr key={k}><td style={{ width: 170, fontWeight: 600 }}>{k}</td><td>{v}{u && <> · <a href={u} target="_blank" rel="noreferrer">link</a></>}</td></tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: 6 }}>
            All heavy processing runs once, offline (<span className="mono">pipeline/</span>), and was last built {model.built}. The app reads precomputed files and only
            clips them to the area you draw. HAND fell back to straight-line height above the nearest drainage for ~1.4 % of land cells where flow paths did not resolve.
          </p>

          <h3>Known limitations</h3>
          <ul>
            {CAVEATS.map(c => <li key={c}>{c}</li>)}
            <li>The DEM is a surface model; buildings and canopy can raise apparent ground height even after the low-value filter.</li>
            <li>The history term counts any intermittent water, so irrigated paddy and old mining ponds can score as “wet before” without being flood records.</li>
            <li>Built-up growth between two dates is not included: it needs two comparable land-cover dates, which this build does not have.</li>
            <li>Small drawn areas contain few ~92 m cells; treat their figures as indicative.</li>
          </ul>
        </div>
      </aside>
    </>
  );
};
