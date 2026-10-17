// Ginkgo Command Center — exports for a drawn area: GeoJSON and a PDF planning brief.
// Both carry only computed values plus their sources and the method caveats.

import type { AreaReport, Ring } from '../data/analysis';
import { classOf } from '../data/analysis';
import { fmtHa, fmtKm2, fmtPct, fmtPopEstimate, RISK_RGB } from '../data/format';
import { modelName } from '../copilot/models';
import type { Grid, ModelSpec, Scenario, ValidationFile } from '../data/types';

export const SOURCES = [
  'Terrain: Copernicus GLO-30 DEM (ESA / Airbus), 1 arc-second, aggregated to 3 arc-seconds (~92 m).',
  'Rivers, canals, daerah boundaries, place names: OpenStreetMap contributors via Overture Maps 2026-09-23.1 (ODbL).',
  'Observed surface water 1984–2021: JRC Global Surface Water v1.4 (EC JRC / Google).',
  'Land cover: ESA WorldCover 2021 v200 (10 m).',
  'Population: DOSM Census 2020 district totals; 30 m distribution from Meta / CIESIN High Resolution Settlement Layer.',
];

export const CAVEATS = [
  'Susceptibility shows WHERE riverine flooding is more likely. It is not a forecast of WHEN, and not a hydraulic simulation (no depths or return periods).',
  'Model weights are illustrative, not calibrated against official flood records.',
  'Scenario classes come from a rule table; the Extreme case (120 mm/hr) is a hypothetical stress test.',
  'Population figures are estimates. Early screening only — this does not decide planning permission.',
];

export function triggerDownload(content: Blob | string, filename: string, mime = 'application/json'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type: mime }) : content;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 200);
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;

export function areaGeoJSON(rings: Ring[], report: AreaReport, model: ModelSpec, label: string) {
  const closed = rings.map(r => {
    const ring = r.map(([x, y]) => [round(x, 6), round(y, 6)]);
    const [f, l] = [ring[0], ring[ring.length - 1]];
    if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f);
    return ring;
  });
  const scenarios = Object.fromEntries(model.scenarios.map(sc => {
    const s = report.scenarios[sc.key];
    return [sc.key, {
      rain: sc.rain, high_km2: round(s.high_km2), moderate_km2: round(s.moderate_km2), low_km2: round(s.low_km2),
      high_pct: round(s.high_pct, 1), moderate_pct: round(s.moderate_pct, 1),
      high_risk_zones: s.zones, population_in_high_estimate: Math.round(s.pop_high),
    }];
  }));
  return {
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: closed },
      properties: {
        name: label,
        generated: new Date().toISOString(),
        polygon_km2: round(report.polygon_km2, 3),
        analysed_land_km2: round(report.land_km2, 3),
        outside_selangor_km2: round(report.outside_km2 + report.federal_km2, 3),
        daerah: report.daerah.map(d => ({ name: d.name, km2: round(d.km2, 2) })),
        mean_score: round(report.score_mean, 3),
        scenarios,
        population_estimate: Math.round(report.population),
        built_up_pct: round(report.built_pct, 1),
        river_canal_km: round(report.river_km, 2),
        elevation_m: report.detail ? [report.detail.elev_min, report.detail.elev_max] : null,
        hand_median_m: report.detail ? round(report.detail.hand_median, 1) : null,
        screened_candidate_ha: report.detail ? round(report.detail.candidate_km2 * 100, 1) : null,
        why_this_score: report.detail?.why.map(w => ({ term: w.label, weight: w.weight, mean_0_1: round(w.mean, 3), contribution: round(w.contribution, 3), input: w.input })) ?? null,
        model: `${model.name} (${model.weights_status})`,
        sources: SOURCES,
        caveats: CAVEATS,
      },
    }],
  };
}

/** Class raster clipped to the polygon's bounding box, with the outline drawn on top. */
function miniMap(grid: Grid, rings: Ring[], sc: Scenario, px = 520): HTMLCanvasElement {
  const { x0, y1, res, width, height } = grid.meta;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const r of rings) for (const [x, y] of r) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const padX = (maxX - minX) * 0.12 + res, padY = (maxY - minY) * 0.12 + res;
  minX -= padX; maxX += padX; minY -= padY; maxY += padY;
  const c0 = Math.max(0, Math.floor((minX - x0) / res)), c1 = Math.min(width - 1, Math.ceil((maxX - x0) / res));
  const r0 = Math.max(0, Math.floor((y1 - maxY) / res)), r1 = Math.min(height - 1, Math.ceil((y1 - minY) / res));
  const w = c1 - c0 + 1, h = r1 - r0 + 1;
  const src = document.createElement('canvas');
  src.width = w; src.height = h;
  const ctx = src.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const i = (r0 + r) * width + (c0 + c), o = (r * w + c) * 4;
    const dz = grid.daerah[i];
    let rgb: [number, number, number] = [236, 238, 237];
    if (dz >= 1 && dz <= 9) {
      const k = classOf(grid.score[i], sc);
      rgb = k === 3 ? RISK_RGB.High : k === 2 ? RISK_RGB.Moderate : k === 1 ? [190, 214, 243] : [160, 196, 230];
    } else if (dz === 10) rgb = [214, 214, 214];
    img.data.set([...rgb, 255], o);
  }
  ctx.putImageData(img, 0, 0);
  const scale = px / Math.max(w, h);
  const out = document.createElement('canvas');
  out.width = Math.round(w * scale); out.height = Math.round(h * scale);
  const o = out.getContext('2d')!;
  o.imageSmoothingEnabled = false;
  o.drawImage(src, 0, 0, out.width, out.height);
  o.strokeStyle = '#111111'; o.lineWidth = 2.5; o.setLineDash([]);
  o.beginPath();
  for (const ring of rings) ring.forEach(([x, y], k) => {
    const X = ((x - (x0 + c0 * res)) / res) * scale, Y = ((y1 - r0 * res - y) / res) * scale;
    if (k) o.lineTo(X, Y); else o.moveTo(X, Y);
  });
  o.closePath(); o.stroke();
  return out;
}

/** The Ginkgo logo (public/logo.svg) as a PNG data URL for the PDF header, or null if it cannot load. */
async function logoPng(px = 160): Promise<string | null> {
  try {
    const svg = await (await fetch(`${import.meta.env.BASE_URL}logo.svg`)).text();
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
    await img.decode();
    const c = document.createElement('canvas');
    c.width = c.height = px;
    c.getContext('2d')!.drawImage(img, 0, 0, px, px);
    URL.revokeObjectURL(img.src);
    return c.toDataURL('image/png');
  } catch {
    return null;
  }
}

export async function downloadBrief(opts: {
  grid: Grid; rings: Ring[]; report: AreaReport; model: ModelSpec; scenario: Scenario;
  validation: ValidationFile; label: string;
  /** optional AI-drafted summary, printed with its figure check */
  aiBrief?: { text: string; grounded: number; total: number; model: string | null } | null;
}): Promise<void> {
  const [{ jsPDF }, logo] = await Promise.all([import('jspdf'), logoPng()]);
  const { grid, rings, report, model, scenario, validation, label, aiBrief } = opts;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const M = 14;
  let y = 0;

  const ink = () => doc.setTextColor(17, 17, 17);
  const muted = () => doc.setTextColor(110, 110, 110);
  const h2 = (t: string) => {
    if (y > 262) { doc.addPage(); y = 18; }
    y += 4; ink(); doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); doc.text(t, M, y); y += 5;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
  };
  const para = (t: string, width = W - 2 * M) => {
    const lines = doc.splitTextToSize(t, width);
    doc.text(lines, M, y); y += lines.length * 3.9 + 1;
  };
  const row = (cells: string[], xs: number[], bold = false) => {
    if (y > 280) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    cells.forEach((c, i) => doc.text(c, xs[i], y));
    y += 4.6;
  };

  // header
  doc.setFillColor(8, 160, 69); doc.rect(0, 0, W, 3, 'F');
  const tx = logo ? M + 14 : M;
  if (logo) doc.addImage(logo, 'PNG', M, 6, 12, 12);
  y = 13; ink(); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
  doc.text('Flood susceptibility planning brief', tx, y);
  y += 6; doc.setFont('helvetica', 'normal'); doc.setFontSize(9); muted();
  doc.text(`GINKGO · Selangor · ${label} · generated ${new Date().toLocaleString('en-GB')}`, tx, y);
  y += 4;
  doc.text(`Map shows the ${scenario.label} scenario (${scenario.rain}). Screening only — not a planning decision.`, M, y);
  y += 3;

  // location + mini-map
  const map = miniMap(grid, rings, scenario);
  const mapW = 78, mapH = (map.height / map.width) * mapW;
  const mapTop = y + 3;
  doc.addImage(map.toDataURL('image/png'), 'PNG', W - M - mapW, mapTop, mapW, mapH);
  const legendY = mapTop + mapH + 4;
  ([['High', RISK_RGB.High], ['Moderate', RISK_RGB.Moderate], ['Low', [190, 214, 243]]] as [string, number[]][]).forEach(([n, c], i) => {
    const lx = W - M - mapW + i * 26;
    doc.setFillColor(c[0], c[1], c[2]); doc.rect(lx, legendY - 2.6, 3, 3, 'F');
    ink(); doc.setFontSize(7.5); doc.text(n, lx + 4.2, legendY);
  });

  const leftW = W - 2 * M - mapW - 6;
  h2('1. Area');
  const cen = rings[0].reduce((a, p) => [a[0] + p[0] / rings[0].length, a[1] + p[1] / rings[0].length], [0, 0]);
  [
    ['Centre', `${cen[1].toFixed(4)}°N, ${cen[0].toFixed(4)}°E`],
    ['Drawn area', `${fmtKm2(report.polygon_km2)} (${fmtHa(report.polygon_km2)})`],
    ['Selangor land analysed', fmtKm2(report.land_km2)],
    ['Outside scope', fmtKm2(report.outside_km2 + report.federal_km2)],
    ['Daerah', report.daerah.map(d => `${d.name} ${fmtKm2(d.km2)}`).join(', ') || '—'],
    ['Population (estimate)', fmtPopEstimate(report.population)],
    ['Built-up (2021)', fmtPct(report.built_pct)],
    ['Rivers & canals inside', `${report.river_km.toFixed(1)} km`],
    ['Elevation range', report.detail ? `${report.detail.elev_min}–${report.detail.elev_max} m` : '—'],
    ['Median height above drainage', report.detail ? `${report.detail.hand_median.toFixed(1)} m` : '—'],
  ].forEach(([k, v]) => {
    muted(); doc.text(k, M, y); ink();
    const lines = doc.splitTextToSize(v, leftW - 46);
    doc.text(lines, M + 46, y); y += lines.length * 4.2;
  });
  y = Math.max(y, legendY + 2);

  h2('2. Susceptibility by rain scenario');
  const xs = [M, M + 46, M + 92, M + 124, M + 152, M + 166];
  row(['Scenario', 'Rain (label)', 'High', 'Moderate', 'Zones', 'People in High'], xs, true);
  for (const sc of model.scenarios) {
    const s = report.scenarios[sc.key];
    row([sc.label, sc.rain.replace(' (hypothetical stress scenario)', ' (hypoth.)').replace(' (scenario)', ''),
      `${fmtKm2(s.high_km2)} · ${fmtPct(s.high_pct)}`, fmtPct(s.moderate_pct), String(s.zones), fmtPopEstimate(s.pop_high)], xs);
  }
  muted(); para(`Zones are connected High areas of at least ${model.zone_min_km2} km². Heavier scenarios lower the class thresholds (rule table), so zones can merge.`);

  if (report.detail) {
    h2('3. Why this score');
    ink(); para(`Mean score ${report.score_mean.toFixed(2)} (High from ${scenario.high.toFixed(2)}, Moderate from ${scenario.moderate.toFixed(2)} in this scenario). Each input is mapped to 0–1, weighted, and summed. Weights are ${model.weights_status}.`);
    const wx = [M, M + 62, M + 78, M + 98];
    row(['Input', 'Weight', 'Adds', 'Measured here'], wx, true);
    for (const w of report.detail.why) row([w.label, w.weight.toFixed(2), w.contribution.toFixed(3), w.input], wx);

    h2('4. Land cover and development screen');
    const lc = report.detail.landcover;
    ink(); para(`Built-up ${fmtPct(lc.built * 100)} · Tree cover ${fmtPct(lc.tree * 100)} · Cropland ${fmtPct(lc.crop * 100)} · Water & wetland ${fmtPct(lc.water * 100)} · Other ${fmtPct(lc.other * 100)} (ESA WorldCover 2021).`);
    para(`Screened candidate land: ${fmtHa(report.detail.candidate_km2)} — Low susceptibility (Normal), slope < 12°, < 20% built-up, not water, not forest-dominated. Zoning, land status and an engineer's flood study still apply.`);
  }

  h2('5. How the model was checked');
  const floods = validation.sites.filter(v => v.kind === 'reported_flood' && !v.outside_scope);
  const ctrls = validation.sites.filter(v => v.kind === 'hilly_control');
  ink(); para(`${floods.filter(v => v.pass).length} of ${floods.length} places reported flooded in Dec 2021 score High at the point (Normal scenario); ${ctrls.filter(v => v.pass).length} of ${ctrls.length} DEM-selected hilly controls score Low. A sanity check, not an accuracy measure.`);

  if (aiBrief) {
    h2('6. AI-drafted summary');
    muted();
    para(`Drafted by ${modelName(aiBrief.model)} from this area's computed results. ${aiBrief.total
      ? `${aiBrief.grounded} of ${aiBrief.total} figures were traced to the computed results by the app's check.`
      : 'It quotes no figures.'} Review before sharing.`);
    ink();
    for (const block of aiBrief.text.split(/\n+/)) {
      const line = block.replace(/\*\*(.+?)\*\*/g, '$1').trim();
      if (!line) continue;
      if (/^#+\s+/.test(line)) {
        doc.setFont('helvetica', 'bold'); para(line.replace(/^#+\s+/, '')); doc.setFont('helvetica', 'normal');
      } else para(line.replace(/^\s*[-*•]\s+/, '• '));
      if (y > 280) { doc.addPage(); y = 18; }
    }
  }

  h2('Limitations');
  muted(); CAVEATS.forEach(c => para(`• ${c}`));
  h2('Data sources');
  muted(); SOURCES.forEach(s => para(`• ${s}`));

  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p); doc.setFontSize(7); muted();
    doc.text(`Ginkgo command center · page ${p} of ${pages}`, M, 292);
  }
  doc.save(`ginkgo-brief-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.pdf`);
}
