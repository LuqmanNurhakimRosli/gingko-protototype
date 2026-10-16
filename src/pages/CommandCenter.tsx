// Ginkgo Command Center — Selangor riverine flood susceptibility.
// Desktop: daerah indicators · map · Insights / Ask Ginkgo tabs · scenario bar.
// Phone: full-screen map with a bottom sheet. Every number on screen is read from
// the precomputed files in public/data or counted from them for a drawn area.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FC } from 'react';
import {
  analyseCells, analysePolygon, facilitiesInCells, findCandidateSites, queryCell, rasterizePolygon,
  type AreaReport, type CandidateSite, type CellInfo, type Ring,
} from '../data/analysis';
import { googleAvailable } from '../data/googleTiles';
import { loadCore, loadDetail } from '../data/load';
import type { AppDataBundle, Facility, Grid, GridDetail, ModelSpec, Place, ScenarioKey } from '../data/types';
import { areaGeoJSON, downloadBrief, triggerDownload } from '../services/exports';
import { detectIntent, type CopilotContext, type Subject } from '../copilot/explainer';
import type { MapLayerName } from '../copilot/agentSpec';
import type { AgentView, ViewChange } from '../copilot/agentTools';
import { useAgent, type AgentSession } from '../copilot/useAgent';
import { TopBar } from '../components/command/TopBar';
import { DaerahPanel } from '../components/command/DaerahPanel';
import {
  MapView, type Basemap, type DrawMode, type LayerState, type MapFocus, type MapInspect, type MapPadding, type SiteSet,
} from '../components/command/MapView';
import { MapChrome } from '../components/command/MapChrome';
import { RankingCard } from '../components/command/RankingCard';
import { AreaReportCard, type AiBrief, type DrawnArea } from '../components/command/AreaReport';
import { SitesCard } from '../components/command/SitesCard';
import { Copilot, type AskRequest, type ContextChip } from '../components/command/Copilot';
import { BottomBar, ScenarioPicker } from '../components/command/BottomBar';
import { BottomSheet, type Snap } from '../components/command/BottomSheet';
import { MethodDrawer } from '../components/command/MethodDrawer';
import { useMediaQuery } from '../components/command/useMediaQuery';

type AreaShape = Omit<DrawnArea, 'report' | 'facilities'>;
type RightTab = 'insights' | 'ask';

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
  susceptibility: true, showLow: false, history: false, sites: false, rivers: false, boundaries: true, built: false,
  safe: false, rail: true, hospital: false, clinic: false, school: false, emergency: false,
};
/** The agent's layer names → the map's layer switches. */
const LAYER_OF: Record<MapLayerName, keyof LayerState> = {
  flood_susceptibility: 'susceptibility', hospitals: 'hospital', clinics: 'clinic', schools: 'school',
  police_and_bomba: 'emergency', rail: 'rail', safe_land: 'safe', water_history: 'history',
  reported_floods_2021: 'sites', built_up: 'built', rivers: 'rivers', daerah_boundaries: 'boundaries',
};
const visibleLayers = (l: LayerState) => (Object.keys(LAYER_OF) as MapLayerName[]).filter(n => l[LAYER_OF[n]]);

// room the floating search, chips and buttons take, so fitted views stay visible
const PAD_DESKTOP: MapPadding = { top: 112, bottom: 28, left: 16, right: 68 };
const PAD_PHONE: MapPadding = { top: 112, bottom: 160, left: 12, right: 12 };

const BRIEF_PROMPT = (label: string) => `Draft a short planning brief for the active drawn area "${label}". Call get_current_view to read it. Use exactly these four headings, each on its own line starting with "## ": Summary, Exposure by scenario, Why it scores this way, What to check next. Two to four sentences or bullets under each, about 170 words in all. Every figure must come from the tool results; name the scenario for each figure.`;

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
  const [rightTab, setRightTab] = useState<RightTab>('insights');
  const [sites, setSites] = useState<SiteSet | null>(null);
  const [briefs, setBriefs] = useState<Record<number, AiBrief>>({});
  const [briefing, setBriefing] = useState<number | null>(null);
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

  const toAsk = () => {
    if (isPhone) { setSheetTab('ask'); setSnap('full'); } else setRightTab('ask');
  };
  const askAbout = (label: string, prompt?: string) => {
    setAskReq({ intent: detectIntent(label), label, prompt, token: Date.now() });
    toAsk();
  };

  const onPick = (p: Place) => {
    setFocus({ bounds: [[p.b[1], p.b[0]], [p.b[3], p.b[2]]], label: p.n, point: [p.c[1], p.c[0]], token: Date.now() });
    if (p.t === 'daerah' && bundle) {
      const d = bundle.stats.daerah.find(x => x.name === p.n);
      if (d) setSelected(d.id);
    }
  };

  const openAsk = () => { setAskFocus(t => t + 1); toAsk(); };

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
      setNotice('Showing your location. It stays on this device unless you ask Ginkgo about it.');
      setInspect({ lat, lon, title: 'Your location', me: true, token: Date.now() });
    }, err => {
      setLocating(false);
      setNotice(err.code === err.PERMISSION_DENIED ? 'Location permission was declined.' : 'Could not get your location.');
    }, { enableHighAccuracy: true, timeout: 10000 });
  };

  /** Run the site screen and show the result (used by the AI tool and the report button). */
  const showSites = useCallback((list: CandidateSite[], label: string, lowUnder: string) => {
    setSites({ list, label, lowUnder, token: Date.now() });
  }, []);

  // ── AI agent: tools run here, over the same grid the panels use ─────────
  const view = useRef<AgentView>({ scenario: 'normal', selectedDaerah: null, activeArea: null, lastCell: null, layers: visibleLayers(DEFAULT_LAYERS) });
  const session = useRef<AgentSession | null>(null);
  useLayoutEffect(() => {
    view.current = {
      scenario: scenarioKey,
      selectedDaerah: daerahName,
      activeArea: area ? { label: area.label, rings: area.rings, report: area.report } : null,
      lastCell: cell,
      layers: visibleLayers(layers),
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
          setView: (c: ViewChange) => {
            const cur = view.current;
            const next: AgentView = { ...cur };
            if (c.scenario) { setScenarioKey(c.scenario); next.scenario = c.scenario; }
            if (c.daerah) {
              const d = c.daerah === 'all' ? null : bundle.stats.daerah.find(x => x.name === c.daerah) ?? null;
              setSelected(d?.id ?? null);
              setActiveArea(null);
              next.selectedDaerah = d?.name ?? null;
              next.activeArea = null;
            }
            if (c.on.length || c.off.length) {
              const apply = (l: LayerState) => {
                const n = { ...l };
                c.on.forEach(k => { n[LAYER_OF[k]] = true; });
                c.off.forEach(k => { n[LAYER_OF[k]] = false; });
                return n;
              };
              setLayers(apply);
              const known = Object.fromEntries((Object.keys(LAYER_OF) as MapLayerName[]).map(k => [LAYER_OF[k], cur.layers.includes(k)]));
              next.layers = visibleLayers(apply({ ...DEFAULT_LAYERS, ...known } as LayerState));
            }
            // later tools in the same answer must see the new view before React re-renders
            view.current = next;
            return next;
          },
          showSites: (list, label) => {
            const sc = bundle.model.scenarios.find(s => s.key === view.current.scenario);
            showSites(list, label, sc?.label ?? 'the chosen scenario');
          },
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
  if (!bundle || !grid || !scenario || !cellsByDaerah) {
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
  const extreme = bundle.model.scenarios[bundle.model.scenarios.length - 1];
  const findSitesIn = (cells: Int32Array, label: string) => {
    if (!grid.detail) { setNotice('Terrain layers are still loading — try again in a moment.'); return; }
    showSites(findCandidateSites(grid, bundle.model, cells, extreme, 0.025, 6), label, extreme.label);
    if (isPhone) setSnap('peek');
  };
  const draftBrief = (a: DrawnArea) => {
    setBriefing(a.id);
    if (!isPhone) setRightTab('insights');
    agent.ask(BRIEF_PROMPT(a.label), {
      label: `Draft a planning brief for ${a.label}`,
      onReply: reply => {
        setBriefs(b => ({ ...b, [a.id]: {
          text: reply.text, grounded: reply.grounding.grounded, total: reply.grounding.total, model: reply.model,
          at: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
        } }));
      },
    }).finally(() => setBriefing(null));
  };

  const mapBlock = (
    <main className="cc-map">
      <MapView
        bundle={bundle} grid={grid} scenario={scenario} layers={layers} basemap={basemap}
        selectedDaerah={selected} drawn={area?.rings ?? null} drawMode={drawMode} focus={focus} inspect={inspect} resetToken={resetToken}
        sites={sites}
        padding={isPhone ? PAD_PHONE : PAD_DESKTOP}
        onSelectDaerah={selectDaerah}
        onDrawn={rings => {
          addArea(rings);
          if (isPhone) { setSheetTab('area'); setSnap('half'); } else setRightTab('insights');
        }}
        onDrawModeChange={setDrawMode}
        onCellPick={info => {
          setCell(info);
          const cls = ['Water', 'Low', 'Moderate', 'High'][info.cls[scenarioKey]] ?? 'unclassified';
          setAskReq({ intent: 'why', label: `Why is the spot at ${info.lonlat[1].toFixed(4)}, ${info.lonlat[0].toFixed(4)} classed ${cls}?`, token: Date.now() });
          if (isPhone) { setSheetTab('ask'); setSnap('half'); } else setRightTab('ask');
        }}
        onBasemapError={msg => { setNotice(msg); setBasemap('streets'); }}
      />
      <MapChrome
        places={bundle.places} scenario={scenario} layers={layers} onLayers={setLayers}
        basemap={basemap} onBasemap={setBasemap} googleAvailable={googleAvailable} detailReady={detailReady}
        drawMode={drawMode} onDrawMode={setDrawMode} hasArea={Boolean(area)} onClearArea={() => setActiveArea(null)}
        onPick={onPick} onAsk={openAsk} onAskText={q => askAbout(q)} onLocate={locate} locating={locating}
        aiMode={agent.mode} aiBusy={agent.busy}
        onReset={() => { setResetToken(t => t + 1); setSelected(null); setActiveArea(null); setCell(null); setSites(null); }}
        notice={notice} onDismissNotice={() => setNotice(null)}
      />
    </main>
  );

  const daerahPanel = (
    <DaerahPanel stats={bundle.stats} model={bundle.model} scenario={scenario} selected={selected}
      report={subjectReport} facilities={subjectFacilities} onSelect={selectDaerah} onShowFacility={showFacility}
      aiMode={agent.mode}
      onAsk={name => askAbout(name ? `Brief me on flood exposure in ${name}` : 'Brief me on flood exposure across Selangor: which daerah are most exposed, and why?')}
      onFindSites={() => findSitesIn(cellsByDaerah[selected ?? 0], daerahName ?? 'Selangor')} />
  );
  const sitesCard = sites && (
    <SitesCard label={sites.label} sites={sites.list} lowUnder={sites.lowUnder}
      onShow={s => { setInspect({ lat: s.centre[1], lon: s.centre[0], title: `Candidate S${s.rank}`, token: Date.now() }); if (isPhone) setSnap('peek'); }}
      onClear={() => setSites(null)} />
  );
  const rankingCard = (
    <RankingCard stats={bundle.stats} scenario={scenario} areas={areas}
      selectedDaerah={selected} activeArea={activeArea}
      onSelectDaerah={selectDaerah}
      onSelectArea={id => setActiveArea(id)} />
  );
  const areaPanel = (
    <>
      {sitesCard}
      {!area && rankingCard}
      <AreaReportCard
        area={area} model={bundle.model} scenario={scenario} exporting={exporting}
        ai={agent.mode === 'ai'} brief={area ? briefs[area.id] ?? null : null}
        briefBusy={agent.busy || briefing !== null}
        onDraftBrief={() => area && draftBrief(area)}
        onFindSites={() => area && findSitesIn(rasterizePolygon(grid.meta, area.rings), area.label)}
        onDraw={m => { setDrawMode(m); if (isPhone) setSnap('peek'); }}
        onRemove={() => { setShapes(as => as.filter(a => a.id !== activeArea)); setActiveArea(null); }}
        onShowFacility={showFacility}
        onAsk={() => askAbout(`Why is ${area?.label} flagged, and what should a planner check?`)}
        onExportGeo={() => area && triggerDownload(JSON.stringify(areaGeoJSON(area.rings, area.report, bundle.model, area.label), null, 1),
          `ginkgo-${area.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.geojson`, 'application/geo+json')}
        onExportPdf={async () => {
          if (!area) return;
          setExporting(true);
          try {
            await downloadBrief({
              grid, rings: area.rings, report: area.report, model: bundle.model, scenario, validation: bundle.validation, label: area.label,
              aiBrief: briefs[area.id] ?? null,
            });
          } finally { setExporting(false); }
        }}
      />
      {area && rankingCard}
    </>
  );
  const copilot = (layout: 'full' | 'dock') => (
    <Copilot chips={chips} getContext={getContext} request={askReq} agent={agent} focusToken={askFocus} layout={layout} />
  );
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
          tabs={[{ key: 'overview', label: daerahName ?? 'Selangor' }, { key: 'area', label: area ? area.label : 'Area & ranking' }, { key: 'ask', label: '✦ Ask' }]}
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
          <div hidden={sheetTab !== 'ask'}>{copilot('dock')}</div>
        </BottomSheet>
        {method}
      </div>
    );
  }

  return (
    <div className="cc">
      <TopBar scenario={scenario} subjectLabel={subjectLabel} onOpenMethod={() => setMethodOpen(true)}
        aiMode={agent.mode} aiModel={agent.model} aiProvider={agent.provider} totals={agent.totals} />
      <div className="cc-main">
        {daerahPanel}
        {mapBlock}
        <aside className="cc-panel right" aria-label="Insights and Ask Ginkgo">
          <div className="panel-tabs" role="tablist" aria-label="Right panel">
            <button role="tab" aria-selected={rightTab === 'insights'} onClick={() => setRightTab('insights')}>
              Insights{(area || sites) && <span className="tab-count">{(area ? 1 : 0) + (sites ? 1 : 0)}</span>}
            </button>
            <button role="tab" aria-selected={rightTab === 'ask'} onClick={() => { setRightTab('ask'); setAskFocus(t => t + 1); }}>
              <span className="spark" aria-hidden>✦</span> Ask Ginkgo{agent.busy && <span className="tab-busy" aria-label="working" />}
            </button>
          </div>
          <div className="panel-pane scroll" hidden={rightTab !== 'insights'}>{areaPanel}</div>
          <div className="panel-pane fill" hidden={rightTab !== 'ask'}>{copilot('full')}</div>
        </aside>
      </div>
      <BottomBar model={bundle.model} scenario={scenarioKey} onScenario={setScenarioKey}
        built={bundle.stats.built} detailReady={detailReady} />
      {method}
    </div>
  );
};
