// Mapped critical facilities by flood class (hospitals, clinics, schools,
// police, fire & rescue, rail stations) for a daerah, Selangor or a drawn area.

import { useState, type FC } from 'react';
import { classOf, facilityExposure } from '../../data/analysis';
import { RISK_COLOR } from '../../data/format';
import type { Facility, FacilityKind, Scenario } from '../../data/types';

const LABEL: Record<FacilityKind, string> = {
  hospital: 'Hospitals', clinic: 'Clinics', school: 'Schools', police: 'Police', fire: 'Fire & rescue', station: 'Rail stations',
};

interface Props {
  items: Facility[];
  scenario: Scenario;
  onShow?: (f: Facility) => void;
}

export const FacilityExposure: FC<Props> = ({ items, scenario, onShow }) => {
  const [open, setOpen] = useState<FacilityKind | null>(null);
  const rows = facilityExposure(items, scenario).filter(r => r.total > 0);
  if (!rows.length) return <div className="callout">No mapped facilities in this area.</div>;
  const high = (k: FacilityKind) => items.filter(f => f.k === k && classOf(f.s, scenario) === 3).sort((a, b) => a.n.localeCompare(b.n));
  return (
    <div>
      <table className="data">
        <thead>
          <tr>
            <th>Facility</th>
            <th className="num">Mapped</th>
            <th className="num"><span className="swatch-inline" style={{ background: RISK_COLOR.High }} />High</th>
            <th className="num"><span className="swatch-inline" style={{ background: RISK_COLOR.Moderate }} />Mod.</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.kind}>
              <td>
                {r.high > 0
                  ? <button className="link-btn" aria-expanded={open === r.kind} onClick={() => setOpen(open === r.kind ? null : r.kind)}>{LABEL[r.kind]} {open === r.kind ? '▾' : '▸'}</button>
                  : LABEL[r.kind]}
              </td>
              <td className="num">{r.total}</td>
              <td className="num" style={{ fontWeight: r.high ? 650 : 400 }}>{r.high}</td>
              <td className="num">{r.moderate}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {open && (
        <ul className="fac-list">
          {high(open).slice(0, 30).map(f => (
            <li key={`${f.n}-${f.c.join()}`}>
              {onShow ? <button className="link-btn" onClick={() => onShow(f)}>{f.n}</button> : f.n}
            </li>
          ))}
          {high(open).length > 30 && <li className="muted">+{high(open).length - 30} more</li>}
        </ul>
      )}
      <div className="source-line">{scenario.label} scenario. Facilities mapped from open data (OpenStreetMap via Overture) — may be incomplete.</div>
    </div>
  );
};
