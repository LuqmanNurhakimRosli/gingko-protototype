// Shared hover/focus tooltip for the command-center charts.
// Content is rendered as React text nodes (never innerHTML).

import type { FC } from 'react';
import type { TipState } from './useTooltip';

export const Tooltip: FC<{ tip: TipState | null }> = ({ tip }) => {
  if (!tip) return null;
  return (
    <div className="viz-tooltip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="t-title">{tip.title}</div>
      {tip.rows.map(r => (
        <div className="t-row" key={r.label}>
          {r.color && <span className="t-key" style={{ background: r.color }} />}
          <strong>{r.value}</strong>
          <span className="muted">{r.label}</span>
        </div>
      ))}
    </div>
  );
};
