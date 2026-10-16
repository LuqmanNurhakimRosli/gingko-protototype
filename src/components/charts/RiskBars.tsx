// Stacked High + Moderate bars on one shared 0–100 % axis, ranked by High.
// Two series → a legend is always shown; High % is direct-labelled at the tip.

import type { FC } from 'react';
import { fmtPct, RISK_COLOR } from '../../data/format';
import { Tooltip } from './Tooltip';
import { useTooltip, type TipRow } from './useTooltip';

export interface RiskItem {
  id: number | string;
  label: string;
  high: number;      // %
  moderate: number;  // %
  extra?: TipRow[];
}

interface Props {
  items: RiskItem[];
  selectedId?: number | string | null;
  onSelect?: (id: number | string) => void;
  ariaLabel: string;
}

export const RiskLegend: FC<{ showLow?: boolean }> = ({ showLow = true }) => (
  <div className="legend" aria-label="Risk scale">
    <span><i style={{ background: RISK_COLOR.High }} />High</span>
    <span><i style={{ background: RISK_COLOR.Moderate }} />Moderate</span>
    {showLow && <span><i style={{ background: RISK_COLOR.Low }} />Low</span>}
  </div>
);

export const RiskBars: FC<Props> = ({ items, selectedId, onSelect, ariaLabel }) => {
  const { tip, show, hide } = useTooltip();
  return (
    <div className={`bars${selectedId != null ? ' dim' : ''}`} role="list" aria-label={ariaLabel}>
      {items.map(it => {
        const content = {
          title: it.label,
          rows: [
            { label: 'High', value: fmtPct(it.high), color: RISK_COLOR.High },
            { label: 'Moderate', value: fmtPct(it.moderate), color: RISK_COLOR.Moderate },
            ...(it.extra ?? []),
          ],
        };
        // track is (100% − label room); each % point is 1/100 of it
        const scale = (p: number) => `calc((100% - 52px) * ${p / 100})`;
        return (
          <button
            key={it.id}
            role="listitem"
            className={`bar-row${selectedId === it.id ? ' selected' : ''}`}
            onClick={() => onSelect?.(it.id)}
            onMouseEnter={e => show(e.currentTarget, content)}
            onMouseLeave={hide}
            onFocus={e => show(e.currentTarget, content)}
            onBlur={hide}
            aria-label={`${it.label}: High ${fmtPct(it.high)}, Moderate ${fmtPct(it.moderate)}`}
          >
            <span className="name">{it.label}</span>
            <span className="bar-track">
              <span className="bar-stack" style={{ width: scale(it.high + (it.moderate >= 0.5 ? it.moderate : 0)) }}>
                <span className={`bar-seg${it.moderate < 0.5 ? ' end' : ''}`} style={{ flex: `${it.high} 0 0` }} data-c="high" />
                {it.moderate >= 0.5 && <span className="bar-seg end" style={{ flex: `${it.moderate} 0 0` }} data-c="mod" />}
              </span>
              <span className="bar-value">{fmtPct(it.high, 0)}</span>
            </span>
          </button>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
};
