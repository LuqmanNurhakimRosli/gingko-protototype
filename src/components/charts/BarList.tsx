// Single-series horizontal bar list (one hue for every bar; the title names the series).
// Value at the bar tip, hover/focus tooltip, rows are buttons so they are keyboard-reachable.

import type { FC } from 'react';
import { Tooltip } from './Tooltip';
import { useTooltip, type TipContent } from './useTooltip';

export interface BarItem {
  id: number | string;
  label: string;
  value: number;
  display: string;
  tip?: TipContent;
}

interface Props {
  items: BarItem[];
  color: string;
  selectedId?: number | string | null;
  onSelect?: (id: number | string) => void;
  ariaLabel: string;
}

export const BarList: FC<Props> = ({ items, color, selectedId, onSelect, ariaLabel }) => {
  const { tip, show, hide } = useTooltip();
  const max = Math.max(...items.map(i => i.value), 1);
  return (
    <div className={`bars${selectedId != null ? ' dim' : ''}`} role="list" aria-label={ariaLabel}>
      {items.map(it => {
        const content = it.tip ?? { title: it.label, rows: [{ label: '', value: it.display, color }] };
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
            aria-label={`${it.label}: ${it.display}`}
          >
            <span className="name">{it.label}</span>
            <span className="bar-track">
              <span className="bar-fill" style={{ width: `calc((100% - 56px) * ${it.value / max})`, background: color }} />
              <span className="bar-value">{it.display}</span>
            </span>
          </button>
        );
      })}
      <Tooltip tip={tip} />
    </div>
  );
};
