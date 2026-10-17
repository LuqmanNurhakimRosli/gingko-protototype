// Tests for the Claude agent pieces: grounding check, client loop, and the
// browser-side tools over the real data.

import { describe, expect, it } from 'vitest';
import { analysePolygon, cellIndex, classOf, DAERAH_NAMES, findCandidateSites, isCandidateCell, polygonAreaKm2, type CandidateSite } from '../data/analysis';
import { cellsOf, loadBundle } from '../test/realData';
import { runAgentTurn, type MessageParam } from './agentClient';
import { TOOLS } from './agentSpec';
import { runTool, type AgentView, type ToolContext, type ViewChange } from './agentTools';
import { checkGrounding, extractFigures } from './grounding';

describe('grounding check', () => {
  it('matches figures to tool numbers within their written precision', () => {
    const tool = { high_pct: 17.4, people_in_high_estimate: 31369, river_km: 14.6, zones: 3, share: 0.594, dist_m: 1500 };
    const g = checkGrounding('17.4% is High, about 31,400 people, 14.6 km of river, 3 zones, 59% within 500 m, 1.5 km away.', [tool, 'within 500 m']);
    expect(g.numbers.map(n => [n.raw, n.grounded])).toEqual([
      ['17.4', true], ['31,400', true], ['14.6', true], ['3', true], ['59', true], ['500', true], ['1.5', true],
    ]);
  });

  it('flags figures that are not in any tool result', () => {
    const g = checkGrounding('There are 12 hospitals and 4.2 km² of High land.', [{ hospitals: 9, high_km2: 4.25 }]);
    expect(g.total).toBe(2);
    expect(g.numbers.find(n => n.raw === '12')!.grounded).toBe(false);
    expect(g.numbers.find(n => n.raw === '4.2')!.grounded).toBe(true); // 4.25 rounds to 4.2 at 1 dp (±0.05)
  });

  it('requires a compatible unit, so a coincidental number does not count', () => {
    const tool = { zones: 12, river_and_canal_km: 14.6, median_distance_to_river_m: 830 };
    const g = checkGrounding('The nearest evacuation centre is 12 km away; the river is 830 m or 0.83 km off.', [tool]);
    expect(g.numbers.map(n => [n.raw, n.grounded])).toEqual([['12', false], ['830', true], ['0.83', true]]);
    // a rain label from the method text grounds "120 mm/hr", but not "120 people"
    const rain = checkGrounding('Extreme is 120 mm/hr; 120 people', ['120 mm/hr (hypothetical stress scenario)']);
    expect(rain.numbers.map(n => n.grounded)).toEqual([true, false]);
  });

  it('reads K / M / million suffixes and ignores list markers', () => {
    const f = extractFigures('1. Petaling has 2.30M people\n2. Klang has 1.09 million\n3. Gombak 942K');
    expect(f.map(x => x.value)).toEqual([2.3e6, 1.09e6, 942e3]);
    const g = checkGrounding('Petaling has 2.30M people', [{ population: 2298130 }]);
    expect(g.grounded).toBe(1);
  });
});

describe('agent loop', () => {
  it('runs tools locally, sends results back in one message, keeps history append-only', async () => {
    const toolUse = [
      { type: 'thinking', thinking: '', signature: 'sig-1' },
      { type: 'tool_use', id: 'tu_1', name: 'query_point', input: { latitude: 3.03, longitude: 101.53 } },
      { type: 'tool_use', id: 'tu_2', name: 'get_current_view', input: {} },
    ];
    const final = [{ type: 'text', text: 'The cell scores 0.5 under Normal.' }];
    const bodies: { messages: MessageParam[] }[] = [];
    const replies = [
      { content: toolUse, stop_reason: 'tool_use', model: 'claude-opus-5-5' },
      { content: final, stop_reason: 'end_turn', model: 'claude-opus-5-5' },
    ];
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies[bodies.length - 1]), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;

    const executed: string[] = [];
    const { history, reply } = await runAgentTurn({
      history: [],
      userText: 'Why is this spot flagged?',
      context: { scenario: 'normal' },
      execute: (name) => { executed.push(name); return { step: `ran ${name}`, result: name === 'query_point' ? { score: 0.5 } : { scenario: 'normal' } }; },
      fetchImpl,
    });

    expect(executed).toEqual(['query_point', 'get_current_view']);
    // second request = first request + assistant turn (verbatim) + ONE user message with both results
    expect(bodies[1].messages.slice(0, 1)).toEqual(bodies[0].messages);
    expect(bodies[1].messages[1]).toEqual({ role: 'assistant', content: toolUse });
    const results = bodies[1].messages[2];
    expect(results.role).toBe('user');
    expect((results.content as { type: string; tool_use_id: string }[]).map(b => [b.type, b.tool_use_id])).toEqual([['tool_result', 'tu_1'], ['tool_result', 'tu_2']]);
    expect(history).toHaveLength(4);
    expect(reply.text).toBe('The cell scores 0.5 under Normal.');
    expect(reply.steps.map(s => s.label)).toEqual(['ran query_point', 'ran get_current_view']);
    expect(reply.grounding).toMatchObject({ total: 1, grounded: 1 });
    expect(reply.usage).toMatchObject({ rounds: 2, cachedRounds: 0 });
  });

  it('adds up tokens and cost across rounds, and counts shared-cache hits as free', async () => {
    const replies = [
      { content: [{ type: 'tool_use', id: 'a', name: 'get_current_view', input: {} }], stop_reason: 'tool_use', model: 'claude-opus-5-5',
        usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 9000, cache_creation_input_tokens: 0 } },
      { content: [{ type: 'text', text: 'Done.' }], stop_reason: 'end_turn', model: 'claude-opus-5-5', cached: true,
        usage: { input_tokens: 5000, output_tokens: 500 } },
    ];
    let n = 0;
    const fetchImpl = (async () => new Response(JSON.stringify(replies[n++]), { status: 200 })) as unknown as typeof fetch;
    const { reply } = await runAgentTurn({ history: [], userText: 'q', context: {}, execute: () => ({ step: 's', result: {} }), fetchImpl });
    expect(reply.usage).toMatchObject({ rounds: 2, cachedRounds: 1, inputTokens: 1000, outputTokens: 100, cacheReadTokens: 9000 });
    // 1000 × $4 + 100 × $20 + 9000 × $0.20, per million tokens
    expect(reply.usage.costUsd).toBeCloseTo((1000 * 4 + 100 * 20 + 9000 * 0.2) / 1e6, 9);
  });

  it('surfaces server errors', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ error: 'busy' }), { status: 429 })) as unknown as typeof fetch;
    await expect(runAgentTurn({ history: [], userText: 'hi', context: {}, execute: () => ({ step: '', result: {} }), fetchImpl })).rejects.toThrow('busy');
  });
});

describe('agent tools over the real data', () => {
  const bundle = loadBundle();
  let view: AgentView = { scenario: 'normal', selectedDaerah: null, activeArea: null, lastCell: null, layers: ['flood_susceptibility'] };
  const shown: string[] = [];
  const changes: ViewChange[] = [];
  let siteList: CandidateSite[] = [];
  const ctx: ToolContext = {
    bundle, grid: bundle.grid,
    daerahCells: id => cellsOf(bundle.grid, id),
    getDrill: () => ({ active: false, sim: null, t: 0, plan: null, data: null }),
    setDrill: () => {},
    drillActions: { startDrill: () => {}, routeFrom: () => {} },
    getView: () => view,
    actions: {
      showArea: (_r, label) => shown.push(label),
      showPoint: (_a, _b, label) => shown.push(label),
      setView: c => {
        changes.push(c);
        view = { ...view, scenario: c.scenario ?? view.scenario, selectedDaerah: c.daerah === 'all' ? null : c.daerah ?? view.selectedDaerah,
          layers: [...new Set([...view.layers.filter(l => !c.off.includes(l)), ...c.on])] };
        return view;
      },
      showSites: list => { siteList = list; },
    },
  };

  it('every declared tool has an executor and a strict, closed schema', () => {
    for (const t of TOOLS) {
      expect(t.strict).toBe(true);
      const schema = t.input_schema as { additionalProperties?: boolean; required?: string[]; properties?: Record<string, unknown> };
      expect(schema.additionalProperties).toBe(false);
      expect(new Set(schema.required)).toEqual(new Set(Object.keys(schema.properties ?? {})));
      expect(runTool(ctx, t.name, {}).result).toBeDefined();
    }
  });

  it('search_places finds Taman Sri Muda and reports the daerah from the boundary data', () => {
    const r = runTool(ctx, 'search_places', { query: 'Taman Sri Muda', limit: 3 }).result as { results: { name: string; daerah: string; latitude: number; longitude: number }[] };
    const top = r.results[0];
    expect(top.name).toBe('Taman Sri Muda');
    // Shah Alam straddles two daerah; Seksyen 25 (Taman Sri Muda) lies in Klang
    expect(top.daerah).toBe(DAERAH_NAMES[bundle.grid.daerah[cellIndex(bundle.grid.meta, top.longitude, top.latitude)] - 1]);
    expect(top.daerah).toBe('Klang');
  });

  it('analyse_location matches the panel analysis and draws the area', () => {
    const out = runTool(ctx, 'analyse_location', { latitude: 3.03, longitude: 101.53, radius_m: 1000, label: 'Sri Muda · 1 km' });
    expect(out.isError).toBeFalsy();
    const r = out.result as { by_scenario: Record<string, { high_pct: number }>; radius_m: number };
    expect(r.radius_m).toBe(1000);
    expect(shown).toContain('Sri Muda · 1 km');
    const ring = Array.from({ length: 72 }, (_, i) => {
      const a = (2 * Math.PI * i) / 72;
      return [101.53 + (1000 / (111_320 * Math.cos((3.03 * Math.PI) / 180))) * Math.cos(a), 3.03 + (1000 / 111_320) * Math.sin(a)] as [number, number];
    });
    const direct = analysePolygon(bundle.grid, bundle.model, [ring]);
    expect(r.by_scenario.normal.high_pct).toBe(Math.round(direct.scenarios.normal.high_pct * 10) / 10);
    expect(polygonAreaKm2([ring])).toBeGreaterThan(3.1);
  });

  it('clamps radius and rejects places outside the grid', () => {
    const r = runTool(ctx, 'analyse_location', { latitude: 3.03, longitude: 101.53, radius_m: 999999, label: 'x' }).result as { radius_m: number };
    expect(r.radius_m).toBe(5000);
    expect(runTool(ctx, 'query_point', { latitude: 1.3, longitude: 103.8 }).isError).toBe(true);
    expect(runTool(ctx, 'get_daerah_profile', { daerah: 'Atlantis' }).isError).toBe(true);
  });

  it('daerah profile and ranking agree with stats.json', () => {
    const p = runTool(ctx, 'get_daerah_profile', { daerah: 'Klang' }).result as { population_census_2020: number; by_scenario: Record<string, { high_pct: number }> };
    const s = bundle.stats.daerah.find(d => d.name === 'Klang')!;
    expect(p.population_census_2020).toBe(s.population);
    expect(Math.abs(p.by_scenario.normal.high_pct - s.scenarios.normal.high_pct)).toBeLessThanOrEqual(0.1);
    const rank = runTool(ctx, 'rank_daerah', { scenario: 'normal', metric: 'high_pct' }).result as { ranking: { daerah: string; value: number }[] };
    expect(rank.ranking[0].value).toBe(Math.max(...bundle.stats.daerah.map(d => d.scenarios.normal.high_pct)));
  });

  it('facility counts follow the scenario thresholds', () => {
    const sc = bundle.model.scenarios[0];
    const r = runTool(ctx, 'list_facilities_at_risk', { kind: 'hospital', scope: 'daerah', daerah: 'Klang', scenario: 'normal', limit: 5 }).result as { counts: { in_high: number }[]; in_high: unknown[] };
    const expected = bundle.facilities.items.filter(f => f.k === 'hospital' && f.d === 6 && classOf(f.s, sc) === 3).length;
    expect(r.counts[0].in_high).toBe(expected);
    expect(r.in_high.length).toBe(Math.min(5, expected));
    expect(runTool(ctx, 'list_facilities_at_risk', { kind: 'all', scope: 'active_area', daerah: null, scenario: 'normal', limit: 5 }).isError).toBe(true);
  });

  it('set_map_view changes the view that later tools read', () => {
    const out = runTool(ctx, 'set_map_view', { scenario: 'extreme', daerah: 'Klang', layers_on: ['hospitals'], layers_off: [] });
    expect(out.isError).toBeFalsy();
    expect(out.result).toMatchObject({ scenario: 'extreme', selected_daerah: 'Klang' });
    expect((out.result as { visible_layers: string[] }).visible_layers).toContain('hospitals');
    const now = runTool(ctx, 'get_current_view', {}).result as { scenario: string; selected_daerah: string };
    expect(now).toMatchObject({ scenario: 'extreme', selected_daerah: 'Klang' });
    expect(runTool(ctx, 'set_map_view', { scenario: null, daerah: 'Atlantis', layers_on: [], layers_off: [] }).isError).toBe(true);
    expect(runTool(ctx, 'set_map_view', { scenario: null, daerah: null, layers_on: ['lava'], layers_off: [] }).isError).toBe(true);
    runTool(ctx, 'set_map_view', { scenario: 'normal', daerah: 'all', layers_on: [], layers_off: ['hospitals'] });
    expect(view).toMatchObject({ scenario: 'normal', selectedDaerah: null });
  });

  it('find_candidate_sites returns screened blocks, largest first, and marks them', () => {
    const out = runTool(ctx, 'find_candidate_sites', { daerah: 'Sepang', min_area_ha: 5, low_under: 'extreme', max_sites: 4, purpose: 'school' });
    expect(out.isError).toBeFalsy();
    const r = out.result as { sites: { site: string; area_ha: number; daerah: string }[]; screened_land_ha: number };
    expect(r.sites.length).toBeGreaterThan(0);
    expect(r.sites.length).toBeLessThanOrEqual(4);
    expect(siteList).toHaveLength(r.sites.length);
    const areas = r.sites.map(x => x.area_ha);
    expect([...areas].sort((a, b) => b - a)).toEqual(areas);
    expect(Math.min(...areas)).toBeGreaterThanOrEqual(5);
    expect(r.sites.every(x => x.daerah === 'Sepang')).toBe(true);
    expect(r.screened_land_ha).toBeGreaterThanOrEqual(areas.reduce((a, b) => a + b, 0) - 1);
  });
});

describe('site screen', () => {
  const bundle = loadBundle();
  const extreme = bundle.model.scenarios[2];

  it('every cell of every site passes the screen and sites never touch', () => {
    const sites = findCandidateSites(bundle.grid, bundle.model, cellsOf(bundle.grid, 9), extreme, 0.05, 8);
    const seen = new Set<number>();
    for (const s of sites) {
      for (const i of s.cells) {
        expect(isCandidateCell(bundle.grid, bundle.model, i, extreme)).toBe(true);
        expect(seen.has(i)).toBe(false);
        seen.add(i);
      }
      expect(s.area_km2).toBeGreaterThanOrEqual(0.05);
      const centre = cellIndex(bundle.grid.meta, s.centre[0], s.centre[1]);
      expect(Array.from(s.cells)).toContain(centre);
    }
  });

  it('a stricter scenario never finds more candidate land', () => {
    const cells = cellsOf(bundle.grid, 7);
    const count = (k: number) => Array.from(cells).filter(i => isCandidateCell(bundle.grid, bundle.model, i, bundle.model.scenarios[k])).length;
    expect(count(2)).toBeLessThanOrEqual(count(1));
    expect(count(1)).toBeLessThanOrEqual(count(0));
  });
});
