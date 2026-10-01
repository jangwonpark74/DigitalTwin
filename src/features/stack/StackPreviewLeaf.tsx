import { useEffect, useState, useSyncExternalStore } from 'react';
import MissionControlArchitecture from '../mission-control/MissionControlArchitecture';
import type { AppController } from '../../app/AppController';
import { applyStackEndpoint } from './stackCommands';

type ProjectRecord = { id: string; name: string; project: unknown };
type Integration = { vCoreEndpoint: string; vDUEndpoint: string };

export default function StackPreviewLeaf({ controller, record }: { controller: AppController; record: ProjectRecord }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const integration = (record.project as { integration: Integration }).integration;
  const [vCoreEndpoint, setVCoreEndpoint] = useState(integration.vCoreEndpoint);
  const [vDUEndpoint, setVdUEndpoint] = useState(integration.vDUEndpoint);
  const [error, setError] = useState('');

  useEffect(() => {
    setVCoreEndpoint(integration.vCoreEndpoint);
    setVdUEndpoint(integration.vDUEndpoint);
    setError('');
  }, [record.id, integration.vCoreEndpoint, integration.vDUEndpoint]);

  const commit = (endpoint: 'vCoreEndpoint' | 'vDUEndpoint', value: string) => {
    try {
      const save = applyStackEndpoint(controller, record.id, endpoint, value);
      if (!save) return;
      setError('');
      void save.catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setVCoreEndpoint(integration.vCoreEndpoint);
      setVdUEndpoint(integration.vDUEndpoint);
    }
  };

  return <section className="stack-preview" role="region" aria-label="RAN topology preview route">
    <header><div><h1>Physical-to-virtual RAN stack</h1>
      <p>Trace what is real, what is virtualized, and where the radio channel model belongs.</p></div></header>
    <MissionControlArchitecture />
    <div className="lower-grid">
      <section className="panel" aria-labelledby="stack-integration-title">
        <header className="panel-header"><div><h2 id="stack-integration-title">Real network integration</h2>
          <p className="panel-caption">Configuration metadata; no authentication or live connection</p></div>
          <span className="mini-pill">NOT CONNECTED</span></header>
        <div className="form-grid pad">
          <label className="form-field"><span>vCore endpoint label</span><input type="text" aria-label="vCore endpoint label"
            placeholder="Unconfigured" value={vCoreEndpoint} onChange={event => setVCoreEndpoint(event.target.value)}
            onBlur={event => commit('vCoreEndpoint', event.currentTarget.value)} /></label>
          <label className="form-field"><span>vDU endpoint label</span><input type="text" aria-label="vDU endpoint label"
            placeholder="Unconfigured" value={vDUEndpoint} onChange={event => setVdUEndpoint(event.target.value)}
            onBlur={event => commit('vDUEndpoint', event.currentTarget.value)} /></label>
        </div>
        {error && <p role="alert">Stack setting rejected · {error}</p>}
        <p className="detail-copy">Do not enter credentials. This mockup stores labels locally but never contacts these endpoints. The intended handoff is real vCore → real vDU → virtual O-RAN RU.</p>
      </section>
      <section className="panel" aria-label="GH200 compute placement">
        <header className="panel-header"><div><h2>GH200 compute placement</h2>
          <p className="panel-caption">Target deployment allocation</p></div><span className="mini-pill">PLANNED</span></header>
        <div className="hardware-grid">
          <div><span>HOST</span><strong>GH200</strong><small>Target superchip platform</small></div>
          <div><span>GPU</span><strong>H200</strong><small>Sionna-RT channel / RF rendering target</small></div>
          <div><span>CPU</span><strong>Grace</strong><small>Software-based virtual UE workload</small></div>
        </div>
        <p className="detail-copy">Hardware discovery, job scheduling, RU execution and UE orchestration are not implemented in the browser prototype.</p>
      </section>
    </div>
  </section>;
}
