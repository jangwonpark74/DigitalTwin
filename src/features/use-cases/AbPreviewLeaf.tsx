import { useEffect, useState, useSyncExternalStore } from 'react';
import { abPlan } from '../../../usecases.mjs';
import type { AppController } from '../../app/AppController';
import { applyAbField, type AbField } from './abCommands';

type RecordItem = { id: string; name: string; project: unknown };
type AbConfig = { packageA: string; packageB: string; seeds: number[]; guardrailDropPct: number; minSinrGainDb: number };
type Project = { useCases: { ab: AbConfig }; sites: { id: string }[] };
type Draft = Record<AbField, string>;
const draftFor = (config: AbConfig): Draft => ({ packageA: config.packageA, packageB: config.packageB,
  seeds: config.seeds.join(', '), guardrailDropPct: String(config.guardrailDropPct), minSinrGainDb: String(config.minSinrGainDb) });
const inputs: { field: AbField; label: string; type: 'text' | 'number'; min?: number; max?: number; step?: number }[] = [
  { field: 'packageA', label: 'Package A · baseline', type: 'text' },
  { field: 'packageB', label: 'Package B · candidate', type: 'text' },
  { field: 'seeds', label: 'Paired random seeds', type: 'text' },
  { field: 'guardrailDropPct', label: 'Max throughput drop (%)', type: 'number', min: 0, max: 50, step: 0.1 },
  { field: 'minSinrGainDb', label: 'Min SINR gain (dB)', type: 'number', min: -20, max: 20, step: 0.1 },
];

export default function AbPreviewLeaf({ controller, record, onExport }: {
  controller: AppController; record: RecordItem; onExport: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const project = record.project as Project;
  const config = project.useCases.ab;
  const plan = abPlan(project) as { pairs: { pairId: string; a: { siteId: string; seed: number; packageId: string }; b: { packageId: string } }[];
    commonInputs: string[] };
  const [draft, setDraft] = useState(() => draftFor(config));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(draftFor(config)); setError(''); }, [record.id, config.packageA, config.packageB,
    config.seeds.join(','), config.guardrailDropPct, config.minSinrGainDb]);

  const commit = (field: AbField, value: string) => {
    try {
      const save = applyAbField(controller, record.id, field, value);
      if (!save) return;
      setError('');
      void save.catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDraft(draftFor(config));
    }
  };

  return <section className="usecase-preview" role="region" aria-label="A/B experiment preview route">
    <header><div><h1>Package A/B test</h1>
      <p>Design a paired, seed-controlled comparison without claiming a winner.</p></div></header>
    <ol className="workflow-steps" aria-label="A/B experiment workflow">
      {['Lock scene + cells', 'Pair A/B on identical seeds', 'Run both packages', 'Apply guardrails + review'].map(step => <li key={step}>{step}</li>)}
    </ol>
    <div className="lower-grid">
      <section className="panel" aria-labelledby="ab-release-title">
        <header className="panel-header"><div><h2 id="ab-release-title">Release candidates</h2>
          <p className="panel-caption">Identifiers only; packages are not installed or executed</p></div><span className="mini-pill">PAIRED DESIGN</span></header>
        <div className="form-grid pad">{inputs.map(input => <label className="form-field" key={input.field}>
          <span>{input.label}</span><input type={input.type} aria-label={input.label} min={input.min} max={input.max} step={input.step}
            maxLength={input.type === 'text' && input.field !== 'seeds' ? 40 : undefined}
            placeholder={input.field === 'seeds' ? '42, 43, 44' : undefined} value={draft[input.field]}
            onChange={event => setDraft(previous => ({ ...previous, [input.field]: event.target.value }))}
            onBlur={event => commit(input.field, event.currentTarget.value)} />
        </label>)}</div>
        {error && <p role="alert">A/B setting rejected · {error}</p>}
        <p className="detail-copy">Package IDs represent versioned build artifacts. A fair trial requires the same site/cell settings, scene, UE routes, channel realization and traffic on both arms.</p>
      </section>
      <section className="panel" aria-labelledby="ab-contract-title">
        <header className="panel-header"><div><h2 id="ab-contract-title">Decision contract</h2>
          <p className="panel-caption">Do not publish a winner before paired results and model review</p></div><span className="mini-pill">NO VERDICT</span></header>
        <div className="uc-placeholder wide"><span>Cell-edge throughput Δ</span><strong>—</strong><span>SINR Δ</span><strong>—</strong>
          <span>Handover success Δ</span><strong>—</strong><span>Guardrail verdict</span><strong>PENDING</strong></div>
        <ul className="check-list">{plan.commonInputs.map(item => <li className="check-item" key={item}><span aria-hidden="true">·</span>
          <span>{item}</span><small>LOCK FOR BOTH</small></li>)}</ul>
        <p className="artifacts-boundary">Paired RAN execution and comparable KPI artifacts are required. This preview exports the test plan, not A/B results.</p>
        <div className="pad"><button type="button" className="button outline" onClick={onExport}>⇩ Export A/B experiment plan</button></div>
      </section>
    </div>
    <section className="panel" aria-labelledby="ab-matrix-title">
      <header className="panel-header"><div><h2 id="ab-matrix-title">Paired run matrix</h2>
        <p className="panel-caption">{plan.pairs.length} planned site × seed pairs · each pair has two package arms</p></div><span className="mini-pill">SAME INPUTS</span></header>
      <div className="table-wrap" role="region" aria-label="Paired run matrix table" tabIndex={0}>
        <table className="data-table"><thead><tr><th>PAIR</th><th>SITE</th><th>SEED</th><th>ARM A</th><th>ARM B</th><th>STATE</th></tr></thead>
          <tbody>{plan.pairs.map(pair => <tr key={pair.pairId} data-testid="paired-run"><td>{pair.pairId}</td><td>{pair.a.siteId}</td>
            <td>{pair.a.seed}</td><td>{pair.a.packageId}</td><td>{pair.b.packageId}</td><td>NOT RUN</td></tr>)}</tbody></table>
      </div>
    </section>
  </section>;
}
