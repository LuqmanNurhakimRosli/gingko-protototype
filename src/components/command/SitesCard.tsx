// Ginkgo Command Center — candidate sites from the site screen (AI or manual).
// Each site is a contiguous block that stays Low under the chosen scenario and
// passes the development screen. Screening only, never a recommendation.

import type { FC } from 'react';
import type { CandidateSite } from '../../data/analysis';
import { fmtHa, fmtInt } from '../../data/format';

interface Props {
  label: string;
  sites: CandidateSite[];
  lowUnder: string;
  onShow: (s: CandidateSite) => void;
  onClear: () => void;
}

export const SitesCard: FC<Props> = ({ label, sites, lowUnder, onShow, onClear }) => (
  <section className="card sites-card">
    <div className="card-head">
      <div>
        <div className="card-title">Candidate sites · {label}</div>
        <div className="card-sub">Low under {lowUnder} · slope &lt; 12° · &lt; 20% built-up · not water or forest</div>
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onClear} aria-label="Clear candidate sites">✕</button>
    </div>
    {sites.length === 0 ? (
      <div className="empty-state">No block of that size passes the screen here. Try a larger area or a milder scenario.</div>
    ) : (
      <ol className="site-list">
        {sites.map(s => (
          <li key={s.rank}>
            <button onClick={() => onShow(s)}>
              <span className="site-badge">S{s.rank}</span>
              <span className="site-main">
                <strong>{fmtHa(s.area_km2)}</strong>
                <span className="muted"> · {s.daerah ?? '—'}</span>
                <span className="site-sub">
                  score {s.score_mean.toFixed(2)} · slope {s.slope_mean.toFixed(1)}° ·{' '}
                  {s.nearest_high_m === null ? 'no High within 5 km' : `High ${fmtInt(s.nearest_high_m)} m away`}
                </span>
              </span>
              <span className="go" aria-hidden>›</span>
            </button>
          </li>
        ))}
      </ol>
    )}
    <div className="source-line">Early screening only — zoning, land status, access and a site flood study still apply.</div>
  </section>
);
