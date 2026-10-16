// Ginkgo Command Center — flood risk ranking (daerah or drawn areas), ranked by High share.

import { useState, type FC } from 'react';
import { fmtPopEstimate } from '../../data/format';
import type { Scenario, StatsFile } from '../../data/types';
import { RiskBars, RiskLegend } from '../charts/RiskBars';
import type { DrawnArea } from './AreaReport';

interface Props {
  stats: StatsFile;
  scenario: Scenario;
  areas: DrawnArea[];
  selectedDaerah: number | null;
  activeArea: number | null;
  onSelectDaerah: (id: number | null) => void;
  onSelectArea: (id: number) => void;
}

export const RankingCard: FC<Props> = ({ stats, scenario, areas, selectedDaerah, activeArea, onSelectDaerah, onSelectArea }) => {
  const [tab, setTab] = useState<'daerah' | 'areas'>('daerah');
  const k = scenario.key;
  const showAreas = tab === 'areas' && areas.length > 0;
  const items = showAreas
    ? [...areas].filter(a => a.report.land_km2 > 0)
      .sort((a, b) => b.report.scenarios[k].high_pct - a.report.scenarios[k].high_pct)
      .map(a => ({
        id: a.id, label: a.label, high: a.report.scenarios[k].high_pct, moderate: a.report.scenarios[k].moderate_pct,
        extra: [{ label: 'people in High (est.)', value: fmtPopEstimate(a.report.scenarios[k].pop_high) }],
      }))
    : [...stats.daerah]
      .sort((a, b) => b.scenarios[k].high_pct - a.scenarios[k].high_pct)
      .map(d => ({
        id: d.id, label: d.name, high: d.scenarios[k].high_pct, moderate: d.scenarios[k].moderate_pct,
        extra: [
          { label: 'people in High (est.)', value: fmtPopEstimate(d.scenarios[k].pop_high) },
          { label: 'High-risk zones', value: String(d.scenarios[k].zones) },
        ],
      }));

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <div className="card-title">Flood risk ranking</div>
          <div className="card-sub">Share of land by class · {scenario.label}</div>
        </div>
        <div className="seg" role="group" aria-label="Rank daerah or drawn areas">
          <button aria-pressed={tab === 'daerah'} onClick={() => setTab('daerah')}>Daerah</button>
          <button aria-pressed={tab === 'areas'} onClick={() => setTab('areas')} disabled={!areas.length}
            title={areas.length ? undefined : 'Draw an area first'}>
            Drawn ({areas.length})
          </button>
        </div>
      </div>
      <RiskLegend />
      <RiskBars
        ariaLabel="Ranking by share of High-susceptibility land"
        items={items}
        selectedId={showAreas ? activeArea : selectedDaerah}
        onSelect={id => (showAreas ? onSelectArea(Number(id)) : onSelectDaerah(Number(id) === selectedDaerah ? null : Number(id)))}
      />
      <div className="source-line">Bars show High then Moderate; the rest of the land is Low. Ginkgo Stage 1 susceptibility.</div>
    </section>
  );
};
