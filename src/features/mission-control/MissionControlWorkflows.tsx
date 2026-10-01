import { USE_CASE_CARD_ITEMS } from '../../../usecase-ui.mjs';
import './mission-control.css';

type Props = { onNavigate: (route: 'drive' | 'ab' | 'data') => void };

/** Shared entry labels only; opening a workspace does not execute its plan. */
export default function MissionControlWorkflows({ onNavigate }: Props) {
  return <section className="mission-control-workflows" role="region" aria-label="Operational use cases">
    <header><div><h2>Operational use cases</h2>
      <p>Distinct planning workflows for drive tests, paired releases, and AI-RAN datasets</p></div>
      <span>3 WORKFLOWS</span></header>
    <div className="mission-control-workflow-cards">
      {USE_CASE_CARD_ITEMS.map(([id, icon, title, description]) => <button type="button" key={id}
        onClick={() => onNavigate(id)}>
        <span aria-hidden="true">{icon}</span><strong>{title}</strong><small>{description}</small><em>Open workspace →</em>
      </button>)}
    </div>
  </section>;
}
