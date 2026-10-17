// Ginkgo flood drill — right panel: the evacuation route from a chosen point,
// the destination centre (illustration, capacity, how full it gets) and the
// centres in the rain area.

import { useMemo, type FC } from 'react';
import { DAERAH_NAMES } from '../../data/analysis';
import { fmtCompact, fmtInt } from '../../data/format';
import { fmtClock } from '../../sim/flood';
import { CROWDING, EVAC, type Shelter } from '../../sim/evac';
import type { Route } from '../../sim/route';
import type { Drill } from '../../sim/useDrill';
import { ShelterArt } from './ShelterArt';

interface Props {
  drill: Drill;
  onShowShelter: (s: Shelter) => void;
  onLocate: () => void;
  locating: boolean;
  onAsk: (q: string) => void;
  aiMode: 'checking' | 'ai' | 'off';
}

const KIND: Record<Shelter['k'], string> = { school: 'School', hall: 'Community hall', mosque: 'Mosque', sports: 'Stadium / sports hall' };
const fmtDist = (m: number) => (m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`);
const fmtMin = (m: number) => (m < 60 ? `${Math.max(1, Math.round(m))} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
const gmaps = (lat: number, lon: number) => `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lon.toFixed(6)}`;

/** Occupancy over the drill as a small area chart, with the clock marked. */
const Fill: FC<{ drill: Drill; id: number; cap: number }> = ({ drill, id, cap }) => {
  const { plan, sim, t } = drill;
  if (!plan || !sim) return null;
  const W = 260, H = 44;
  const occ = plan.occ[id];
  const n = occ.length;
  const pts = Array.from(occ, (v, i) => `${(i / (n - 1)) * W},${H - Math.min(1, v / cap) * (H - 4)}`);
  const x = (Math.min(t, sim.event.durationMin) / sim.event.durationMin) * W;
  const full = plan.fullAt[id];
  return (
    <svg className="fill-chart" viewBox={`0 0 ${W} ${H + 12}`} role="img" aria-label="How full the centre gets during the drill">
      <line x1={0} y1={4} x2={W} y2={4} stroke="#D93025" strokeDasharray="3 3" strokeWidth={1} />
      <text x={W} y={3} textAnchor="end" fontSize={8} fill="#D93025" dy={-1}>capacity</text>
      <polygon points={`0,${H} ${pts.join(' ')} ${W},${H}`} fill="#1E8E3E" fillOpacity={0.18} />
      <polyline points={pts.join(' ')} fill="none" stroke="#1E8E3E" strokeWidth={1.6} />
      <line x1={x} y1={0} x2={x} y2={H} stroke="#111" strokeWidth={1.2} />
      <text x={0} y={H + 10} fontSize={8} fill="#888">T+0</text>
      <text x={W} y={H + 10} fontSize={8} fill="#888" textAnchor="end">{fmtClock(sim.event.durationMin)}</text>
      {Number.isFinite(full) && <text x={W / 2} y={H + 10} fontSize={8} fill="#D93025" textAnchor="middle">full at {fmtClock(full)}</text>}
    </svg>
  );
};

export const ShelterCard: FC<{ drill: Drill; shelter: Shelter; compact?: boolean; onShow?: () => void }> = ({ drill, shelter, compact, onShow }) => {
  const id = shelter.id;
  const crowd = drill.crowding(id);
  const occ = drill.occupancy(id);
  const share = Math.min(1, occ / shelter.cap);
  const m2 = 3.5;
  return (
    <div className={`shelter-card${compact ? ' compact' : ''}`}>
      <div className="shelter-art">
        <ShelterArt kind={shelter.k} seed={id} rain={drill.t > drill.event.firstMin} />
        <span className="art-note">Illustration · typical {KIND[shelter.k].toLowerCase()}</span>
      </div>
      <div className="shelter-body">
        <div className="shelter-name">
          <b>{shelter.n}</b>
          <span className="crowd-badge" style={{ background: CROWDING[crowd].color }}>{CROWDING[crowd].label}</span>
        </div>
        <div className="card-sub">{KIND[shelter.k]} · {DAERAH_NAMES[shelter.d - 1] ?? 'Federal territory'} · candidate PPS</div>
        <div className="cap-row">
          <div className="cap-bar"><i style={{ width: `${share * 100}%`, background: CROWDING[crowd].color }} /></div>
          <span className="mono">{fmtInt(occ)} / {fmtInt(shelter.cap)}</span>
        </div>
        {!compact && <Fill drill={drill} id={id} cap={shelter.cap} />}
        {!compact && (
          <ul className="shelter-facts">
            <li><b>Flood-safe ground:</b> {shelter.safe === 'low' ? 'Low' : 'Moderate'} under Extreme rain · {shelter.hand} m above drainage · {shelter.elev} m elevation</li>
            <li><b>Capacity:</b> {shelter.est === 'footprint'
              ? `${fmtInt(shelter.fp)} m² of footprint (${shelter.nb} building${shelter.nb === 1 ? '' : 's'}) → usable floor ÷ ${m2} m² per person (Sphere)`
              : `type default (no footprint mapped) ÷ ${m2} m² per person`}</li>
          </ul>
        )}
        <div className="shelter-links">
          {onShow && <button className="btn btn-ghost btn-sm" onClick={onShow}>Show on map</button>}
          <a className="btn btn-ghost btn-sm" href={gmaps(shelter.c[1], shelter.c[0])} target="_blank" rel="noreferrer">Real photos on Google Maps ↗</a>
        </div>
      </div>
    </div>
  );
};

const RouteSummary: FC<{ drill: Drill; route: Route; best: boolean; onPick: () => void }> = ({ drill, route, best, onPick }) => {
  const s = drill.data!.shelters.items[route.shelter];
  const crowd = drill.crowding(route.shelter);
  return (
    <button className={`alt-row${best ? ' best' : ''}`} onClick={onPick}>
      <span className="alt-time"><b>{fmtMin(route.minutes)}</b><span>{fmtDist(route.metres)}</span></span>
      <span className="alt-name"><b>{s.n}</b><span>{KIND[s.k]} · arrive {fmtClock(route.arriveMin)}</span></span>
      <i className="crowd-dot" style={{ background: CROWDING[crowd].color }} title={CROWDING[crowd].label} />
    </button>
  );
};

export const EvacPanel: FC<Props> = ({ drill, onShowShelter, onLocate, locating, onAsk, aiMode }) => {
  const { data, origin, route, mode, sim } = drill;
  const items = data?.shelters.items ?? [];
  const chosen = route?.ok ? route.routes[Math.min(drill.pick, route.routes.length - 1)] : null;
  const selected = drill.shelter !== null ? items[drill.shelter] : chosen ? items[chosen.shelter] : null;

  const inRain = useMemo(() => {
    if (!sim || !data) return [];
    const rain = new Set(sim.event.daerah);
    return data.shelters.items.filter(s => rain.has(s.d));
  }, [sim, data]);
  const busiest = useMemo(
    () => inRain.map(s => ({ s, share: drill.occupancy(s.id) / s.cap })).sort((a, b) => b.share - a.share).slice(0, 12),
    [inRain, drill],
  );
  const states = useMemo(() => {
    const n: Record<string, number> = { open: 0, busy: 0, crowded: 0, full: 0, closed: 0 };
    for (const s of inRain) n[drill.crowding(s.id)]++;
    return n;
  }, [inRain, drill]);

  if (drill.status === 'loading' || !data) {
    return <div className="card"><p className="muted">{drill.status === 'error' ? `Could not load the road network: ${drill.error}` : 'Loading roads and evacuation centres…'}</p></div>;
  }

  return (
    <>
      <div className="card">
        <div className="card-head">
          <span className="card-title">Evacuation route</span>
          <div className="seg" role="group" aria-label="Travel mode">
            <button aria-pressed={mode === 'walk'} onClick={() => drill.setMode('walk')}>🚶 Walk</button>
            <button aria-pressed={mode === 'drive'} onClick={() => drill.setMode('drive')}>🚗 Drive</button>
          </div>
        </div>
        {!origin && (
          <div className="route-empty">
            <p>Click anywhere on the map, pick <b>Route</b> on an alert, or search a place, to plan the way to the nearest evacuation centre with space.</p>
            <button className="btn btn-secondary btn-sm" onClick={onLocate} disabled={locating}>{locating ? 'Locating…' : '◎ From my location'}</button>
          </div>
        )}
        {origin && route && (
          <>
            <div className="route-from">From <b>{origin.label}</b> · leaving {fmtClock(drill.routeAt ?? 0)}</div>
            {route.startFlooded && (
              <div className="route-warn danger">This spot is already under water in the drill. {route.ok
                ? `The route wades ${fmtDist(route.routes[0].wadeMetres)} through flood water — only if it is shallow and still. Otherwise move to a higher floor and call 999.`
                : ''}</div>
            )}
            {!route.ok && <div className="route-warn danger">{route.reason}</div>}
            {route.full && (
              <div className="route-warn">Every centre within reach will be full when you arrive. The nearest are shown — authorities usually open extra centres;
                otherwise shelter upstairs with family or neighbours on higher ground.</div>
            )}
            {drill.leaveBy !== null && drill.leaveBy < drill.event.durationMin && (
              (drill.routeAt ?? 0) <= drill.leaveBy ? (
                <div className="leave-by ok">⏱ Leave by <b>{fmtClock(drill.leaveBy)}</b> {mode === 'walk' ? 'on foot' : 'by car'} — after that the roads out of here flood.</div>
              ) : (
                <div className="leave-by late">
                  ⏱ The last dry way out {mode === 'walk' ? 'on foot' : 'by car'} was at <b>{fmtClock(drill.leaveBy)}</b>.
                  <button className="btn btn-secondary btn-sm" onClick={() => { drill.setPlaying(false); drill.setT(drill.leaveBy!); }}>Plan it as leaving then</button>
                </div>
              )
            )}
            {drill.leaveBy === null && !route.startFlooded && (
              <div className="leave-by late">⏱ No dry way out {mode === 'walk' ? 'on foot' : 'by car'} at any time in this drill — plan to shelter on a higher floor.</div>
            )}
            {chosen && (
              <>
                <div className="route-hero">
                  <span className="big">{fmtMin(chosen.minutes)}</span>
                  <span>{fmtDist(chosen.metres)} {mode === 'walk' ? 'on foot' : 'by car (heavy-rain speeds)'} · arrive {fmtClock(chosen.arriveMin)}</span>
                </div>
                <ol className="steps">
                  {chosen.steps.slice(0, 8).map((s, i) => (
                    <li key={i}>{i === 0 ? 'Head along' : 'Continue on'} <b>{s.name}</b> <span className="muted">{fmtDist(s.metres)}</span></li>
                  ))}
                  {chosen.steps.length > 8 && <li className="muted">… {chosen.steps.length - 8} more roads</li>}
                  <li>Arrive at <b>{items[chosen.shelter].n}</b></li>
                </ol>
                <div className="card-sub">Roads that flood before you pass them are avoided; centres that will be full when you arrive are skipped.</div>
                {route.routes.length > 1 && (
                  <div className="alts">
                    <div className="group-label">Options</div>
                    {route.routes.map((r, i) => (
                      <RouteSummary key={r.shelter} drill={drill} route={r} best={i === Math.min(drill.pick, route.routes.length - 1)}
                        onPick={() => { drill.setPick(i); drill.setShelter(null); }} />
                    ))}
                  </div>
                )}
                <a className="btn btn-secondary btn-sm" style={{ marginTop: 10 }} target="_blank" rel="noreferrer"
                  href={`https://www.google.com/maps/dir/?api=1&origin=${origin.point[1]},${origin.point[0]}&destination=${items[chosen.shelter].c[1]},${items[chosen.shelter].c[0]}&travelmode=${mode === 'walk' ? 'walking' : 'driving'}`}>
                  Navigate in Google Maps ↗
                </a>
                {aiMode === 'ai' && (
                  <button className="btn btn-ai btn-sm" style={{ marginTop: 10, marginLeft: 8 }}
                    onClick={() => onAsk(`Explain the evacuation route from ${origin.label} in the flood drill, and what to take and do before leaving.`)}>
                    ✦ Explain this route
                  </button>
                )}
              </>
            )}
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }} onClick={() => drill.setOrigin(null)}>Clear start point</button>
          </>
        )}
      </div>

      {selected && (
        <div className="card">
          <div className="card-head"><span className="card-title">{drill.shelter !== null ? 'Evacuation centre' : 'Destination'}</span>
            {drill.shelter !== null && <button className="btn btn-ghost btn-sm" onClick={() => drill.setShelter(null)}>Close</button>}
          </div>
          <ShelterCard drill={drill} shelter={selected} onShow={() => onShowShelter(selected)} />
        </div>
      )}

      <div className="card">
        <div className="card-head">
          <span className="card-title">Centres in the rain area</span>
          <span className="card-sub">{fmtInt(inRain.length)} · {fmtCompact(inRain.reduce((a, s) => a + s.cap, 0))} places</span>
        </div>
        <div className="crowd-summary">
          {(['open', 'busy', 'crowded', 'full'] as const).map(c => (
            <span key={c}><i style={{ background: CROWDING[c].color }} /><b>{states[c]}</b> {CROWDING[c].label.toLowerCase()}</span>
          ))}
        </div>
        <ul className="centre-list">
          {busiest.map(({ s, share }) => {
            const crowd = drill.crowding(s.id);
            return (
              <li key={s.id}>
                <button onClick={() => { drill.setShelter(s.id); onShowShelter(s); }}>
                  <span className="centre-name"><b>{s.n}</b><span>{KIND[s.k]} · {DAERAH_NAMES[s.d - 1]}</span></span>
                  <span className="cap-bar small"><i style={{ width: `${Math.min(1, share) * 100}%`, background: CROWDING[crowd].color }} /></span>
                  <span className="mono centre-n">{Math.round(Math.min(1, share) * 100)}%</span>
                </button>
              </li>
            );
          })}
        </ul>
        <div className="source-line">
          Crowding states after Japan's VACAN shelter map: space available &lt; 50% · filling up · crowded ≥ 80% · full.
          {' '}{Math.round(EVAC.share * 100)}% of residents in flooding zones are assumed to go to a public centre. {data.shelters.note}
        </div>
      </div>
    </>
  );
};
