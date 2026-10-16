// Ginkgo Command Center — bottom bar: rain scenario and data status.
// (Map layers live in the map's layers panel and quick chips.)

import type { FC } from 'react';
import type { ModelSpec, ScenarioKey } from '../../data/types';

interface Props {
  model: ModelSpec;
  scenario: ScenarioKey;
  onScenario: (k: ScenarioKey) => void;
  built: string;
  detailReady: boolean;
}

export const ScenarioPicker: FC<Pick<Props, 'model' | 'scenario' | 'onScenario'>> = ({ model, scenario, onScenario }) => (
  <div className="scenario-seg" role="group" aria-label="Rain scenario">
    {model.scenarios.map(s => (
      <button key={s.key} aria-pressed={scenario === s.key} onClick={() => onScenario(s.key)} title={s.note}>
        {s.label}
        <small>{s.rain}</small>
      </button>
    ))}
  </div>
);

export const BottomBar: FC<Props> = ({ model, scenario, onScenario, built, detailReady }) => (
  <footer className="cc-bottom">
    <div className="group">
      <span className="group-label">Rain scenario</span>
      <ScenarioPicker model={model} scenario={scenario} onScenario={onScenario} />
    </div>
    <div className="status">
      Data built {built}{detailReady ? '' : ' · loading terrain layers…'}<br />
      GLO-30 DEM · OSM/Overture · JRC GSW · WorldCover 2021 · DOSM 2020 + HRSL · Susceptibility, not a forecast
    </div>
  </footer>
);
