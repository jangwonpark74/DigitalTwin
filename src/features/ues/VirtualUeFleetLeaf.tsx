import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../../app/AppController';
import { applyUeField, type UeField } from './uesCommands';

type UeProject = { ue: { count: number; mobility: string; seed: number }; sites: { id: string; name: string }[] };
type ProjectRecord = { id: string; name: string; project: unknown };

export default function VirtualUeFleetLeaf({ controller, record, onSiteSelect, onError }: {
  controller: AppController;
  record: ProjectRecord;
  onSiteSelect: (siteId: string) => void;
  onError: (message: string) => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const project = record.project as UeProject;
  const [count, setCount] = useState(String(project.ue.count));
  const [mobility, setMobility] = useState(project.ue.mobility as string);
  const [seed, setSeed] = useState(String(project.ue.seed));
  const [error, setError] = useState('');
  const number = new Intl.NumberFormat('en-US');

  useEffect(() => {
    setCount(String(project.ue.count));
    setMobility(project.ue.mobility);
    setSeed(String(project.ue.seed));
    setError('');
  }, [record.id, project.ue.count, project.ue.mobility, project.ue.seed]);

  const commit = (field: UeField, value: string) => {
    try {
      const save = applyUeField(controller, record.id, field, value);
      if (!save) return;
      setError('');
      void save.then(() => onError('')).catch(cause => {
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(message);
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message);
      setCount(String(project.ue.count));
      setSeed(String(project.ue.seed));
      setMobility(project.ue.mobility);
    }
  };

  const sites = project.sites;
  const allocations = sites.map((site, index) => ({ site, count: Math.floor(project.ue.count / sites.length)
    + (index < project.ue.count % sites.length ? 1 : 0) }));

  return <section className="ues-preview" role="region" aria-label="Virtual UE fleet preview route">
    <header><div><h1>Virtual UE fleet</h1><p>{record.name} · planned software UE population for the Grace CPU target</p></div></header>
    <p className="artifacts-boundary">UE entities are virtual software models targeted to Grace CPU. No real or emulated 5G protocol stack is running.</p>
    <div className="lower-grid">
      <section className="panel" aria-labelledby="ue-config-title">
        <header className="panel-header"><div><h2 id="ue-config-title">UE workload configuration</h2>
          <p className="panel-caption">No UE processes are running in the browser</p></div><span className="mini-pill">CPU TARGET</span></header>
        <div className="form-grid pad">
          <label className="form-field"><span>UE population</span><input aria-label="UE population" type="number" min="1" max="50000"
            value={count} onChange={event => setCount(event.target.value)} onBlur={event => commit('count', event.currentTarget.value)} /></label>
          <label className="form-field"><span>Mobility profile</span><select aria-label="Mobility profile" value={mobility}
            onChange={event => { setMobility(event.target.value); commit('mobility', event.target.value); }}>
            {['Urban pedestrian', 'Static hotspots', 'Vehicular cluster'].map(option => <option key={option}>{option}</option>)}
          </select></label>
          <label className="form-field"><span>Reproducibility seed</span><input aria-label="Reproducibility seed" type="number" min="0" max="999999"
            value={seed} onChange={event => setSeed(event.target.value)} onBlur={event => commit('seed', event.currentTarget.value)} /></label>
        </div>
        {error && <p role="alert">UE setting rejected · {error}</p>}
        <p className="detail-copy">Fleet settings are stored as a project plan. CPU runtime, protocol stack, attachment, mobility and KPI collection need a separate execution backend.</p>
      </section>
      <section className="panel" aria-label="Fleet allocation preview">
        <header className="panel-header"><div><h2>Fleet allocation preview</h2>
          <p className="panel-caption">Planning-only distribution by selected sites</p></div><span className="mini-pill">{number.format(project.ue.count)} PLANNED</span></header>
        <div className="site-rows">{allocations.map(({ site, count: allocated }) => <button type="button" className="site-row" key={site.id}
          data-site-select={site.id} onClick={() => onSiteSelect(site.id)}><span><strong>{site.name}</strong><small>{site.id} · 3 sectors</small></span>
          <b>{number.format(allocated)} UEs</b></button>)}</div>
        <p className="detail-copy">Even distribution for layout preview. Mobility, association, interference, scheduling and KPI collection require an actual UE/RAN simulation backend.</p>
      </section>
    </div>
  </section>;
}
