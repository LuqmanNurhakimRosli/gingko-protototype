// Place search over the Overture gazetteer (Selangor, Kuala Lumpur, Putrajaya).

import { useMemo, useState, type FC, type ReactNode } from 'react';
import { searchPlaces } from '../../data/places';
import type { Place } from '../../data/types';

const KIND: Record<string, string> = {
  daerah: 'daerah', 'federal territory': 'federal territory', locality: 'town', macrohood: 'area', neighborhood: 'neighbourhood',
};

interface Props {
  places: Place[];
  onPick: (p: Place) => void;
  placeholder?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

export const PlaceSearch: FC<Props> = ({ places, onPick, placeholder = 'Search Selangor', leading, trailing, className }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const results = useMemo(() => searchPlaces(places, q), [q, places]);
  const pick = (p: Place) => { onPick(p); setQ(p.n); setOpen(false); };

  return (
    <div className={`gm-search ${className ?? ''}`} role="combobox" aria-expanded={open && results.length > 0} aria-haspopup="listbox">
      {leading}
      <input
        value={q}
        placeholder={placeholder}
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
      {q && <button className="gm-icon-btn" aria-label="Clear search" onClick={() => setQ('')}>✕</button>}
      {trailing}
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
  );
};
