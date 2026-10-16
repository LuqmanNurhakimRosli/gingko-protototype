// Ginkgo Command Center — copilot explainer.
// Reads computed outputs (area reports, daerah stats, validation) and puts them
// into plain language. It never creates, adjusts or estimates a number itself:
// every figure in an answer is copied from an object passed in here.

import type { AreaReport, CellInfo } from '../data/analysis';
import { CLASS_NAME } from '../data/analysis';
import { fmtHa, fmtKm2, fmtPct, fmtPopEstimate, fmtInt, fmtCoord } from '../data/format';
import type { ModelSpec, Scenario, StatsFile, ValidationFile } from '../data/types';

export type Intent = 'summary' | 'why' | 'scenario' | 'people' | 'build' | 'validate' | 'limits' | 'compare';

export interface Evidence { label: string; value: string; source?: string }
export interface Answer { intent: Intent; title: string; text: string[]; evidence: Evidence[] }

export interface Subject {
  kind: 'state' | 'daerah' | 'area' | 'cell';
  label: string;
  report?: AreaReport | null;
  cell?: CellInfo;
}

export interface CopilotContext {
  subject: Subject;
  scenario: Scenario;
  model: ModelSpec;
  stats: StatsFile;
  validation: ValidationFile;
}

export const SUGGESTIONS: { intent: Intent; label: string }[] = [
  { intent: 'why', label: 'Why is this area flagged?' },
  { intent: 'scenario', label: 'What changes in heavier rain?' },
  { intent: 'people', label: 'How many people are exposed?' },
  { intent: 'build', label: 'Where could development go?' },
  { intent: 'compare', label: 'Which daerah rank highest?' },
  { intent: 'validate', label: 'How was this checked?' },
  { intent: 'limits', label: 'What can’t this tell me?' },
];

const RULES: [Intent, RegExp][] = [
  ['limits', /\b(limit|caveat|can'?t|cannot|forecast|predict|when will|tomorrow|depth|hydraulic)\b/i],
  ['validate', /\b(valid|accura|trust|proof|test|check|verify|2021|evidence)\b/i],
  ['scenario', /\b(extreme|heavy|rain|scenario|storm|hujan|mm)\b/i],
  ['people', /\b(people|population|resident|exposed|penduduk|household)\b/i],
  ['build', /\b(build|develop|safe|suitab|site|bina|pembangunan|construct|invest)\b/i],
  ['compare', /\b(compare|rank|worst|best|which daerah|district|most)\b/i],
  ['why', /\b(why|reason|explain|cause|because|kenapa|mengapa|score|high)\b/i],
];

export function detectIntent(q: string): Intent {
  for (const [intent, re] of RULES) if (re.test(q)) return intent;
  return 'summary';
}

const SRC = {
  model: 'Ginkgo Stage 1 overlay (pipeline/03_model.py)',
  dosm: 'DOSM Census 2020 + Meta HRSL distribution',
  wc: 'ESA WorldCover 2021',
  osm: 'OpenStreetMap via Overture Maps',
  dem: 'Copernicus GLO-30 DEM',
  gsw: 'JRC Global Surface Water 1984–2021',
};

function cellAnswer(ctx: CopilotContext, intent: Intent): Answer {
  const c = ctx.subject.cell!;
  const sc = ctx.scenario;
  const cls = CLASS_NAME[c.cls[sc.key]];
  const ev: Evidence[] = [
    { label: 'Location', value: fmtCoord(c.lonlat) },
    { label: `Class (${sc.label})`, value: String(cls), source: SRC.model },
  ];
  if (c.score !== null) ev.push({ label: 'Susceptibility score', value: c.score.toFixed(2), source: SRC.model });
  if (c.hand !== undefined) {
    ev.push({ label: 'Height above drainage', value: `${c.hand.toFixed(1)} m`, source: SRC.dem });
    ev.push({ label: 'Distance to river/canal', value: `${fmtInt(c.river_m!)} m`, source: SRC.osm });
    ev.push({ label: 'Slope', value: `${c.slope!.toFixed(1)}°`, source: SRC.dem });
    ev.push({ label: 'Elevation', value: `${c.elev} m`, source: SRC.dem });
  }
  ev.push({ label: 'Seen as water 1984–2021', value: `${c.hist}% of cell`, source: SRC.gsw });
  const text: string[] = [];
  if (c.federal) {
    text.push('This cell is in a federal territory (Kuala Lumpur or Putrajaya), outside the Selangor scope. It is shown for context only and is excluded from every Selangor total.');
  } else if (c.score === null) {
    text.push('This cell is permanent water (a river, lake or pond), so it has no land susceptibility class.');
  } else if (c.terms) {
    const parts = ctx.model.terms
      .map(t => ({ t, v: c.terms![t.key] * t.weight }))
      .sort((a, b) => b.v - a.v);
    text.push(`Under the ${sc.label} scenario this ~92 m cell is **${cls}** (score ${c.score.toFixed(2)}; High starts at ${sc.high.toFixed(2)}, Moderate at ${sc.moderate.toFixed(2)}).`);
    text.push(`The biggest contributions are ${parts[0].t.label.toLowerCase()} (${parts[0].v.toFixed(2)} of the score) and ${parts[1].t.label.toLowerCase()} (${parts[1].v.toFixed(2)}).`);
  } else {
    text.push(`Under the ${sc.label} scenario this cell is **${cls}** (score ${c.score.toFixed(2)}). Terrain details are still loading.`);
  }
  if (intent === 'limits') text.push(...limitsText());
  return { intent, title: `Map cell · ${c.daerah ?? 'outside Selangor'}`, text, evidence: ev };
}

function limitsText(): string[] {
  return [
    'This is **susceptibility** — where riverine flooding is more likely — not a forecast of when a flood will happen.',
    'It is not a hydraulic simulation: there are no water depths, flow speeds or return periods.',
    'Weights are illustrative, not fitted to flood records. A learned (Stage 2) model needs official JPS/DID flood extents, which this build does not have.',
    'The DEM is a surface model (it includes buildings and trees); the pipeline takes a low value per cell to reduce this, but some urban and forest bias remains.',
    'Population figures are estimates: HRSL’s 30 m distribution scaled to DOSM 2020 district totals.',
    'It supports early screening only. It does not decide planning permission.',
  ];
}

export function answer(ctx: CopilotContext, intent: Intent): Answer {
  const { subject: s, scenario: sc, stats, model, validation } = ctx;
  if (s.kind === 'cell' && s.cell) return cellAnswer(ctx, intent);
  const r = s.report;
  const cur = r?.scenarios[sc.key];
  const title = s.label;

  switch (intent) {
    case 'why': {
      if (!r || !cur) return { intent, title, text: ['Pick a daerah or draw an area first.'], evidence: [] };
      if (!r.detail) return { intent, title, text: ['The terrain layers are still loading — try again in a moment.'], evidence: [] };
      const parts = [...r.detail.why].sort((a, b) => b.contribution - a.contribution);
      return {
        intent, title,
        text: [
          `Under the ${sc.label} scenario, ${fmtPct(cur.high_pct)} of the land here is High and ${fmtPct(cur.moderate_pct)} is Moderate.`,
          `The average score is ${r.score_mean.toFixed(2)}. The largest contributions come from ${parts[0].label.toLowerCase()} (${parts[0].input}) and ${parts[1].label.toLowerCase()} (${parts[1].input}).`,
          'Each input is mapped to 0–1, multiplied by its weight and summed. The weights are illustrative, not calibrated.',
        ],
        evidence: parts.map(p => ({ label: `${p.label} × ${p.weight}`, value: `${p.contribution.toFixed(3)} · ${p.input}`, source: p.key === 'prox' ? SRC.osm : p.key === 'hist' ? SRC.gsw : SRC.dem })),
      };
    }
    case 'scenario': {
      if (!r) return { intent, title, text: ['Pick a daerah or draw an area first.'], evidence: [] };
      const ev = model.scenarios.map(x => ({
        label: `${x.label} · ${x.rain}`,
        value: `High ${fmtKm2(r.scenarios[x.key].high_km2)} (${fmtPct(r.scenarios[x.key].high_pct)})`,
        source: 'Scenario rule table (model.json)',
      }));
      const n = r.scenarios.normal, e = r.scenarios.extreme;
      return {
        intent, title,
        text: [
          `High-susceptibility land grows from ${fmtKm2(n.high_km2)} under Normal to ${fmtKm2(e.high_km2)} under Extreme.`,
          'Scenarios are a rule table: heavier rain lowers the score needed for each class (by 0.05 for Heavy, 0.10 for Extreme). This is not a hydraulic simulation, and the 120 mm/hr Extreme case is a hypothetical stress test, not an observed event.',
          'High-risk zone counts can fall as rain increases, because separate zones merge into larger ones.',
        ],
        evidence: ev,
      };
    }
    case 'people': {
      if (!r || !cur) return { intent, title, text: ['Pick a daerah or draw an area first.'], evidence: [] };
      return {
        intent, title,
        text: [
          `An estimated ${fmtPopEstimate(r.population)} people live in this area; ${fmtPopEstimate(cur.pop_high)} of them in High-susceptibility cells and ${fmtPopEstimate(cur.pop_moderate)} in Moderate (${sc.label} scenario).`,
          'These are estimates: Meta’s 30 m HRSL population map gives the spatial pattern, scaled so each daerah matches its DOSM Census 2020 total. Finer census units would give a better figure.',
        ],
        evidence: [
          { label: 'Population (estimate)', value: fmtPopEstimate(r.population), source: SRC.dosm },
          { label: 'In High cells', value: fmtPopEstimate(cur.pop_high), source: SRC.dosm },
          { label: 'In Moderate cells', value: fmtPopEstimate(cur.pop_moderate), source: SRC.dosm },
        ],
      };
    }
    case 'build': {
      if (!r || !cur) return { intent, title, text: ['Pick a daerah or draw an area first.'], evidence: [] };
      const cand = r.detail?.candidate_km2;
      return {
        intent, title,
        text: [
          cand !== undefined
            ? `${fmtHa(cand)} of land here passes a first screen for development: Low susceptibility (Normal scenario), slope under 12°, under 20% built-up, not water, and not forest-dominated.`
            : 'Terrain layers are still loading, so the development screen is not ready yet.',
          `${fmtKm2(r.built_km2)} of existing built-up land sits here, and ${fmtPct(r.built_pct)} of the area is built-up (ESA WorldCover 2021).`,
          'This is early screening only. Zoning, land status, forest reserves, utilities and an engineer’s flood study still apply — the app does not decide permits.',
        ],
        evidence: [
          { label: 'Screened candidate land', value: cand !== undefined ? fmtHa(cand) : '—', source: `${SRC.model}; ${SRC.wc}` },
          { label: 'Built-up area', value: fmtKm2(r.built_km2), source: SRC.wc },
          { label: `High land (${sc.label})`, value: fmtKm2(cur.high_km2), source: SRC.model },
        ],
      };
    }
    case 'compare': {
      const ranked = [...stats.daerah].sort((a, b) => b.scenarios[sc.key].high_pct - a.scenarios[sc.key].high_pct);
      return {
        intent, title: 'Selangor · daerah ranking',
        text: [
          `By share of land in the High class (${sc.label}), ${ranked[0].name} ranks first (${fmtPct(ranked[0].scenarios[sc.key].high_pct)}) and ${ranked[ranked.length - 1].name} last (${fmtPct(ranked[ranked.length - 1].scenarios[sc.key].high_pct)}).`,
          'Low-lying coastal daerah rank high because most of their land is flat and only a few metres above drainage. Hilly inland daerah rank low overall but still have High strips along their river valleys.',
        ],
        evidence: ranked.map(d => ({ label: d.name, value: `${fmtPct(d.scenarios[sc.key].high_pct)} High · ${fmtPopEstimate(d.scenarios[sc.key].pop_high)} people`, source: SRC.model })),
      };
    }
    case 'validate': {
      const floods = validation.sites.filter(v => v.kind === 'reported_flood' && !v.outside_scope);
      const passed = floods.filter(v => v.pass).length;
      const controls = validation.sites.filter(v => v.kind === 'hilly_control');
      const misses = floods.filter(v => !v.pass);
      const missClasses = [...new Set(misses.map(v => v.scenarios.normal.point))].join(' or ');
      const nearHigh = misses.filter(v => (v.scenarios.normal.high_share_500m ?? 0) > 0).length;
      const missText = misses.length
        ? ` The other ${misses.length} come out ${missClasses}; ${nearHigh} of them have High ground within ${validation.radius_m} m.`
        : '';
      return {
        intent, title: 'Validation gate',
        text: [
          `${passed} of ${floods.length} places reported flooded in December 2021 come out High at the point under the Normal scenario.${missText}`,
          `${controls.filter(c => c.pass).length} of ${controls.length} hilly control sites, chosen from the DEM by slope rather than by assumption, come out Low.`,
          'Site names come from news and fire-department reports; coordinates are matched to OpenStreetMap names, not typed by hand. This is a sanity check, not an accuracy score — official JPS/DID flood extents are needed for that.',
        ],
        evidence: validation.sites.map(v => ({
          label: v.name,
          value: `${v.scenarios.normal.point} (expected ${v.expect})${v.pass ? ' ✓' : ' ✗'}${v.outside_scope ? ' · outside scope' : ''}`,
          source: v.sources[0],
        })),
      };
    }
    case 'limits':
      return { intent, title: 'What this does not tell you', text: limitsText(), evidence: [] };
    default: {
      if (!r || !cur) return { intent, title, text: ['Pick a daerah on the map or draw an area to get started.'], evidence: [] };
      return {
        intent, title,
        text: [
          `${title}: ${fmtKm2(r.land_km2)} of land analysed. Under the ${sc.label} scenario ${fmtPct(cur.high_pct)} is High and ${fmtPct(cur.moderate_pct)} Moderate, in ${cur.zones} High-risk zone${cur.zones === 1 ? '' : 's'} of at least ${model.zone_min_km2} km².`,
          `An estimated ${fmtPopEstimate(r.population)} people live here and ${fmtPct(r.built_pct)} of the area is built-up.`,
        ],
        evidence: [
          { label: 'Land analysed', value: fmtKm2(r.land_km2), source: SRC.model },
          { label: 'High / Moderate', value: `${fmtPct(cur.high_pct)} / ${fmtPct(cur.moderate_pct)}`, source: SRC.model },
          { label: 'Mapped river & canal length', value: `${r.river_km.toFixed(1)} km`, source: SRC.osm },
        ],
      };
    }
  }
}
