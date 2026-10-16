// "Why this score" — each model input, what was measured here, its weight and
// how much it adds. Values come from analyseCells(); nothing is estimated here.

import type { FC } from 'react';
import type { AreaReport } from '../../data/analysis';
import type { ModelSpec, Scenario } from '../../data/types';

const SOURCE: Record<string, string> = {
  hand: 'Copernicus GLO-30 DEM → D8 drainage',
  prox: 'OpenStreetMap rivers & canals',
  flat: 'Copernicus GLO-30 DEM',
  elev: 'Copernicus GLO-30 DEM',
  hist: 'JRC Global Surface Water 1984–2021',
};

export const WhyScore: FC<{ report: AreaReport; model: ModelSpec; scenario: Scenario }> = ({ report, model, scenario }) => {
  const d = report.detail;
  if (!d) return <div className="callout">Terrain layers are still loading…</div>;
  return (
    <div>
      <div className="hero" style={{ marginBottom: 6 }}>
        <span className="value">{report.score_mean.toFixed(2)}</span>
        <span className="secondary" style={{ fontSize: 11.5 }}>
          mean score · High from {scenario.high.toFixed(2)}, Moderate from {scenario.moderate.toFixed(2)} ({scenario.label})
        </span>
      </div>
      <div className="why-row" style={{ borderBottom: '1px solid var(--border)', paddingTop: 0 }}>
        <span className="muted" style={{ fontSize: 10.5 }}>Input · measured here</span>
        <span className="muted" style={{ fontSize: 10.5 }}>0–1 value</span>
        <span className="muted" style={{ fontSize: 10.5, textAlign: 'right' }}>adds</span>
      </div>
      {d.why.map(w => (
        <div className="why-row" key={w.key} title={model.terms.find(t => t.key === w.key)?.why}>
          <div>
            <div className="lbl">{w.label} <span className="muted">× {w.weight.toFixed(2)}</span></div>
            <div className="inp">{w.input}</div>
            <div className="inp">{SOURCE[w.key]}</div>
          </div>
          <div className="meter" aria-label={`${w.label} value ${w.mean.toFixed(2)} of 1`}>
            <div style={{ width: `${w.mean * 100}%` }} />
          </div>
          <div className="val">+{w.contribution.toFixed(2)}</div>
        </div>
      ))}
      <div className="source-line">
        Sum of contributions {d.why_sum.toFixed(2)} (from the terrain layers) vs mean stored score {report.score_mean.toFixed(2)} — they differ only by layer rounding.
        Weights are {model.weights_status}.
      </div>
    </div>
  );
};
