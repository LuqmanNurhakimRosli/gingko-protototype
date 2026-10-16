// Ginkgo Command Center — report for a drawn rectangle/polygon.

import type { FC } from 'react';
import type { AreaReport as Report, Ring } from '../../data/analysis';
import { fmtHa, fmtKm2, fmtPct, fmtPopEstimate, RISK_COLOR, SERIES_COLOR } from '../../data/format';
import type { ModelSpec, Scenario } from '../../data/types';
import { BarList } from '../charts/BarList';
import { WhyScore } from './WhyScore';

export interface DrawnArea { id: number; label: string; rings: Ring[]; report: Report }

interface Props {
  area: DrawnArea | null;
  model: ModelSpec;
  scenario: Scenario;
  onDraw: (mode: 'rect' | 'poly') => void;
  onExportPdf: () => void;
  onExportGeo: () => void;
  onAsk: () => void;
  onRemove: () => void;
  exporting: boolean;
}

const ClassStrip: FC<{ high: number; moderate: number; low: number }> = ({ high, moderate, low }) => {
  const segs = [
    { k: 'High', v: high, c: RISK_COLOR.High },
    { k: 'Moderate', v: moderate, c: RISK_COLOR.Moderate },
    { k: 'Low', v: low, c: RISK_COLOR.Low },
  ].filter(s => s.v > 0);
  return (
    <div>
      <div style={{ display: 'flex', gap: 2, height: 14 }} role="img"
        aria-label={`High ${fmtPct(high)}, Moderate ${fmtPct(moderate)}, Low ${fmtPct(low)}`}>
        {segs.map((s, i) => (
          <div key={s.k} style={{
            flex: `${s.v} 0 0`, background: s.c, minWidth: 2,
            borderRadius: i === 0 && i === segs.length - 1 ? 4 : i === 0 ? '4px 0 0 4px' : i === segs.length - 1 ? '0 4px 4px 0' : 0,
          }} />
        ))}
      </div>
      <div className="legend" style={{ marginTop: 6, marginBottom: 0 }}>
        <span><i style={{ background: RISK_COLOR.High }} />High {fmtPct(high)}</span>
        <span><i style={{ background: RISK_COLOR.Moderate }} />Moderate {fmtPct(moderate)}</span>
        <span><i style={{ background: RISK_COLOR.Low }} />Low {fmtPct(low)}</span>
      </div>
    </div>
  );
};

export const AreaReportCard: FC<Props> = ({ area, model, scenario, onDraw, onExportPdf, onExportGeo, onAsk, onRemove, exporting }) => {
  if (!area) {
    return (
      <section className="card">
        <div className="card-head"><div className="card-title">Drawn area</div></div>
        <div className="empty-state">
          Draw a rectangle or polygon on the map to get statistics for exactly that area.
          <div className="btn-row" style={{ justifyContent: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={() => onDraw('rect')}>▭ Draw rectangle</button>
            <button className="btn btn-secondary btn-sm" onClick={() => onDraw('poly')}>⬠ Draw polygon</button>
          </div>
        </div>
      </section>
    );
  }
  const r = area.report;
  const cur = r.scenarios[scenario.key];
  const outside = r.outside_km2 + r.federal_km2;
  return (
    <>
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">{area.label}</div>
            <div className="card-sub">
              {fmtKm2(r.polygon_km2)} drawn · {r.daerah.map(d => d.name).join(', ') || 'outside Selangor'}
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onRemove} aria-label="Remove drawn area">✕</button>
        </div>

        {r.land_km2 === 0 ? (
          <div className="callout warn">This area has no Selangor land in it{r.federal_km2 > 0 ? ' (federal territories are outside the scope)' : ''}.</div>
        ) : (
          <>
            {outside > 0.05 && (
              <div className="callout" style={{ marginBottom: 8 }}>
                {fmtKm2(outside)} of the drawn area is outside Selangor{r.federal_km2 > 0 ? ' (incl. federal territory)' : ''} and is not counted.
              </div>
            )}
            {r.land_km2 < 0.5 && (
              <div className="callout warn" style={{ marginBottom: 8 }}>
                Small area: only {r.cell_count} cells of ~92 m. Treat the numbers as indicative.
              </div>
            )}
            <div className="card-sub" style={{ marginBottom: 6 }}>Land by class · {scenario.label} ({scenario.rain})</div>
            <ClassStrip high={cur.high_pct} moderate={cur.moderate_pct} low={cur.low_pct} />

            <table className="data" style={{ marginTop: 12 }}>
              <thead>
                <tr><th>Scenario</th><th className="num">High</th><th className="num">km²</th><th className="num">Zones</th><th className="num">People in High</th></tr>
              </thead>
              <tbody>
                {model.scenarios.map(sc => {
                  const s = r.scenarios[sc.key];
                  return (
                    <tr key={sc.key} style={sc.key === scenario.key ? { fontWeight: 650 } : undefined}>
                      <td title={sc.rain}>{sc.label}</td>
                      <td className="num">{fmtPct(s.high_pct)}</td>
                      <td className="num">{s.high_km2 < 10 ? s.high_km2.toFixed(2) : Math.round(s.high_km2)}</td>
                      <td className="num">{s.zones}</td>
                      <td className="num">{fmtPopEstimate(s.pop_high)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="source-line">Heavy = {model.scenarios[1].rain}; Extreme = {model.scenarios[2].rain}. Rule table, not a hydraulic simulation.</div>
          </>
        )}
      </section>

      {r.land_km2 > 0 && (
        <section className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Site profile</div>
          <dl className="kv">
            <dt>Selangor land analysed</dt><dd>{fmtKm2(r.land_km2)}</dd>
            <dt>Population (estimate)</dt><dd>{fmtPopEstimate(r.population)}</dd>
            <dt>Built-up (2021)</dt><dd>{fmtPct(r.built_pct)}</dd>
            <dt>Rivers &amp; canals inside</dt><dd>{r.river_km.toFixed(1)} km</dd>
            <dt>Elevation range</dt><dd>{r.detail ? `${r.detail.elev_min}–${r.detail.elev_max} m` : '…'}</dd>
            <dt>Median height above drainage</dt><dd>{r.detail ? `${r.detail.hand_median.toFixed(1)} m` : '…'}</dd>
            <dt>Seen as water 1984–2021</dt><dd>{fmtPct(r.hist_pct, 0)} of cells</dd>
          </dl>
          {r.detail && (
            <>
              <div className="card-sub" style={{ margin: '12px 0 6px' }}>Land cover · ESA WorldCover 2021</div>
              <BarList
                ariaLabel="Land cover share"
                color={SERIES_COLOR}
                items={[
                  ['Built-up', r.detail.landcover.built], ['Tree cover', r.detail.landcover.tree],
                  ['Cropland', r.detail.landcover.crop], ['Water & wetland', r.detail.landcover.water],
                  ['Other', r.detail.landcover.other],
                ].map(([k, v]) => ({ id: k as string, label: k as string, value: v as number, display: fmtPct((v as number) * 100, 0) }))}
              />
              <div className="callout" style={{ marginTop: 10 }}>
                <strong>Development screen:</strong> {fmtHa(r.detail.candidate_km2)} is Low susceptibility (Normal), under 12° slope,
                under 20% built-up, not water and not forest-dominated. Early screening only — zoning, land status and a flood study still apply.
              </div>
            </>
          )}
        </section>
      )}

      {r.land_km2 > 0 && (
        <section className="card">
          <div className="card-title" style={{ marginBottom: 8 }}>Why this score</div>
          <WhyScore report={r} model={model} scenario={scenario} />
          <div className="btn-row">
            <button className="btn btn-primary btn-sm" onClick={onExportPdf} disabled={exporting || !r.detail}>
              {exporting ? 'Preparing…' : '⇩ PDF brief'}
            </button>
            <button className="btn btn-secondary btn-sm" onClick={onExportGeo}>⇩ GeoJSON</button>
            <button className="btn btn-subtle btn-sm" onClick={onAsk}>Ask copilot</button>
          </div>
        </section>
      )}
    </>
  );
};
