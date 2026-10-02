import type { StudyAction } from './studyReadiness';
import type { PreviewRouteId } from '../../app/routeRegistry';
import './mission-control.css';

export default function MissionControlLaunchpad({ actions, onNavigate }: {
  actions: StudyAction[]; onNavigate: (route: PreviewRouteId) => void;
}) {
  const next = actions.findIndex(action => action.status === 'pending');
  return <section className="mission-control-launchpad" role="region" aria-label="Planning next actions">
    <header><div><small>ENGINEERING WORKFLOW</small><h2>Continue your radio study</h2>
      <p>Import evidence → review baseline → diagnose → prepare a scenario → execute → compare → review.</p></div>
      <span>OFFLINE STUDY</span></header>
    <div className="mission-control-launch-steps">
      {actions.map((action, index) => <button type="button" key={action.route} data-next-action={index === next} onClick={() => onNavigate(action.route)}>
        <span>{String(index + 1).padStart(2, '0')} / {index === next ? 'NEXT ACTION' : action.status === 'ready' ? 'AVAILABLE' : 'PREPARATION'}</span>
        <strong>{action.title}</strong><small>{action.detail}</small><em>Open workspace →</em>
      </button>)}
    </div>
  </section>;
}
