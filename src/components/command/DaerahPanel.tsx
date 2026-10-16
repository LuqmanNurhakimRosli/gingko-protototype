// Ginkgo Command Center — left panel: population by daerah, KPI tiles and
// "why this score" for the selected daerah (or all of Selangor).

import { useState, type FC } from 'react';
import type { AreaReport } from '../../data/analysis';
import { fmtCompact, fmtInt, fmtKm2, fmtPct, fmtPopEstimate, RISK_COLOR, SERIES_COLOR } from '../../data/format';
import type { ModelSpec, Scenario, StatsFile } from '../../data/types';
import { BarList } from '../charts/BarList';
import { WhyScore } from './WhyScore';

interface Props {
  stats: StatsFile;
  model: ModelSpec;
  scenario: Scenario;
  selected: number | null;
  report: AreaReport | null;
  onSelect: (id: number | null) => void;
}

export const DaerahPanel: FC<Props> = ({ stats, model, scenario, selected, report, onSelect }) => {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  const rows = [...stats.daerah].sort((a, b) => b.population - a.population);
  const d = selected ? stats.daerah.find(x => x.id === selected)! : null;
  const sc = d ? d.scenarios[scenario.key] : stats.state.scenarios[scenario.key];
  const pop = d ? d.population : stats.state.population;
  const land = d ? d.land_km2 : stats.state.land_km2;

  return (
    <aside className="cc-panel left" aria-label="Daerah indicators">
      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Population by daerah</div>
            <div className="card-sub">Census 2020 · click a bar to open a daerah</div>
          </div>
          <div className="seg" role="group" aria-label="Chart or table">
            <button aria-pressed={view === 'chart'} onClick={() => setView('chart')}>Chart</button>
            <button aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>
        </div>
        {view === 'chart' ? (
          <BarList
            ariaLabel="Population by daerah, Census 2020"
            color={SERIES_COLOR}
            selectedId={selected}
            onSelect={id => onSelect(id === selected ? null : Number(id))}
            items={rows.map(r => ({
              id: r.id, label: r.name, value: r.population, display: fmtCompact(r.population),
              tip: { title: r.name, rows: [
                { label: 'people (Census 2020)', value: fmtInt(r.population), color: SERIES_COLOR },
                { label: 'land area', value: fmtKm2(r.land_km2) },
              ] },
            }))}
          />
        ) : (
          <table className="data">
            <thead><tr><th>Daerah</th><th className="num">People</th><th className="num">km²</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}><td>{r.name}</td><td className="num">{fmtInt(r.population)}</td><td className="num">{fmtInt(r.land_km2)}</td></tr>
              ))}
              <tr><td><strong>Selangor</strong></td><td className="num"><strong>{fmtInt(stats.state.population)}</strong></td><td className="num"><strong>{fmtInt(stats.state.land_km2)}</strong></td></tr>
            </tbody>
          </table>
        )}
        <div className="source-line">
          DOSM Population &amp; Housing Census 2020. The nine districts sum to the published Selangor total of {fmtInt(stats.state.population)}.
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">{d ? d.name : 'Selangor · all 9 daerah'}</div>
            <div className="card-sub">{scenario.label} scenario · {scenario.rain}</div>
          </div>
          {d && <button className="btn btn-ghost btn-sm" onClick={() => onSelect(null)}>All Selangor</button>}
        </div>
        <div className="tiles">
          <div className="tile">
            <div className="label">Population</div>
            <div className="value">{fmtCompact(pop)}</div>
            <div className="note">Census 2020</div>
          </div>
          <div className="tile">
            <div className="label"><span className="swatch" style={{ background: RISK_COLOR.High }} />High-susceptibility land</div>
            <div className="value">{fmtPct(sc.high_pct)}</div>
            <div className="note">{fmtKm2(sc.high_km2)} of {fmtKm2(land)}</div>
          </div>
          <div className="tile">
            <div className="label">High-risk zones</div>
            <div className="value">{sc.zones}</div>
            <div className="note">connected High areas ≥ {model.zone_min_km2} km²</div>
          </div>
          <div className="tile">
            <div className="label">People in High cells</div>
            <div className="value">{fmtPopEstimate(sc.pop_high)}</div>
            <div className="note">estimate · HRSL × Census</div>
          </div>
          <div className="tile">
            <div className="label"><span className="swatch" style={{ background: RISK_COLOR.Moderate }} />Moderate land</div>
            <div className="value">{fmtPct(sc.moderate_pct)}</div>
            <div className="note">{fmtKm2(sc.moderate_km2)}</div>
          </div>
          <div className="tile">
            <div className="label">Built-up land</div>
            <div className="value">{fmtPct(d ? d.built_pct : report?.built_pct ?? 0)}</div>
            <div className="note">ESA WorldCover 2021</div>
          </div>
        </div>
        {report && (
          <div className="source-line">
            {report.river_km.toFixed(0)} km of mapped rivers &amp; canals
            {report.detail && <> · elevation {report.detail.elev_min}–{fmtInt(report.detail.elev_max)} m · median {report.detail.hand_median.toFixed(1)} m above drainage</>}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-head">
          <div>
            <div className="card-title">Why this score</div>
            <div className="card-sub">{d ? d.name : 'Selangor'} · computed inputs and their sources</div>
          </div>
        </div>
        {report ? <WhyScore report={report} model={model} scenario={scenario} /> : <div className="callout">Computing…</div>}
      </section>
    </aside>
  );
};
