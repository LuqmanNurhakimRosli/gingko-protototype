// Ginkgo Command Center — top bar: brand, context, place search, method link.

import { useMemo, useState, type FC } from 'react';
import type { Place, Scenario } from '../../data/types';

interface Props {
  places: Place[];
  scenario: Scenario;
  subjectLabel: string;
  onPick: (p: Place) => void;
  onOpenMethod: () => void;
}

const KIND: Record<string, string> = {
  daerah: 'daerah', 'federal territory': 'federal territory', locality: 'town', macrohood: 'area', neighborhood: 'neighbourhood',
};

export const TopBar: FC<Props> = ({ places, scenario, subjectLabel, onPick, onOpenMethod }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return [];
    const starts: Place[] = [], contains: Place[] = [];
    for (const p of places) {
      const n = p.n.toLowerCase();
      if (n.startsWith(s)) starts.push(p);
      else if (n.includes(s)) contains.push(p);
      if (starts.length > 12) break;
    }
    const rank = (p: Place) => (p.t === 'daerah' ? 0 : p.t === 'locality' ? 1 : 2);
    return [...starts.sort((a, b) => rank(a) - rank(b)), ...contains].slice(0, 12);
  }, [q, places]);

  const pick = (p: Place) => { onPick(p); setQ(p.n); setOpen(false); };

  return (
    <header className="cc-top">
      <div className="brand-logo" aria-label="Ginkgo">
        <div className="brand-icon">G</div>
        <span>GINKGO</span>
      </div>
      <div className="nav-divider" />
      <div className="cc-context">
        <strong>Selangor</strong><span className="sep">·</span>
        <span>Riverine flood susceptibility</span><span className="sep">·</span>
        <span className="scenario-pill" title={scenario.note}>Scenario: {scenario.label}</span>
        <span className="sep">·</span>
        <span>{subjectLabel}</span>
      </div>
      <div className="cc-top-right">
        <div className="search" role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
          <span className="icon" aria-hidden>⌕</span>
          <input
            value={q}
            placeholder="Search a place in Selangor…"
            aria-label="Search a place"
            onChange={e => { setQ(e.target.value); setOpen(true); setActive(0); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') { setActive(a => Math.min(a + 1, results.length - 1)); e.preventDefault(); }
              if (e.key === 'ArrowUp') { setActive(a => Math.max(a - 1, 0)); e.preventDefault(); }
              if (e.key === 'Enter' && results[active]) pick(results[active]);
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          {open && results.length > 0 && (
            <div className="search-results" role="listbox">
              {results.map((p, i) => (
                <button key={`${p.n}-${p.c.join()}`} role="option" aria-selected={i === active}
                  onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                  <span>{p.n}</span>
                  <span className="kind">{KIND[p.t] ?? p.t}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button className="btn btn-secondary btn-sm" onClick={onOpenMethod}>Method &amp; validation</button>
      </div>
    </header>
  );
};
