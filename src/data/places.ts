// Name search over the Overture gazetteer (shared by the search box and the copilot).

import type { Place } from './types';

export function searchPlaces(places: Place[], query: string, limit = 12): Place[] {
  const s = query.trim().toLowerCase();
  if (s.length < 2) return [];
  const starts: Place[] = [], contains: Place[] = [];
  for (const p of places) {
    const n = p.n.toLowerCase();
    if (n === s || n.startsWith(s)) starts.push(p);
    else if (n.includes(s)) contains.push(p);
  }
  const rank = (p: Place) => (p.n.toLowerCase() === s ? -1 : p.t === 'daerah' ? 0 : p.t === 'locality' ? 1 : 2);
  return [...starts.sort((a, b) => rank(a) - rank(b) || a.n.length - b.n.length), ...contains].slice(0, limit);
}
