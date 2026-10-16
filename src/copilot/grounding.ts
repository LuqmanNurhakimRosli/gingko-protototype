// Ginkgo Copilot — grounding check.
// Every figure in an answer should be traceable to a tool result (or to the
// question / map context). This finds the figures in the answer and looks for
// each one among the numbers the tools returned, with a compatible unit:
//   "17.4%"  ↔ a *_pct field (or a 0–1 share ×100)
//   "1.5 km" ↔ a *_km field (or a *_m field ÷1000)
//   "4.2 km²"↔ a *_km2 field (or a *_ha field ÷100) …and unitless counts ↔ unitless fields.
// Rounding to the precision the answer shows is allowed. The check flags; it never
// edits the answer. It shows a figure is traceable, not that it is attributed correctly.

export type Unit = '%' | 'share' | 'km2' | 'km' | 'm' | 'ha' | 'deg' | 'mm' | null;
export interface SourceNumber { value: number; unit: Unit }
export interface FoundNumber { raw: string; start: number; end: number; value: number; unit: Unit; grounded: boolean }
export interface GroundingResult { numbers: FoundNumber[]; total: number; grounded: number }

function unitFromKey(key: string): Unit {
  const k = key.toLowerCase();
  if (/pct|percent/.test(k)) return '%';
  if (/share/.test(k)) return 'share';
  if (/km2/.test(k)) return 'km2';
  if (/(^|_)km($|_)/.test(k)) return 'km';
  if (/(^|_)ha($|_)/.test(k)) return 'ha';
  if (/(^|_)m($|_)|radius|metres|meters/.test(k)) return 'm';
  if (/deg|slope/.test(k)) return 'deg';
  return null;
}

/** Unit written right after a figure in text ("17.4%", "1.5 km", "92 m", "4 ha", "3°", "50 mm/hr"). */
export function unitAfter(text: string): Unit {
  if (/^\s?%/.test(text)) return '%';
  if (/^\s?(km²|km2|sq\.? ?km)/.test(text)) return 'km2';
  if (/^\s?km\b/.test(text)) return 'km';
  if (/^\s?mm\b/.test(text)) return 'mm';
  if (/^\s?(m|metres|meters)\b/.test(text)) return 'm';
  if (/^\s?(ha|hectares?)\b/.test(text)) return 'ha';
  if (/^\s?°/.test(text)) return 'deg';
  return null;
}

const NUM_IN_TEXT = /\d[\d,]*(?:\.\d+)?/g;

/** Numbers inside a JSON-like value, with a unit taken from the key name or the text after them. */
export function collectNumbers(value: unknown, out: SourceNumber[] = [], key = ''): SourceNumber[] {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) out.push({ value, unit: unitFromKey(key) });
  } else if (typeof value === 'string') {
    for (const m of value.matchAll(NUM_IN_TEXT)) {
      const v = Number(m[0].replace(/,/g, ''));
      if (Number.isFinite(v)) out.push({ value: v, unit: unitAfter(value.slice(m.index! + m[0].length)) ?? unitFromKey(key) });
    }
  } else if (Array.isArray(value)) value.forEach(v => collectNumbers(v, out, key));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([k, v]) => collectNumbers(v, out, k));
  return out;
}

interface Candidate { raw: string; start: number; end: number; value: number; tol: number; unit: Unit }

/** Figures written in the answer, with the rounding tolerance their precision implies. */
export function extractFigures(text: string): Candidate[] {
  const out: Candidate[] = [];
  const re = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+)(\.\d+)?(?:\s?(K|k|M)\b|\s(million|juta|thousand|ribu)\b)?/g;
  for (const m of text.matchAll(re)) {
    const start = m.index!;
    const end = start + m[0].length;
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    // list markers ("1. ", "2) ") are not figures
    if (/^\s*$/.test(text.slice(lineStart, start)) && /^[.)]\s/.test(text.slice(end, end + 2)) && !m[2]) continue;
    const intPart = m[1].replace(/,/g, '');
    const decimals = m[2] ? m[2].length - 1 : 0;
    const mult = m[3] === 'M' || m[4] === 'million' || m[4] === 'juta' ? 1e6 : m[3] || m[4] === 'thousand' || m[4] === 'ribu' ? 1e3 : 1;
    const value = Number(intPart + (m[2] ?? '')) * mult;
    let unit: number;
    if (decimals > 0) unit = 10 ** -decimals * mult;
    else {
      const tz = intPart.length > 1 ? intPart.length - intPart.replace(/0+$/, '').length : 0;
      unit = 10 ** tz * mult;
    }
    out.push({ raw: m[0], start, end, value, tol: unit / 2 + 1e-9, unit: unitAfter(text.slice(end)) });
  }
  return out;
}

/** (source unit, scale) pairs a figure written with `unit` may come from. */
const COMPATIBLE: Record<string, [Unit, number][]> = {
  '%': [['%', 1], ['share', 100]],
  km2: [['km2', 1], ['ha', 0.01]],
  km: [['km', 1], ['m', 0.001]],
  m: [['m', 1], ['km', 1000]],
  ha: [['ha', 1], ['km2', 100]],
  deg: [['deg', 1]],
  mm: [['mm', 1]],
  null: [[null, 1], ['share', 1]],
};

export function checkGrounding(answer: string, sources: unknown[]): GroundingResult {
  const pool: SourceNumber[] = [];
  for (const s of sources) collectNumbers(s, pool);
  const numbers = extractFigures(answer).map(c => {
    const rules = COMPATIBLE[String(c.unit)];
    const grounded = pool.some(p => rules.some(([u, scale]) => p.unit === u && Math.abs(p.value * scale - c.value) <= c.tol));
    return { raw: c.raw, start: c.start, end: c.end, value: c.value, unit: c.unit, grounded };
  });
  return { numbers, total: numbers.length, grounded: numbers.filter(n => n.grounded).length };
}
