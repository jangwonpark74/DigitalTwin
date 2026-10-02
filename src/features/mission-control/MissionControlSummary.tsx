import type { buildMissionControlModel } from './missionControlModel';
import './mission-control.css';
import type { StudyGate } from './studyReadiness';
import type { PreviewRouteId } from '../../app/routeRegistry';

type Props = {
  model: ReturnType<typeof buildMissionControlModel>;
  onNavigate: (route: 'activity') => void;
};
type ReadyModel = Extract<Props['model'], { kind: 'ready' }>;

/** Split the overview sections so keyboard and reading order match the original route. */
export function MissionControlHero({ model }: { model: ReadyModel }) {
  const number = new Intl.NumberFormat('en-US');
  const metrics = [
    { label: 'SITES / CELLS', value: `${model.metrics.sites} / ${model.metrics.cells}`,
      detail: 'Three sectors per planned site' },
    { label: 'VIRTUAL UE LOAD', value: `${number.format(model.metrics.virtualUes)} UEs`,
      detail: 'Grace CPU software model · planned' },
    { label: 'COVERAGE PROXY', value: `${model.metrics.coveragePercent}%`,
      detail: 'Illustrative only · not Sionna-RT' },
    { label: 'CAPACITY PRESSURE', value: `${model.metrics.capacityPressure}%`,
      detail: 'Synthetic planning indicator' },
  ];
  return (
    <section className="mission-control-summary" aria-label="Mission Control summary">
      <header className="mission-control-title">
        <p>5G RAN DIGITAL TWIN / {model.cluster.toUpperCase()}</p>
        <h1>5G RAN twin mission control</h1>
        <p>Prepare a city-scale radio scene, virtualize the RAN edge, and inspect the site/cell design.</p>
        <small>{model.projectName} · {model.city} / {model.cluster}</small>
      </header>
      <div className="mission-control-boundary" role="note">
        <div><strong>Preparation workspace · RAN integration not connected</strong>
          <p>Local GeoJSON and Sionna-RT path jobs are available when a compatible runtime is configured. Real vCore / vDU, GH200 discovery, and calibrated RF results remain unverified.</p></div>
        <span>RAN OFFLINE</span>
      </div>
      <div className="mission-control-metrics" aria-label="Study inventory">
        {metrics.slice(0, 2).map(item => <article key={item.label}>
          <h2>{item.label}</h2><strong>{item.value}</strong><p>{item.detail}</p>
        </article>)}
      </div>
      <details className="study-illustrative-metrics"><summary>Illustrative planning indicators · demonstration formulas</summary>
        <p>These values are UI examples. They do not measure street or city-wide coverage and do not come from an executed RF model.</p>
        <div className="mission-control-metrics" aria-label="Illustrative planning metrics">{metrics.slice(2).map(item => <article key={item.label}>
          <h2>{item.label}</h2><strong>{item.value}</strong><p>{item.detail}</p></article>)}</div>
      </details>
    </section>
  );
}

export function MissionControlReadiness({ model, gates, onNavigate }: { model: ReadyModel; gates?: StudyGate[]; onNavigate?: (route: PreviewRouteId) => void }) {
  if (gates) return <section aria-label="Deployment readiness" className="mission-control-panel study-capabilities">
    <h2>Study capabilities</h2><p>Evidence is checked for each operation. Local simulation and connected RAN operations have separate prerequisites.</p>
    <ul aria-label="Study capability gates">{gates.map(gate => <li key={gate.id}>
      <div><strong>{gate.label}</strong><small data-status={gate.status}>{gate.status === 'ready' ? 'AVAILABLE' : gate.status === 'unknown' ? 'CHECK REQUIRED' : 'NEEDS EVIDENCE'}</small></div>
      <p>{gate.reason}</p><button type="button" onClick={() => onNavigate?.(gate.route)}>Review prerequisites →</button>
    </li>)}</ul>
  </section>;
  return <section aria-label="Deployment readiness" className="mission-control-panel">
    <h2>Deployment readiness</h2>
    <p>Evidence gates for an actual radio twin · {model.readiness.configured} / {model.readiness.total} GATES</p>
    <ul aria-label="Deployment readiness gates">
      {model.readiness.checks.map(check => <li key={check.id}>
        <span>{check.label}</span><small>{check.done ? 'CONFIGURED' : 'PENDING'}</small>
      </li>)}
    </ul>
    <p>No check is inferred from this browser mockup. A reference file or endpoint string does not prove import, calibration, or connectivity.</p>
  </section>;
}

export function MissionControlActivity({ model, onNavigate }: { model: ReadyModel; onNavigate: Props['onNavigate'] }) {
  return <section aria-label="Recent activity" className="mission-control-panel">
    <h2>Recent activity</h2><p>Local configuration actions only</p>
    {model.activity.length ? <ul>{model.activity.map((event, index) => <li key={`${event.when}:${index}`}>
      <strong>{event.title}</strong><small>{event.detail}</small>
    </li>)}</ul> : <p>No local configuration actions yet.</p>}
    <button type="button" onClick={() => onNavigate('activity')}>View all activity →</button>
  </section>;
}

/** An isolated summary for component tests and non-ready states; the page places its sections in route order. */
export default function MissionControlSummary({ model, onNavigate }: Props) {
  if (model.kind === 'loading') return <p role="status">Loading local workspace…</p>;
  if (model.kind === 'empty') return <p role="status">No active project is available.</p>;
  if (model.kind === 'invalid') return <p role="alert">Project configuration is invalid · {model.reason}</p>;
  return <div className="mission-control-summary">
    <MissionControlHero model={model} />
    <div className="mission-control-panels"><MissionControlReadiness model={model} />
      <MissionControlActivity model={model} onNavigate={onNavigate} /></div>
  </div>;
}
