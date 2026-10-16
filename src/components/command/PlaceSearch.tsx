// Place search over the Overture gazetteer (Selangor, Kuala Lumpur, Putrajaya).
// With `onAsk`, the box doubles as a prompt: a question that isn't a place goes to Ginkgo.

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
  /** offer "Ask Ginkgo" for the typed text (questions, not just place names) */
  onAsk?: (q: string) => void;
}

const QUESTION = /\?|^(what|which|where|why|how|is|are|can|show|compare|find|list|apa|mana|kenapa|bagaimana|berapa|tunjuk)\b/i;

export const PlaceSearch: FC<Props> = ({ places, onPick, placeholder = 'Search Selangor', leading, trailing, className, onAsk }) => {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const found = useMemo(() => searchPlaces(places, q), [q, places]);
  const text = q.trim();
  // a question goes to the top; otherwise the ask row follows the place matches
  const askRow = Boolean(onAsk) && text.length >= 3;
  const askFirst = askRow && (QUESTION.test(text) || found.length === 0 || text.split(/\s+/).length >= 4);
  const results = found;
  const rows = askRow ? results.length + 1 : results.length;
  const askIndex = askRow ? (askFirst ? 0 : results.length) : -1;
  const placeAt = (i: number) => results[askFirst ? i - 1 : i];
  const pick = (p: Place) => { onPick(p); setQ(p.n); setOpen(false); };
  const ask = () => { onAsk?.(text); setQ(''); setOpen(false); };
  const choose = (i: number) => { if (i === askIndex) ask(); else if (placeAt(i)) pick(placeAt(i)); };

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
          if (e.key === 'ArrowDown') { setActive(a => Math.min(a + 1, rows - 1)); e.preventDefault(); }
          if (e.key === 'ArrowUp') { setActive(a => Math.max(a - 1, 0)); e.preventDefault(); }
          if (e.key === 'Enter' && rows) choose(active);
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      {q && <button className="gm-icon-btn" aria-label="Clear search" onClick={() => setQ('')}>✕</button>}
      {trailing}
      {open && rows > 0 && (
        <div className="search-results" role="listbox">
          {Array.from({ length: rows }, (_, i) => {
            if (i === askIndex) {
              return (
                <button key="ask" role="option" aria-selected={i === active} className="ask-row"
                  onMouseDown={e => e.preventDefault()} onClick={ask}>
                  <span><span className="ask-spark" aria-hidden>✦</span> Ask Ginkgo: “{text}”</span>
                  <span className="kind">AI</span>
                </button>
              );
            }
            const p = placeAt(i);
            return (
              <button key={`${p.n}-${p.c.join()}`} role="option" aria-selected={i === active}
                onMouseDown={e => e.preventDefault()} onClick={() => pick(p)}>
                <span><span className="pin-ico" aria-hidden /> {p.n}</span>
                <span className="kind">{KIND[p.t] ?? p.t}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
