// Ginkgo Command Center — bottom bar: rain scenario, layer toggles, data status.

import type { FC } from 'react';
import { BUILT_RGB, HISTORY_RGB, RISK_COLOR, RIVER_COLOR } from '../../data/format';
import type { ModelSpec, ScenarioKey } from '../../data/types';
import type { LayerState } from './MapView';

interface Props {
  model: ModelSpec;
  scenario: ScenarioKey;
  onScenario: (k: ScenarioKey) => void;
  layers: LayerState;
  onLayers: (l: LayerState) => void;
  built: string;
  detailReady: boolean;
}

const rgb = ([r, g, b]: number[]) => `rgb(${r},${g},${b})`;

export const BottomBar: FC<Props> = ({ model, scenario, onScenario, layers, onLayers, built, detailReady }) => {
  const toggles: { key: keyof LayerState; label: string; title: string; color: string }[] = [
    { key: 'susceptibility', label: 'Susceptibility', title: 'Flood susceptibility classes (Stage 1 model)', color: RISK_COLOR.High },
    { key: 'showLow', label: 'Low class', title: 'Also shade the Low class', color: RISK_COLOR.Low },
    { key: 'history', label: 'Water history', title: 'Seen as water in some Landsat scenes, 1984–2021 (JRC GSW)', color: rgb(HISTORY_RGB) },
    { key: 'sites', label: 'Reported floods', title: 'Places reported flooded in Dec 2021, plus DEM-chosen hilly controls', color: '#111111' },
    { key: 'rivers', label: 'Rivers', title: 'Rivers, canals and named streams (OpenStreetMap)', color: RIVER_COLOR },
    { key: 'boundaries', label: 'Boundaries', title: 'Daerah boundaries; federal territories shown as excluded', color: '#111111' },
    { key: 'built', label: 'Built-up', title: 'Built-up land, ESA WorldCover 2021', color: rgb(BUILT_RGB) },
  ];
  return (
    <footer className="cc-bottom">
      <div className="group">
        <span className="group-label">Rain scenario</span>
        <div className="scenario-seg" role="group" aria-label="Rain scenario">
          {model.scenarios.map(s => (
            <button key={s.key} aria-pressed={scenario === s.key} onClick={() => onScenario(s.key)} title={s.note}>
              {s.label}
              <small>{s.rain}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="group">
        <span className="group-label">Layers</span>
        <div className="toggles">
          {toggles.map(t => (
            <button key={t.key} className="toggle" aria-pressed={layers[t.key]} title={t.title}
              disabled={t.key === 'showLow' && !layers.susceptibility}
              onClick={() => onLayers({ ...layers, [t.key]: !layers[t.key] })}>
              <i style={{ background: t.color }} />{t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="status">
        Data built {built}{detailReady ? '' : ' · loading terrain layers…'}<br />
        GLO-30 DEM · OSM/Overture · JRC GSW · WorldCover 2021 · DOSM 2020 + HRSL
      </div>
    </footer>
  );
};
