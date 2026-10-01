import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../../app/AppController';
import { applyMonitoringThreshold, thresholdIds, type ThresholdId } from './monitoringCommands';

const labels: Record<ThresholdId, string> = {
  gpuUtilizationPct: 'H200 GPU utilization', gpuMemoryPct: 'H200 memory utilization',
  cpuUtilizationPct: 'Grace CPU utilization', fronthaulLatencyMs: 'vDU ↔ virtual RU latency',
};
type Thresholds = Record<ThresholdId, number>;
type MonitoringRecord = { id: string; project: unknown };

export default function MonitoringPreviewLeaf({ controller, record }: { controller: AppController; record: MonitoringRecord }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const active = snapshot.workspace?.projects.find(item => item.id === record.id);
  const project = (active?.project ?? record.project) as { management: { monitoring: { thresholds: Thresholds } } };
  const thresholds = project.management.monitoring.thresholds;
  const signature = thresholdIds.map(id => `${id}:${thresholds[id]}`).join('|');
  const [drafts, setDrafts] = useState<Partial<Record<ThresholdId, string>>>({});
  const [error, setError] = useState('');
  useEffect(() => { setDrafts({}); setError(''); }, [record.id, signature]);

  const change = (field: ThresholdId, value: string) => {
    setDrafts(previous => ({ ...previous, [field]: value }));
    try {
      const save = applyMonitoringThreshold(controller, record.id, field, value);
      if (!save) return;
      setError('');
      void save.catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDrafts(previous => ({ ...previous, [field]: String(thresholds[field]) }));
    }
  };

  return <section className="monitoring-preview" role="region" aria-label="Monitoring preview route">
    <header><div><p className="eyebrow">SYSTEM · OFFLINE</p><h1>Monitoring</h1>
      <p>Prepare observability thresholds and signal inventory for the future twin runtime.</p></div>
      <span className="mini-pill warn">NO DATA</span></header>
    <p className="artifacts-boundary">No hardware, RF, or protocol telemetry is flowing. Thresholds are targets, not measurements.</p>
    {error && <p role="alert">Input rejected · {error}</p>}
    <div className="ops-summary"><div><strong>0</strong><span>telemetry samples</span></div>
      <div><strong>4</strong><span>planned signals</span></div><div><strong>OFFLINE</strong><span>collector connection</span></div></div>
    <section className="panel"><header><div><h2>Signal status</h2><p>No hardware, RF, or protocol telemetry is flowing.</p></div>
      <span className="mini-pill warn">NO DATA</span></header>
      <div className="ops-signal-grid">{thresholdIds.map(id => <div className="ops-signal" key={id}>
        <small>{labels[id]}</small><strong>—</strong><span>NO DATA · alert at {thresholds[id]}{id.endsWith('Ms') ? 'ms' : '%'}</span>
      </div>)}</div>
      <p className="detail-copy">No chart line is drawn without timestamps and real samples. Monitoring labels are target contracts, not measurements.</p>
    </section>
    <div className="lower-grid"><section className="panel"><header><div><h2>Alert policy</h2><p>Thresholds only; no collector or notifications connected.</p></div></header>
      <div className="form-grid pad">{thresholdIds.map(id => <label className="form-field" key={id}>
        <span>{labels[id]} threshold ({id.endsWith('Ms') ? 'ms' : '%'})</span>
        <input type="number" min="1" max={id.endsWith('Ms') ? 500 : 100} aria-label={`${labels[id]} threshold`}
          value={drafts[id] ?? thresholds[id]} onChange={event => change(id, event.target.value)} />
      </label>)}</div>
      <p className="detail-copy">Alerts cannot fire until a verified telemetry source, timestamp policy, provenance, and alarm router are installed.</p>
    </section>
    <section className="panel"><header><div><h2>Future evidence inputs</h2><p>Separate real health from simulation output.</p></div></header>
      <div className="check-list">{['GH200 H200/Grace resource metrics', 'Sionna-RT job status and artifact freshness',
        'Virtual RU / UE process metrics', 'Real vDU ↔ virtual RU interface metrics',
        'Radio outputs with simulation-run provenance'].map(item => <div className="check-item" key={item}>
        <span className="check-icon">·</span><span>{item}</span><small>NO SOURCE</small></div>)}</div>
    </section></div>
  </section>;
}
