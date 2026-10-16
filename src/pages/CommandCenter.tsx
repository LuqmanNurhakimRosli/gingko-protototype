// Ginkgo Command Center — Selangor riverine flood susceptibility.
// Desktop: daerah indicators · map · ranking, drawn-area report, copilot · scenario bar.
// Phone: full-screen map with a bottom sheet. Every number on screen is read from
// the precomputed files in public/data or counted from them for a drawn area.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  analyseCells, analysePolygon, facilitiesInCells, queryCell, rasterizePolygon, type AreaReport, type CellInfo, type Ring,
} from '../data/analysis';
import { googleAvailable } from '../data/googleTiles';
import { loadCore, loadDetail } from '../data/load';
import type { AppDataBundle, Facility, Grid, GridDetail, ModelSpec, Place, ScenarioKey } from '../data/types';
import { areaGeoJSON, downloadBrief, triggerDownload } from '../services/exports';
import type { CopilotContext, Subject } from '../copilot/explainer';
import type { AgentView } from '../copilot/agentTools';
import { useAgent, type AgentSession } from '../copilot/useAgent';
import { TopBar } from '../components/command/TopBar';
import { DaerahPanel } from '../components/command/DaerahPanel';
import { MapView, type Basemap, type DrawMode, type LayerState, type MapFocus, type MapInspect } from '../components/command/MapView';
import { MapChrome } from '../components/command/MapChrome';
import { RankingCard } from '../components/command/RankingCard';
import { AreaReportCard, type DrawnArea } from '../components/command/AreaReport';
import { Copilot, type AskRequest, type ContextChip } from '../components/command/Copilot';
import { BottomBar, ScenarioPicker } from '../components/command/BottomBar';
import { BottomSheet, type Snap } from '../components/command/BottomSheet';
import { MethodDrawer } from '../components/command/MethodDrawer';
import { useMediaQuery } from '../components/command/useMediaQuery';

type AreaShape = Omit<DrawnArea, 'report' | 'facilities'>;

// Drawn-area reports, cached per polygon and grid (the grid object changes once,
// when the terrain detail arrives), so adding an area doesn't recount the others.
const reportCache = new WeakMap<Ring[], { grid: Grid; report: AreaReport; facilities: Facility[] }>();
function reportFor(grid: Grid, model: ModelSpec, items: Facility[], rings: Ring[]) {
  const hit = reportCache.get(rings);
  if (hit && hit.grid === grid) return hit;
  const entry = {
    grid,
    report: analysePolygon(grid, model, rings),
    facilities: facilitiesInCells(grid.meta, items, rasterizePolygon(grid.meta, rings)),
  };
  reportCache.set(rings, entry);
  return entry;
}

const DEFAULT_LAYERS: LayerState = {
  susceptibility: true, showLow: true, history: false, sites: false, rivers: true, boundaries: true, built: false,
  safe: false, rail: false, hospital: false, clinic: false, school: false, emergency: false,
};

export const CommandCenter: FC = () => {
  const [bundle, setBundle] = useState<AppDataBundle | null>(null);
  const [detail, setDetail] = useState<GridDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [scenarioKey, setScenarioKey] = useState<ScenarioKey>('normal');
  const [layers, setLayers] = useState<LayerState>(DEFAULT_LAYERS);
  const [basemap, setBasemap] = useState<Basemap>('streets');
  const [selected, setSelected] = useState<number | null>(null);
  const [shapes, setShapes] = useState<AreaShape[]>([]);
  const [activeArea, setActiveArea] = useState<number | null>(null);
  const [drawMode, setDrawMode] = useState<DrawMode>('none');
  const [cell, setCell] = useState<CellInfo | null>(null);
  const [focus, setFocus] = useState<MapFocus | null>(null);
  const [inspect, setInspect] = useState<MapInspect | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [methodOpen, setMethodOpen] = useState(false);
  const [askReq, setAskReq] = useState<AskRequest | null>(null);
  const [askFocus, setAskFocus] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [locating, setLocating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [sheetTab, setSheetTab] = useState('overview');
  const [snap, setSnap] = useState<Snap>('peek');
  const nextAreaId = useRef(1);
  const isPhone = useMediaQuery('(max-width: 960px)');

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

  const subjectFacilities = useMemo(
    () => (bundle ? bundle.facilities.items.filter(f => (selected ? f.d === selected : f.d >= 1 && f.d <= 9)) : []),
    [bundle, selected],
  );

  const areas: DrawnArea[] = useMemo(
    () => (bundle && grid ? shapes.map(a => {
      const { report, facilities } = reportFor(grid, bundle.model, bundle.facilities.items, a.rings);
      return { ...a, report, facilities };
    }) : []),
    [bundle, grid, shapes],
  );

  const area = areas.find(a => a.id === activeArea) ?? null;
  const daerahName = selected && bundle ? bundle.stats.daerah.find(d => d.id === selected)!.name : null;

  const addArea = useCallback((rings: Ring[], label?: string) => {
    const id = nextAreaId.current++;
    setShapes(as => [...as.slice(-7), { id, label: label ?? `Area ${id}`, rings }]);
    setActiveArea(id);
    setCell(null);
    return id;
  }, []);

  const onPick = (p: Place) => {
    setFocus({ bounds: [[p.b[1], p.b[0]], [p.b[3], p.b[2]]], label: p.n, point: [p.c[1], p.c[0]], token: Date.now() });
    if (p.t === 'daerah' && bundle) {
      const d = bundle.stats.daerah.find(x => x.name === p.n);
      if (d) setSelected(d.id);
    }
  };

  const openAsk = () => {
    setAskFocus(t => t + 1);
    if (isPhone) { setSheetTab('ask'); setSnap('full'); }
  };

  const locate = () => {
    if (!navigator.geolocation) { setNotice('This browser cannot share its location.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(pos => {
      setLocating(false);
      const { latitude: lat, longitude: lon } = pos.coords;
      if (!bundle || !queryCell(bundle.grid, bundle.model, lon, lat)) {
        setNotice('Your location is outside the Selangor analysis area.');
        return;
      }
      setNotice('Showing your location. It stays on this device unless you ask the copilot about it.');
      setInspect({ lat, lon, title: 'Your location', token: Date.now() });
    }, err => {
      setLocating(false);
      setNotice(err.code === err.PERMISSION_DENIED ? 'Location permission was declined.' : 'Could not get your location.');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  // ── AI agent: tools run here, over the same grid the panels use ─────────
  const view = useRef<AgentView>({ scenario: 'normal', selectedDaerah: null, activeArea: null, lastCell: null });
  const session = useRef<AgentSession | null>(null);
  useLayoutEffect(() => {
    view.current = {
      scenario: scenarioKey,
      selectedDaerah: daerahName,
      activeArea: area ? { label: area.label, rings: area.rings, report: area.report } : null,
      lastCell: cell,
    };
    if (!bundle || !grid || !cellsByDaerah) return;
    session.current = {
      toolCtx: {
        bundle, grid,
        daerahCells: id => cellsByDaerah[id],
        getView: () => view.current,
        actions: {
          showArea: (rings, label) => {
            addArea(rings, label);
            // fly to what the copilot analysed so the user sees where it looked
            const xs = rings[0].map(p => p[0]), ys = rings[0].map(p => p[1]);
            const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
            setFocus({ bounds: [[s, w], [n, e]], label, point: [(s + n) / 2, (w + e) / 2], token: Date.now() });
          },
          showPoint: (lat, lon, label) => setInspect({ lat, lon, title: label, token: Date.now() }),
        },
      },
      context: {
        scenario: scenarioKey,
        selected_daerah: daerahName,
        active_drawn_area: area?.label ?? null,
        last_cell: cell ? { latitude: +cell.lonlat[1].toFixed(4), longitude: +cell.lonlat[0].toFixed(4) } : null,
      },
      extraSources: [bundle.model],
    };
  });
  const agent = useAgent(session);

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
  const selectDaerah = (id: number | null) => {
    setSelected(id);
    setActiveArea(null);
    if (isPhone && id) { setSheetTab('overview'); setSnap('half'); }
  };
  const showFacility = (f: Facility) => {
    setInspect({ lat: f.c[1], lon: f.c[0], title: f.n, token: Date.now() });
    if (isPhone) setSnap('peek');
  };

  const mapBlock = (
    <main className="cc-map">
      <MapView
        bundle={bundle} grid={grid} scenario={scenario} layers={layers} basemap={basemap}
        selectedDaerah={selected} drawn={area?.rings ?? null} drawMode={drawMode} focus={focus} inspect={inspect} resetToken={resetToken}
        onSelectDaerah={selectDaerah}
        onDrawn={rings => { addArea(rings); if (isPhone) { setSheetTab('area'); setSnap('half'); } }}
        onDrawModeChange={setDrawMode}
        onCellPick={info => {
          setCell(info);
          const cls = ['Water', 'Low', 'Moderate', 'High'][info.cls[scenarioKey]] ?? 'unclassified';
          setAskReq({ intent: 'why', label: `Why is the spot at ${info.lonlat[1].toFixed(4)}, ${info.lonlat[0].toFixed(4)} classed ${cls}?`, token: Date.now() });
          if (isPhone) { setSheetTab('ask'); setSnap('half'); }
        }}
        onBasemapError={msg => { setNotice(msg); setBasemap('streets'); }}
      />
      <MapChrome
        places={bundle.places} scenario={scenario} layers={layers} onLayers={setLayers}
        basemap={basemap} onBasemap={setBasemap} googleAvailable={googleAvailable} detailReady={detailReady}
        drawMode={drawMode} onDrawMode={setDrawMode} hasArea={Boolean(area)} onClearArea={() => setActiveArea(null)}
        onPick={onPick} onAsk={openAsk} onLocate={locate} locating={locating}
        onReset={() => { setResetToken(t => t + 1); setSelected(null); setActiveArea(null); setCell(null); }}
        notice={notice} onDismissNotice={() => setNotice(null)}
      />
    </main>
  );

  const daerahPanel = (
    <DaerahPanel stats={bundle.stats} model={bundle.model} scenario={scenario} selected={selected}
      report={subjectReport} facilities={subjectFacilities} onSelect={selectDaerah} onShowFacility={showFacility} />
  );
  const areaPanel = (
    <>
      <RankingCard stats={bundle.stats} scenario={scenario} areas={areas}
        selectedDaerah={selected} activeArea={activeArea}
        onSelectDaerah={selectDaerah}
        onSelectArea={id => setActiveArea(id)} />
      <AreaReportCard
        area={area} model={bundle.model} scenario={scenario} exporting={exporting}
        onDraw={m => { setDrawMode(m); if (isPhone) setSnap('peek'); }}
        onRemove={() => { setShapes(as => as.filter(a => a.id !== activeArea)); setActiveArea(null); }}
        onShowFacility={showFacility}
        onAsk={() => { setAskReq({ intent: 'why', label: `Why is ${area?.label} flagged, and what should a planner check?`, token: Date.now() }); if (isPhone) setSheetTab('ask'); }}
        onExportGeo={() => area && triggerDownload(JSON.stringify(areaGeoJSON(area.rings, area.report, bundle.model, area.label), null, 1),
          `ginkgo-${area.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.geojson`, 'application/geo+json')}
        onExportPdf={async () => {
          if (!area) return;
          setExporting(true);
          try {
            await downloadBrief({ grid, rings: area.rings, report: area.report, model: bundle.model, scenario, validation: bundle.validation, label: area.label });
          } finally { setExporting(false); }
        }}
      />
    </>
  );
  const copilot = <Copilot chips={chips} getContext={getContext} request={askReq} agent={agent} focusToken={askFocus} />;
  const method = (
    <MethodDrawer open={methodOpen} onClose={() => setMethodOpen(false)} model={bundle.model}
      validation={bundle.validation} stats={bundle.stats}
      onShowSite={(ll, name) => {
        setLayers(l => ({ ...l, sites: true }));
        setFocus({ bounds: [[ll[1] - 0.01, ll[0] - 0.01], [ll[1] + 0.01, ll[0] + 0.01]], label: name, point: [ll[1], ll[0]], token: Date.now() });
        setMethodOpen(false);
        if (isPhone) setSnap('peek');
      }} />
  );

  if (isPhone) {
    return (
      <div className="cc phone">
        {mapBlock}
        <BottomSheet
          tabs={[{ key: 'overview', label: daerahName ?? 'Selangor' }, { key: 'area', label: area ? area.label : 'Ranking & area' }, { key: 'ask', label: '✦ Ask' }]}
          active={sheetTab} onTab={setSheetTab} snap={snap} onSnap={setSnap}
          header={(
            <div className="sheet-head-row">
              <ScenarioPicker model={bundle.model} scenario={scenarioKey} onScenario={setScenarioKey} />
              <button className="btn btn-ghost btn-sm" onClick={() => setMethodOpen(true)}>Method</button>
            </div>
          )}
        >
          <div hidden={sheetTab !== 'overview'}>{daerahPanel}</div>
          <div hidden={sheetTab !== 'area'}>{areaPanel}</div>
          <div hidden={sheetTab !== 'ask'}>{copilot}</div>
        </BottomSheet>
        {method}
      </div>
    );
  }

  return (
    <div className="cc">
      <TopBar scenario={scenario} subjectLabel={subjectLabel} onOpenMethod={() => setMethodOpen(true)} />
      <div className="cc-main">
        {daerahPanel}
        {mapBlock}
        <aside className="cc-panel right" aria-label="Ranking, report and copilot">
          {areaPanel}
          {copilot}
        </aside>
      </div>
      <BottomBar model={bundle.model} scenario={scenarioKey} onScenario={setScenarioKey}
        built={bundle.stats.built} detailReady={detailReady} />
      {method}
    </div>
  );
};
