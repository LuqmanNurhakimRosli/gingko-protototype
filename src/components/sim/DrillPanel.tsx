// Ginkgo flood drill — left panel: the event, the clock, the headline numbers
// and the alert list (Japan-style levels, earliest first).

import { useMemo, useState, type FC } from 'react';
import { DAERAH_NAMES } from '../../data/analysis';
import { fmtCompact, fmtInt } from '../../data/format';
import { EVENTS, LEVELS, fmtClock, fmtLead, levelOf, type Level, type PlaceRisk } from '../../sim/flood';
import { EVAC, seriesAt } from '../../sim/evac';
import type { Drill } from '../../sim/useDrill';

interface Props {
  drill: Drill;
  onRoute: (r: PlaceRisk) => void;
  onShow: (r: PlaceRisk) => void;
  onAsk: () => void;
  aiMode: 'checking' | 'ai' | 'off';
}

export const LevelBadge: FC<{ level: Exclude<Level, 0>; short?: boolean }> = ({ level, short }) => (
  <span className="lv-badge" style={{ background: LEVELS[level].color, color: LEVELS[level].ink }} title={LEVELS[level].action}>
    {short ? `L${level}` : LEVELS[level].name}
  </span>
);

export const DrillPanel: FC<Props> = ({ drill, onRoute, onShow, onAsk, aiMode }) => {
  const { event, sim, t, totals, plan, planning, risks, data } = drill;
  const [onlyUrgent, setOnlyUrgent] = useState(false);
  const [more, setMore] = useState(false);

  const alerts = useMemo(() => {
    const list = risks
      .map(r => ({ r, level: levelOf(r.onset, t) }))
      .filter(x => x.level >= (onlyUrgent ? 4 : 2));
    list.sort((a, b) => b.level - a.level || a.r.onset - b.r.onset || b.r.people - a.r.people);
    return list;
  }, [risks, t, onlyUrgent]);
  const counts = useMemo(() => {
    const c = { 5: 0, 4: 0, 3: 0, 2: 0 } as Record<Exclude<Level, 0>, number>;
    for (const r of risks) { const l = levelOf(r.onset, t); if (l) c[l]++; }
    return c;
  }, [risks, t]);

  const capacity = useMemo(() => {
    if (!data || !sim) return 0;
    const rain = new Set(sim.event.daerah);
    return data.shelters.items.reduce((a, s) => a + (rain.has(s.d) ? s.cap : 0), 0);
  }, [data, sim]);
  const sheltered = plan ? seriesAt(plan.arrived, plan, t) : 0;
  const rescue = plan ? seriesAt(plan.rescue, plan, t) : 0;
  const top = ([5, 4, 3, 2] as const).find(l => counts[l] > 0);

  return (
    <aside className="cc-panel left drill-panel" aria-label="Flood drill">
      <div className="card">
        <div className="card-head">
          <span className="card-title">Flood drill</span>
          <span className="sim-tag" title="A time-lapse of a rain scenario on the susceptibility grid. No live rainfall, river gauges or hydraulic model.">Simulation · not a forecast</span>
        </div>
        <div className="event-list" role="radiogroup" aria-label="Rain event">
          {EVENTS.map(e => (
            <button key={e.id} role="radio" aria-checked={e.id === event.id} className="event-opt" onClick={() => drill.setEvent(e.id)}>
              <b>{e.label}</b>
              {e.id === event.id && <span className="event-desc">{e.desc}</span>}
              {e.id === event.id && (
                <span className="event-area">Rain over {e.daerah.length === 9 ? 'all nine daerah' : e.daerah.map(d => DAERAH_NAMES[d - 1]).join(', ')}</span>
              )}
            </button>
          ))}
        </div>
        <div className="drill-row">
          <span className="group-label">Intensity</span>
          <div className="seg" role="group" aria-label="Intensity">
            {(['heavy', 'extreme'] as const).map(k => (
              <button key={k} aria-pressed={event.intensity === k} onClick={() => drill.setIntensity(k)}
                title={`At the peak the water covers the ${k === 'heavy' ? 'Heavy' : 'Extreme'} scenario's High class`}>
                {k === 'heavy' ? 'Heavy · 50 mm/hr' : 'Extreme · 120 mm/hr'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="drill-clock">
          <div>
            <div className="clock mono">{fmtClock(t)}</div>
            <div className="card-sub">since the rain started · peak at {fmtClock(event.peakMin)}</div>
          </div>
          {top ? <LevelBadge level={top} /> : <span className="lv-badge none">No warnings yet</span>}
        </div>
        <div className="tiles drill-tiles">
          <div className="tile">
            <div className="label"><i className="swatch" style={{ background: '#3884EC' }} />Living in flooded cells</div>
            <div className="value">{totals ? fmtCompact(totals.floodedPeople) : '—'}</div>
            <div className="note">{totals ? `${totals.floodedKm2.toFixed(0)} km² under water` : ''}</div>
          </div>
          <div className="tile">
            <div className="label"><i className="swatch" style={{ background: LEVELS[4].color }} />Flooding within 1 h</div>
            <div className="value">{totals ? fmtCompact(totals.level4People) : '—'}</div>
            <div className="note">people · Level 4, evacuate now</div>
          </div>
          <div className="tile">
            <div className="label"><i className="swatch" style={{ background: '#1E8E3E' }} />In evacuation centres</div>
            <div className="value">{plan ? fmtCompact(sheltered) : planning ? '…' : '—'}</div>
            <div className="note">{capacity ? `of ${fmtCompact(capacity)} places in the rain area` : ''}</div>
          </div>
          <div className="tile">
            <div className="label"><i className="swatch" style={{ background: '#D93025' }} />No centre within reach</div>
            <div className="value">{plan ? fmtCompact(rescue) : planning ? '…' : '—'}</div>
            <div className="note">need transport, rescue or another shelter</div>
          </div>
        </div>
        {planning && <div className="card-sub" style={{ marginTop: 8 }}>Planning evacuation routes for every zone…</div>}
        {aiMode === 'ai' && (
          <button className="btn btn-ai btn-sm" style={{ marginTop: 10 }} onClick={onAsk}>✦ Ask Ginkgo for a situation report</button>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <span className="card-title">Alerts {alerts.length ? <span className="tab-count">{alerts.length}</span> : null}</span>
          <div className="seg" role="group" aria-label="Alert filter">
            <button aria-pressed={!onlyUrgent} onClick={() => setOnlyUrgent(false)}>Level 2+</button>
            <button aria-pressed={onlyUrgent} onClick={() => setOnlyUrgent(true)}>Level 4+</button>
          </div>
        </div>
        <div className="lv-legend">
          {([5, 4, 3, 2] as const).map(l => (
            <span key={l} title={LEVELS[l].action}><i style={{ background: LEVELS[l].color }} />{counts[l]}</span>
          ))}
        </div>
        {!alerts.length && <p className="muted" style={{ fontSize: 12 }}>No neighbourhood is within 3 hours of flooding yet. Press play below.</p>}
        <ul className="alert-list">
          {alerts.slice(0, more ? 120 : 30).map(({ r, level }) => (
            <li key={`${r.kind}:${r.name}:${r.point[0]}`} className={`alert-row lv${level}`}>
              <button className="alert-main" onClick={() => onShow(r)} title="Show on the map">
                <LevelBadge level={level as Exclude<Level, 0>} short />
                <span className="alert-text">
                  <b>{r.name}</b>
                  <span>{r.sub}{r.daerah ? ` · ${r.daerah}` : ''}{r.people > 0 ? ` · ~${fmtInt(r.people)} people` : ''}</span>
                </span>
                <span className="alert-lead">{level === 5 ? 'flooding' : fmtLead(r.onset - t)}</span>
              </button>
              <button className="btn btn-ghost btn-sm alert-go" onClick={() => onRoute(r)} title="Plan an evacuation route from here">Route</button>
            </li>
          ))}
        </ul>
        {alerts.length > 30 && !more && <button className="btn btn-ghost btn-sm" onClick={() => setMore(true)}>Show {Math.min(120, alerts.length) - 30} more</button>}
      </div>

      <details className="card drill-notes">
        <summary className="card-title">How the drill works</summary>
        <ul>
          <li>Rain falls over the chosen daerah. Water reaches the most susceptible ground first and spreads until, at the peak, it covers the scenario's High class. Depths are indicative.</li>
          <li>Warnings follow Japan's 5-level system in JMA Kikikuru colours: yellow = within 3 h, red = 2 h, purple = 1 h (evacuate), black = flooding now.</li>
          <li>Orders go out per ~740 m zone an hour before its first cell floods. {Math.round(EVAC.share * 100)}% of residents go to a public centre (the rest to family or upstairs); they walk to the nearest centre with space, on roads that stay dry.</li>
          <li>Centres: {data ? fmtInt(data.shelters.items.length) : '…'} schools, halls, mosques and sports complexes on ground that stays Low or Moderate under Extreme rain. Capacity = usable floor area ÷ 3.5 m² per person (Sphere). Candidates, not the official NADMA/JKM list.</li>
        </ul>
      </details>
    </aside>
  );
};
