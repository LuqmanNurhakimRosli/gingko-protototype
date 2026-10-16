// Ginkgo Command Center — top bar: brand, context, AI status, method link. (Search lives on the map.)

import type { FC } from 'react';
import type { Scenario } from '../../data/types';
import { modelName, providerName } from '../../copilot/models';
import type { SessionTotals } from '../../copilot/useAgent';

interface Props {
  scenario: Scenario;
  subjectLabel: string;
  onOpenMethod: () => void;
  aiMode: 'checking' | 'ai' | 'off';
  aiModel: string | null;
  aiProvider: string | null;
  totals: SessionTotals;
}

export const TopBar: FC<Props> = ({ scenario, subjectLabel, onOpenMethod, aiMode, aiModel, aiProvider, totals }) => (
  <header className="cc-top">
    <div className="brand-logo" aria-label="Ginkgo">
      <div className="brand-icon">G</div>
      <span>GINKGO</span>
    </div>
    <div className="nav-divider" />
    <div className="cc-context">
      <strong>Selangor</strong><span className="sep">·</span>
      <span>Riverine flood susceptibility</span><span className="sep">·</span>
      <span className="scenario-pill" title={scenario.note}>
        <i className={`sc-dot ${scenario.key}`} aria-hidden />{scenario.label} rain
      </span>
      <span className="sep">·</span>
      <span>{subjectLabel}</span>
    </div>
    <div className="cc-top-right">
      <span className={`ai-status ${aiMode}`} title={aiMode === 'ai'
        ? `AI copilot live${providerName(aiProvider) ? ` via ${providerName(aiProvider)}` : ''}${totals.answers ? ` · ${totals.answers} answer${totals.answers === 1 ? '' : 's'} this session, ≈US$${totals.costUsd.toFixed(2)}${totals.cachedRounds ? `, ${totals.cachedRounds} served from cache` : ''}` : ''}`
        : aiMode === 'off' ? 'No AI key on the server — template answers' : 'Checking the AI copilot…'}>
        <i aria-hidden />{aiMode === 'ai' ? modelName(aiModel) : aiMode === 'off' ? 'Template mode' : 'Checking AI…'}
      </span>
      <button className="btn btn-secondary btn-sm" onClick={onOpenMethod}>Method &amp; validation</button>
    </div>
  </header>
);
