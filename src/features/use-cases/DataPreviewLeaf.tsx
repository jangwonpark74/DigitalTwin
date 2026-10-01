import { useEffect, useState, useSyncExternalStore } from 'react';
import { DATA_TASKS, datasetPlan } from '../../../usecases.mjs';
import type { AppController } from '../../app/AppController';
import { applyDataField, type DataField } from './dataCommands';

type RecordItem = { id: string; name: string; project: unknown };
type DataConfig = { task: string; sampleBudget: number; sceneVariants: number; seeds: number[];
  split: { train: number; validation: number; test: number } };
type Project = { useCases: { data: DataConfig } };
type Draft = { task: string; sampleBudget: string; sceneVariants: string; seeds: string;
  train: string; validation: string; test: string };
const draftFor = (config: DataConfig): Draft => ({ task: config.task, sampleBudget: String(config.sampleBudget),
  sceneVariants: String(config.sceneVariants), seeds: config.seeds.join(', '), train: String(config.split.train),
  validation: String(config.split.validation), test: String(config.split.test) });
const numericInputs: { field: DataField; label: string; min: number; max: number }[] = [
  { field: 'sampleBudget', label: 'Planned sample budget', min: 100, max: 1_000_000 },
  { field: 'sceneVariants', label: 'Scene variants', min: 1, max: 100 },
  { field: 'split.train', label: 'Train (%)', min: 5, max: 90 },
  { field: 'split.validation', label: 'Validation (%)', min: 5, max: 90 },
  { field: 'split.test', label: 'Test (%)', min: 5, max: 90 },
];
const valueFor = (draft: Draft, field: DataField) => field === 'split.train' ? draft.train
  : field === 'split.validation' ? draft.validation : field === 'split.test' ? draft.test : draft[field];
const draftKey = (field: DataField): keyof Draft => field === 'split.train' ? 'train'
  : field === 'split.validation' ? 'validation' : field === 'split.test' ? 'test' : field;

export default function DataPreviewLeaf({ controller, record, onExport }: {
  controller: AppController; record: RecordItem; onExport: () => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const project = record.project as Project;
  const config = project.useCases.data;
  const plan = datasetPlan(project) as { task: string; requiredMode: string; requestedColumns: { features: string[]; labels: string[] };
    labels: string[]; plannedRows: number; generatedRows: number; plannedSplitRows: { train: number; validation: number; test: number };
    outputFormat: string; provenanceFields: string[]; leakageRule: string };
  const taskLabels = DATA_TASKS as Record<string, { name: string }>;
  const [draft, setDraft] = useState(() => draftFor(config));
  const [error, setError] = useState('');
  useEffect(() => { setDraft(draftFor(config)); setError(''); }, [record.id, config.task, config.sampleBudget, config.sceneVariants,
    config.seeds.join(','), config.split.train, config.split.validation, config.split.test]);

  const commit = (field: DataField, value: string) => {
    try {
      const save = applyDataField(controller, record.id, field, value);
      if (!save) return;
      setError('');
      void save.catch(() => undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDraft(draftFor(config));
    }
  };

  return <section className="usecase-preview" role="region" aria-label="Dataset generation preview route">
    <header><div><h1>AI-RAN data generation</h1>
      <p>Specify a reproducible dataset contract; generate labels only after verified simulation jobs exist.</p></div></header>
    <ol className="workflow-steps" aria-label="Dataset preparation workflow">
      {['Choose AI task', 'Lock scenes / seeds', 'Run EM or EM+RAN', 'Validate + split by group'].map(step => <li key={step}>{step}</li>)}
    </ol>
    <div className="lower-grid">
      <section className="panel" aria-labelledby="data-design-title">
        <header className="panel-header"><div><h2 id="data-design-title">Dataset job design</h2>
          <p className="panel-caption">Schema and capacity budget only; generated rows remain zero</p></div><span className="mini-pill">PARQUET TARGET</span></header>
        <div className="form-grid pad">
          <label className="form-field"><span>Learning task</span><select aria-label="Learning task" value={draft.task}
            onChange={event => { setDraft(previous => ({ ...previous, task: event.target.value })); commit('task', event.target.value); }}>
            {Object.entries(taskLabels).map(([id, task]) => <option key={id} value={id}>{task.name}</option>)}
          </select></label>
          {numericInputs.slice(0, 2).map(input => <label className="form-field" key={input.field}><span>{input.label}</span>
            <input type="number" aria-label={input.label} min={input.min} max={input.max} value={valueFor(draft, input.field)}
              onChange={event => setDraft(previous => ({ ...previous, [draftKey(input.field)]: event.target.value }))}
              onBlur={event => commit(input.field, event.currentTarget.value)} />
          </label>)}
          <label className="form-field"><span>Simulation seeds</span><input type="text" aria-label="Simulation seeds"
            placeholder="11, 22, 33" value={draft.seeds} onChange={event => setDraft(previous => ({ ...previous, seeds: event.target.value }))}
            onBlur={event => commit('seeds', event.currentTarget.value)} /></label>
          {numericInputs.slice(2).map(input => <label className="form-field" key={input.field}><span>{input.label}</span>
            <input type="number" aria-label={input.label} min={input.min} max={input.max} value={valueFor(draft, input.field)}
              onChange={event => setDraft(previous => ({ ...previous, [draftKey(input.field)]: event.target.value }))}
              onBlur={event => commit(input.field, event.currentTarget.value)} />
          </label>)}
        </div>
        {error && <p role="alert">Dataset setting rejected · {error}</p>}
        <p className="detail-copy">Split ratios must sum to 100. Seed, scene and route groups must not straddle train and holdout partitions.</p>
      </section>
      <section className="panel" aria-labelledby="data-contract-title">
        <header className="panel-header"><div><h2 id="data-contract-title">Data contract</h2>
          <p className="panel-caption">{taskLabels[config.task]?.name} · requires {plan.requiredMode} simulation mode</p></div>
          <span className="mini-pill">0 ROWS GENERATED</span></header>
        <div className="uc-schema"><div><span>FEATURE COLUMNS</span>{plan.requestedColumns.features.map(column => <code key={column}>{column}</code>)}</div>
          <div><span>LABEL COLUMNS</span>{plan.labels.map(column => <code key={column}>{column}</code>)}</div></div>
        <div className="data-row"><span>Planned rows / generated rows</span><strong>{new Intl.NumberFormat('en-US').format(plan.plannedRows)} / {plan.generatedRows}</strong></div>
        <div className="data-row"><span>Train / validation / test plan</span><strong>{plan.plannedSplitRows.train} / {plan.plannedSplitRows.validation} / {plan.plannedSplitRows.test}</strong></div>
        <div className="data-row"><span>Output format</span><strong>{plan.outputFormat.toUpperCase()} · planned</strong></div>
        <p className="artifacts-boundary">No generated samples, labels, or Parquet files exist in this prototype.</p>
        <div className="pad"><button type="button" className="button outline" onClick={onExport}>⇩ Export dataset job spec</button></div>
      </section>
    </div>
    <section className="panel" aria-labelledby="data-provenance-title">
      <header className="panel-header"><div><h2 id="data-provenance-title">Provenance &amp; leakage guard</h2>
        <p className="panel-caption">Required columns for any future dataset artifact</p></div><span className="mini-pill">REVIEW BEFORE TRAINING</span></header>
      <div className="uc-tags">{plan.provenanceFields.map(field => <code key={field}>{field}</code>)}</div>
      <p className="detail-copy">{plan.leakageRule} EM-only results must not be presented as handover, scheduler or throughput ground truth.</p>
    </section>
  </section>;
}
