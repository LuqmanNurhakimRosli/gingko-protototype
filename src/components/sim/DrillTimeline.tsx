// Ginkgo flood drill — bottom bar: play the drill, scrub the clock.

import type { FC } from 'react';
import { LEVELS, fmtClock } from '../../sim/flood';
import type { Drill } from '../../sim/useDrill';

const SPEEDS = [10, 20, 40];

export const DrillTimeline: FC<{ drill: Drill; compact?: boolean }> = ({ drill, compact }) => {
  const { event, t, playing } = drill;
  const end = event.durationMin;
  const pct = (m: number) => `${(m / end) * 100}%`;
  const toggle = () => {
    if (!playing && t >= end) drill.setT(0);
    drill.setPlaying(!playing);
  };
  return (
    <div className={`drill-timeline${compact ? ' compact' : ''}`}>
      <button className="play-btn" onClick={toggle} aria-label={playing ? 'Pause the drill' : 'Play the drill'}>
        {playing ? <svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg> : <svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" /></svg>}
      </button>
      <div className="clock-sm mono">{fmtClock(t)}</div>
      <div className="scrub">
        <div className="scrub-marks" aria-hidden>
          <span style={{ left: pct(event.firstMin) }}>first flooding</span>
          <span style={{ left: pct(event.peakMin) }}>peak</span>
        </div>
        <input type="range" min={0} max={end} step={1} value={Math.round(t)} aria-label="Drill clock (minutes since the rain started)"
          onChange={e => { drill.setPlaying(false); drill.setT(Number(e.target.value)); }}
          style={{ ['--p' as string]: pct(t) }} />
      </div>
      {!compact && (
        <>
          <div className="seg" role="group" aria-label="Playback speed">
            {SPEEDS.map(s => <button key={s} aria-pressed={drill.speed === s} onClick={() => drill.setSpeed(s)} title={`${s} drill minutes per second`}>{s}×</button>)}
          </div>
          <div className="tl-legend" aria-label="Map legend">
            <span><i className="water" />Flooded</span>
            {([4, 3, 2] as const).map(l => <span key={l}><i style={{ background: LEVELS[l].color }} />{LEVELS[l].lead}</span>)}
          </div>
        </>
      )}
    </div>
  );
};
