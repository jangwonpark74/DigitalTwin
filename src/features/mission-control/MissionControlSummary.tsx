import type { buildMissionControlModel } from './missionControlModel';
import './mission-control.css';

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
      <div className="mission-control-metrics" aria-label="Illustrative planning metrics">
        {metrics.map(item => <article key={item.label}>
          <h2>{item.label}</h2><strong>{item.value}</strong><p>{item.detail}</p>
        </article>)}
      </div>
    </section>
  );
}

export function MissionControlReadiness({ model }: { model: ReadyModel }) {
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
