// Ginkgo Command Center — Selangor riverine flood susceptibility.
// Left: daerah indicators · Centre: map · Right: ranking, drawn-area report, copilot ·
// Bottom: rain scenario and layers. Every number on screen is read from the
// precomputed files in public/data or counted from them for a drawn area.

import { useCallback, useEffect, useMemo, useRef, useState, type FC } from 'react';
import { analyseCells, analysePolygon, type AreaReport, type CellInfo, type Ring } from '../data/analysis';
import { RISK_COLOR, RIVER_COLOR, BUILT_RGB, HISTORY_RGB } from '../data/format';
import { loadCore, loadDetail } from '../data/load';
import type { AppDataBundle, Grid, GridDetail, ModelSpec, Place, ScenarioKey } from '../data/types';
import { areaGeoJSON, downloadBrief, triggerDownload } from '../services/exports';
import type { CopilotContext, Subject } from '../copilot/explainer';
import { TopBar } from '../components/command/TopBar';
import { DaerahPanel } from '../components/command/DaerahPanel';
import { MapView, type Basemap, type DrawMode, type LayerState, type MapFocus } from '../components/command/MapView';
import { RankingCard } from '../components/command/RankingCard';
import { AreaReportCard, type DrawnArea } from '../components/command/AreaReport';
import { Copilot, type AskRequest, type ContextChip } from '../components/command/Copilot';
import { BottomBar } from '../components/command/BottomBar';
import { MethodDrawer } from '../components/command/MethodDrawer';

const rgb = ([r, g, b]: number[]) => `rgb(${r},${g},${b})`;

type AreaShape = Omit<DrawnArea, 'report'>;

// Drawn-area reports, cached per polygon and grid (the grid object changes once,
// when the terrain detail arrives), so adding an area doesn't recount the others.
const reportCache = new WeakMap<Ring[], { grid: Grid; report: AreaReport }>();
function reportFor(grid: Grid, model: ModelSpec, rings: Ring[]): AreaReport {
  const hit = reportCache.get(rings);
  if (hit && hit.grid === grid) return hit.report;
  const report = analysePolygon(grid, model, rings);
  reportCache.set(rings, { grid, report });
  return report;
}

export const CommandCenter: FC = () => {
  const [bundle, setBundle] = useState<AppDataBundle | null>(null);
  const [detail, setDetail] = useState<GridDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('normal');
  const [layers, setLayers] = useState<LayerState>({
    susceptibility: true, showLow: true, history: false, sites: false, rivers: true, boundaries: true, built: false,
  });
  const [basemap, setBasemap] = useState<Basemap>('osm');
  const [selected, setSelected] = useState<number | null>(null);
  const [shapes, setShapes] = useState<AreaShape[]>([]);
  const [activeArea, setActiveArea] = useState<number | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [cell, setCell] = useState<CellInfo | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [methodOpen, setMethodOpen] = useState(false);
  const [askReq, setAskReq] = useState<AskRequest | null>(null);
  const [exporting, setExporting] = useState(false);
  const nextAreaId = useRef(1);

  // ── load: core first (map paints), terrain detail in the background ──────
  useEffect(() => {
    let alive = true;
    loadCore()
      .then(b => {
        if (!alive) return;
        setBundle(b);
        return loadDetail(b.grid.meta).then(d => { if (alive) setDetail(d); });
      })
      .catch(e => { if (alive) setError(String(e?.message ?? e)); });
    return () => { alive = false; };
  }, [attempt]);

  const detailReady = detail !== null;
  const grid: Grid | null = useMemo(
    () => (bundle ? (detail ? { ...bundle.grid, detail } : bundle.grid) : null),
    [bundle, detail],
  );

  const scenario = bundle?.model.scenarios.find(s => s.key === scenarioKey) ?? null;

  // cell lists per daerah (and all of Selangor), built once
  const cellsByDaerah = useMemo(() => {
    if (!bundle) return null;
    const lists: number[][] = Array.from({ length: 10 }, () => []);
    const dz = bundle.grid.daerah;
    for (let i = 0; i < dz.length; i++) if (dz[i] >= 1 && dz[i] <= 9) { lists[dz[i]].push(i); lists[0].push(i); }
    return lists.map(l => Int32Array.from(l));
  }, [bundle]);

  // report for the selected daerah, or all of Selangor (recomputed when terrain detail arrives)
  const subjectReport: AreaReport | null = useMemo(() => {
    if (!bundle || !grid || !cellsByDaerah) return null;
    const id = selected ?? 0;
    const km2 = id ? bundle.stats.daerah.find(d => d.id === id)!.area_km2 : bundle.stats.state.area_km2;
    return analyseCells(grid, bundle.model, cellsByDaerah[id], km2);
  }, [bundle, grid, cellsByDaerah, selected]);

  const areas: DrawnArea[] = useMemo(
    () => (bundle && grid ? shapes.map(a => ({ ...a, report: reportFor(grid, bundle.model, a.rings) })) : []),
    [bundle, grid, shapes],
  );

  const area = areas.find(a => a.id === activeArea) ?? null;
  const daerahName = selected && bundle ? bundle.stats.daerah.find(d => d.id === selected)!.name : null;

  const onDrawn = useCallback((rings: Ring[]) => {
    const id = nextAreaId.current++;
    setShapes(as => [...as.slice(-7), { id, label: `Area ${id}`, rings }]);
    setActiveArea(id);
    setCell(null);
  }, []);

  const onPick = (p: Place) => {
    setFocus({ bounds: [[p.b[1], p.b[0]], [p.b[3], p.b[2]]], label: p.n, point: [p.c[1], p.c[0]], token: Date.now() });
    if (p.t === 'daerah' && bundle) {
      const d = bundle.stats.daerah.find(x => x.name === p.n);
      if (d) setSelected(d.id);
    }
  };

  const subject: Subject = useMemo(() => {
    if (cell) return { kind: 'cell', label: 'Map cell', cell };
    if (area) return { kind: 'area', label: area.label, report: area.report };
    if (daerahName) return { kind: 'daerah', label: daerahName, report: subjectReport };
    return { kind: 'state', label: 'Selangor (all 9 daerah)', report: subjectReport };
  }, [cell, area, daerahName, subjectReport]);

  const getContext = (): CopilotContext => ({
    subject, scenario: scenario!, model: bundle!.model, stats: bundle!.stats, validation: bundle!.validation,
  });

  const chips: ContextChip[] = [];
  if (cell) chips.push({ key: 'cell', label: `Cell ${cell.lonlat[1].toFixed(3)}, ${cell.lonlat[0].toFixed(3)}`, onRemove: () => setCell(null) });
  if (area) chips.push({ key: 'area', label: area.label, onRemove: () => setActiveArea(null) });
  if (daerahName) chips.push({ key: 'daerah', label: daerahName, onRemove: () => setSelected(null) });
  if (!cell && !area && !daerahName) chips.push({ key: 'state', label: 'All Selangor' });
  if (scenario) chips.push({ key: 'sc', label: `${scenario.label} rain` });

  if (error) {
    return (
      <div className="map-loading" style={{ position: 'fixed' }}>
        <div style={{ textAlign: 'center' }}>
          <p>Could not load the data files: {error}</p>
          <button className="btn btn-primary" style={{ marginTop: 10 }} onClick={() => { setError(null); setAttempt(a => a + 1); }}>Retry</button>
        </div>
      </div>
    );
  }
  if (!bundle || !grid || !scenario) {
    return (
      <div className="map-loading" style={{ position: 'fixed' }}>
        <div style={{ textAlign: 'center' }}>
          <div className="brand-logo" style={{ justifyContent: 'center', marginBottom: 10 }}><div className="brand-icon">G</div><span>GINKGO</span></div>
          Loading Selangor layers…
        </div>
      </div>
    );
  }

  const subjectLabel = area ? area.label : daerahName ?? 'All daerah';

  return (
    <div className="cc">
      <TopBar places={bundle.places} scenario={scenario} subjectLabel={subjectLabel}
        onPick={onPick} onOpenMethod={() => setMethodOpen(true)} />

      <div className="cc-main">
        <DaerahPanel stats={bundle.stats} model={bundle.model} scenario={scenario}
          selected={selected} report={subjectReport} onSelect={id => { setSelected(id); setActiveArea(null); }} />

        <main className="cc-map">
          <MapView
            bundle={bundle} grid={grid} scenario={scenario} layers={layers} basemap={basemap}
            selectedDaerah={selected} drawn={area?.rings ?? null} drawMode={drawMode} focus={focus} resetToken={resetToken}
            onSelectDaerah={id => { setSelected(id); setActiveArea(null); }}
            onDrawn={onDrawn} onDrawModeChange={setDrawMode}
            onCellPick={info => { setCell(info); setAskReq({ intent: 'why', label: 'Why is this spot classed this way?', token: Date.now() }); }}
          />
          <div className="map-tools">
            <div className="tool-group" role="group" aria-label="Draw area">
              <button aria-pressed={drawMode === 'rect'} onClick={() => setDrawMode(drawMode === 'rect' ? 'none' : 'rect')}>▭ Rectangle</button>
              <button aria-pressed={drawMode === 'poly'} onClick={() => setDrawMode(drawMode === 'poly' ? 'none' : 'poly')}>⬠ Polygon</button>
              <button disabled={!area} onClick={() => setActiveArea(null)}>Clear</button>
            </div>
            <div className="tool-group">
              <button onClick={() => { setResetToken(t => t + 1); setSelected(null); setActiveArea(null); setCell(null); }}>⟲ Reset view</button>
            </div>
            <div className="tool-group" role="group" aria-label="Basemap">
              {(['osm', 'light', 'none'] as Basemap[]).map(b => (
                <button key={b} aria-pressed={basemap === b} onClick={() => setBasemap(b)}
                  title={b === 'none' ? 'No basemap — works offline' : undefined}>
                  {b === 'osm' ? 'OSM' : b === 'light' ? 'Light' : 'No base'}
                </button>
              ))}
            </div>
          </div>
          {drawMode !== 'none' && (
            <div className="draw-hint" role="status">
              {drawMode === 'rect'
                ? 'Drag on the map to draw a rectangle · Esc to cancel'
                : 'Click to add points · double-click or click the first point to finish · Backspace undoes · Esc cancels'}
            </div>
          )}
          <div className="map-legend" aria-label="Map legend">
            <strong style={{ fontSize: 11 }}>Flood susceptibility · {scenario.label}</strong>
            {layers.susceptibility && (['High', 'Moderate', ...(layers.showLow ? ['Low'] : [])] as ('High' | 'Moderate' | 'Low')[]).map(c => (
              <div className="row" key={c}><i style={{ background: RISK_COLOR[c], opacity: c === 'Low' ? 0.5 : 0.8 }} />{c}</div>
            ))}
            {layers.history && <div className="row"><i style={{ background: rgb(HISTORY_RGB) }} />Seen as water 1984–2021</div>}
            {layers.sites && <div className="row"><i className="dot" />Reported flood, Dec 2021</div>}
            {layers.sites && <div className="row"><i className="dot" style={{ background: '#111' }} />Hilly control</div>}
            {layers.rivers && <div className="row"><i className="line" style={{ background: RIVER_COLOR }} />River / canal (OSM)</div>}
            {layers.built && <div className="row"><i style={{ background: rgb(BUILT_RGB), opacity: 0.6 }} />Built-up 2021</div>}
            {layers.boundaries && <div className="row"><i style={{ background: '#9CA3AF', opacity: 0.6 }} />Federal territory (excluded)</div>}
          </div>
        </main>

        <aside className="cc-panel right" aria-label="Ranking, report and copilot">
          <RankingCard stats={bundle.stats} scenario={scenario} areas={areas}
            selectedDaerah={selected} activeArea={activeArea}
            onSelectDaerah={id => { setSelected(id); setActiveArea(null); }}
            onSelectArea={id => setActiveArea(id)} />
          <AreaReportCard
            area={area} model={bundle.model} scenario={scenario} exporting={exporting}
            onDraw={m => setDrawMode(m)}
            onRemove={() => { setShapes(as => as.filter(a => a.id !== activeArea)); setActiveArea(null); }}
            onAsk={() => setAskReq({ intent: 'why', label: `Why is ${area?.label} flagged?`, token: Date.now() })}
            onExportGeo={() => area && triggerDownload(JSON.stringify(areaGeoJSON(area.rings, area.report, bundle.model, area.label), null, 1),
              `ginkgo-${area.label.toLowerCase().replace(/\s+/g, '-')}.geojson`, 'application/geo+json')}
            onExportPdf={async () => {
              if (!area) return;
              setExporting(true);
              try {
                await downloadBrief({ grid, rings: area.rings, report: area.report, model: bundle.model, scenario, validation: bundle.validation, label: area.label });
              } finally { setExporting(false); }
            }}
          />
          <Copilot chips={chips} getContext={getContext} request={askReq} />
        </aside>
      </div>

      <BottomBar model={bundle.model} scenario={scenarioKey} onScenario={setScenarioKey}
        layers={layers} onLayers={setLayers}
        built={bundle.stats.built} detailReady={detailReady} />

      <MethodDrawer open={methodOpen} onClose={() => setMethodOpen(false)} model={bundle.model}
        validation={bundle.validation} stats={bundle.stats}
        onShowSite={(ll, name) => {
          setLayers(l => ({ ...l, sites: true }));
          setFocus({ bounds: [[ll[1] - 0.01, ll[0] - 0.01], [ll[1] + 0.01, ll[0] + 0.01]], label: name, point: [ll[1], ll[0]], token: Date.now() });
          setMethodOpen(false);
        }} />
    </div>
  );
};
