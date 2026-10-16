// Ginkgo Command Center — top bar: brand, context, method link. (Search lives on the map.)

import type { FC } from 'react';
import type { Scenario } from '../../data/types';

interface Props {
  scenario: Scenario;
  subjectLabel: string;
  onOpenMethod: () => void;
}

export const TopBar: FC<Props> = ({ scenario, subjectLabel, onOpenMethod }) => (
  <header className="cc-top">
    <div className="brand-logo" aria-label="Ginkgo">
      <div className="brand-icon">G</div>
      <span>GINKGO</span>
    </div>
    <div className="nav-divider" />
    <div className="cc-context">
      <strong>Selangor</strong><span className="sep">·</span>
      <span>Riverine flood susceptibility</span><span className="sep">·</span>
      <span className="scenario-pill" title={scenario.note}>Scenario: {scenario.label}</span>
      <span className="sep">·</span>
      <span>{subjectLabel}</span>
    </div>
    <div className="cc-top-right">
      <button className="btn btn-secondary btn-sm" onClick={onOpenMethod}>Method &amp; validation</button>
    </div>
  </header>
);
