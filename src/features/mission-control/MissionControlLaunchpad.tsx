import type { buildMissionControlModel } from './missionControlModel';
import './mission-control.css';

type Tasks = Extract<ReturnType<typeof buildMissionControlModel>, { kind: 'ready' }>['tasks'];
type Route = 'map' | 'tasks' | 'hardware' | 'monitoring';
type Props = { tasks: Tasks; onNavigate: (route: Route) => void };

/** Navigation to planning workspaces never dispatches a task or starts a solver. */
export default function MissionControlLaunchpad({ tasks, onNavigate }: Props) {
  const steps: { route: Route; index: string; title: string; detail: string; action: string }[] = [
    { route: 'map', index: '01 / SCENE', title: 'Prepare the city map',
      detail: 'Set scope, sites and cell layout. Geometry validation is still pending.', action: 'Open map →' },
    { route: 'tasks', index: '02 / PLAN', title: `Review ${tasks.count} planned tasks`,
      detail: tasks.next ? `Next: ${tasks.next.title} · due ${tasks.next.dueDate}. Sequence dependencies.`
        : 'No tasks planned yet. Add one on the task board.', action: 'Open board →' },
    { route: 'hardware', index: '03 / RESOURCES', title: 'Define GH200 targets',
      detail: 'H200, Grace CPU and fronthaul have not been discovered.', action: 'Open inventory →' },
    { route: 'monitoring', index: '04 / OBSERVE', title: 'Prepare monitoring',
      detail: 'Thresholds are configurable. No collector or telemetry is connected.', action: 'Open signals →' },
  ];
  return <section className="mission-control-launchpad" role="region" aria-label="Planning next actions">
    <header><div><small>WORKFLOW STARTER</small><h2>Move from concept to a verifiable twin</h2>
      <p>Four connected planning steps. RAN deployment and telemetry still require external integration.</p></div>
      <span>PLANNING STEPS</span></header>
    <div className="mission-control-launch-steps">
      {steps.map(step => <button type="button" key={step.route} onClick={() => onNavigate(step.route)}>
        <span>{step.index}</span><strong>{step.title}</strong><small>{step.detail}</small><em>{step.action}</em>
      </button>)}
    </div>
  </section>;
}
