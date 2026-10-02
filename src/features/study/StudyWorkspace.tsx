import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { captureBaseline, createCandidate, engineeringInputs, reviseCandidate, saveStudyDefinition, scenarioFields, stableJson } from '../../../study.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import { mutateStudy } from './studyCommands';
import { baselinePayload, revisionPayload, studyState, type StudyChange, type StudySelection } from './studyTypes';
import './study.css';
type ProjectRecord = WorkspaceSnapshot['projects'][number];

type Props = { controller: AppController; record: ProjectRecord; onNavigate: (route: string) => void; initialPanel?: 'definition' | 'scenarios' };
export default function StudyWorkspace(props: Props) {
  return <StudyEditor key={props.record.id} {...props} />;
}
function StudyEditor({ controller, record, onNavigate, initialPanel = 'definition' }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const study = studyState(record.project), current = study?.definitions.at(-1);
  const [objective, setObjective] = useState(current?.objective ?? ''), [operator, setOperator] = useState(current?.operator ?? '');
  const [rat, setRat] = useState(current?.rat ?? 'NR'), [carrier, setCarrier] = useState(current?.carrierMhz?.toString() ?? '');
  const [windowStart, setWindowStart] = useState(current?.windowStart ?? ''), [windowEnd, setWindowEnd] = useState(current?.windowEnd ?? '');
  const [panel, setPanel] = useState(initialPanel);
  useEffect(() => setPanel(initialPanel), [initialPanel]);
  const [baselineName, setBaselineName] = useState('Baseline 1'), [candidateName, setCandidateName] = useState('Candidate 1');
  const [baseId, setBaseId] = useState(study?.baselines.at(-1)?.id ?? ''), [issue, setIssue] = useState('');
  const [siteId, setSiteId] = useState(''), [cellId, setCellId] = useState(''), [field, setField] = useState('heightM'), [after, setAfter] = useState('');
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const locked = busy || snapshot.status !== 'ready' || snapshot.dirty;
  const selection = study?.selection;
  const candidate = selection?.kind === 'candidate' ? study?.candidates.find(item => item.id === selection.id) : undefined;
  const revision = candidate?.versions.find(item => selection?.kind === 'candidate' && item.version === selection.version);
  const selectedBase = selection?.kind === 'baseline' ? study?.baselines.find(item => item.id === selection.id)
    : candidate ? study?.baselines.find(item => item.id === candidate.baselineId) : study?.baselines.at(-1);
  const baseline = useMemo(() => selectedBase ? baselinePayload(selectedBase) : null, [selectedBase]);
  const changes = useMemo(() => revision ? revisionPayload(revision).changes : [], [revision]);
  const workingMatches = useMemo(() => baseline && stableJson(engineeringInputs(record.project)) === stableJson(baseline.inputs), [baseline, record.project]);
  useEffect(() => { setAfter(''); setSiteId(''); setCellId(''); }, [candidate?.id, revision?.version]);
  const latest = Boolean(candidate && revision?.version === candidate.versions.length);
  const site = baseline?.inputs.sites.find(item => item.id === siteId) ?? baseline?.inputs.sites[0];
  const spec = scenarioFields[field as keyof typeof scenarioFields];
  const cell = site?.cells.find(item => item.id === cellId) ?? site?.cells[0];
  const baselineValue = spec.scope === 'site' ? site?.heightM : cell?.[field];
  const before = typeof baselineValue === 'number' ? baselineValue : undefined;
  const act = async (change: Parameters<typeof mutateStudy>[2], message: string) => {
    if (pending.current || locked) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await mutateStudy(controller, record.id, change, message); if (mounted.current) setNotice(message); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const select = (reference: StudySelection) => act(project => ({ ...project, study: { ...studyState(project), selection: reference } }), 'Study reference saved');
  const saveChanges = (next: StudyChange[] | { siteId: string; cellId?: string; field: string; after: number }[]) => {
    if (candidate && revision) void act(project => reviseCandidate(project, candidate.id, revision.version, next), `Candidate v${revision.version + 1} saved`);
  };
  const submitDefinition = (event: FormEvent) => {
    event.preventDefault();
    void act(project => saveStudyDefinition(project, { objective, operator, rat, carrierMhz: carrier.trim() ? Number(carrier) : null,
      windowStart: windowStart || null, windowEnd: windowEnd || null }), `Definition v${(current?.version ?? 0) + 1} saved`);
  };
  return <div className="study-workspace">
    <header className="study-page-header"><div><p className="study-eyebrow">ENGINEERING STUDY</p><h1>Study & scenarios</h1>
      <p>Define the decision, freeze the network inputs, then review candidate RF changes against that baseline.</p></div>
      <button type="button" onClick={() => onNavigate('planner')}>Review working network</button></header>
    <div className="study-tabs" role="group" aria-label="Study workspace panels">
      <button type="button" aria-pressed={panel === 'definition'} onClick={() => setPanel('definition')}>Definition & evidence</button>
      <button type="button" aria-pressed={panel === 'scenarios'} onClick={() => setPanel('scenarios')}>Baselines & candidates</button>
    </div>
    {error && <p role="alert" className="study-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {busy && <p role="status">Preparing and saving study inputs…</p>}
    <section className="study-definition" aria-label="Study definition" hidden={panel !== 'definition'}>
      <form onSubmit={submitDefinition}><h2>Decision and scope {current && <small>v{current.version}</small>}</h2>
        <fieldset disabled={locked}><label>Study objective<textarea required maxLength={500} value={objective} onChange={event => setObjective(event.target.value)} placeholder="Which network problem will this study evaluate?" /></label>
          <div className="study-form-grid"><label>Operator declaration<input required maxLength={120} value={operator} onChange={event => setOperator(event.target.value)} /></label>
            <label>Study RAT<select value={rat} onChange={event => setRat(event.target.value as typeof rat)}><option value="ALL">LTE + NR</option><option value="LTE">LTE</option><option value="NR">5G NR</option></select></label>
            <label>Carrier frequency (MHz)<input type="number" min={500} max={100000} step="any" value={carrier} onChange={event => setCarrier(event.target.value)} placeholder="Unspecified" /></label>
            <label>Observation window start<input type="date" value={windowStart} onChange={event => setWindowStart(event.target.value)} /></label>
            <label>Observation window end<input type="date" value={windowEnd} onChange={event => setWindowEnd(event.target.value)} /></label></div>
          <p className="study-helper">Operator and window are declarations. Saving retains the preceding definition version.</p>
          <button type="submit">Save study definition</button></fieldset>
      </form>
      <aside><h2>Evidence checklist</h2><p>{(record.project.driveMeasurements as { samples: unknown[] } | null)?.samples.length ?? 0} saved GPS samples</p>
        <p>A baseline retains the saved dataset and its provenance. Synthetic measurements remain ineligible for accepted physical calibration.</p>
        <button type="button" onClick={() => onNavigate('drive')}>Inspect drive evidence</button>
        <button type="button" onClick={() => onNavigate('map')}>Review geometry and positions</button>
        <button type="button" onClick={() => setPanel('scenarios')}>Continue to baselines</button>
        {current && <p className="study-helper">Definition history: {study?.definitions.map(item => `v${item.version}`).join(' · ')}</p>}
      </aside>
    </section>
    <section className="study-scenario-section" aria-label="Baselines and candidates" hidden={panel !== 'scenarios'}>
      <div className="study-create-grid">
        <details open={!study?.baselines.length}><summary>Capture baseline inputs</summary>
        <form onSubmit={event => { event.preventDefault(); void act(project => captureBaseline(project, baselineName), 'Baseline captured'); }}>
          <h2>Freeze a baseline</h2><p>Capture the saved working network, geometry, measurement evidence and current study definition.</p>
          <fieldset disabled={locked || !current}><label>Baseline name<input required maxLength={80} value={baselineName} onChange={event => setBaselineName(event.target.value)} /></label>
            <button type="submit">Capture baseline</button></fieldset>{!current && <p className="study-helper">Save the definition first.</p>}
        </form></details>
        <details open={!study?.candidates.length}><summary>Create a candidate scenario</summary>
        <form onSubmit={event => { event.preventDefault(); void act(project => createCandidate(project, baseId || study?.baselines.at(-1)?.id, candidateName, issue), 'Candidate v1 created'); }}>
          <h2>Create a candidate</h2><p>Reference a captured baseline. Candidate edits preserve the working network and every earlier revision.</p>
          <fieldset disabled={locked || !study?.baselines.length}><label>Candidate baseline<select value={baseId || study?.baselines.at(-1)?.id || ''} onChange={event => setBaseId(event.target.value)}>
            {!study?.baselines.length && <option value="">Capture a baseline first</option>}{study?.baselines.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label>Candidate name<input required maxLength={80} value={candidateName} onChange={event => setCandidateName(event.target.value)} /></label>
            <label>Linked issue / hypothesis<textarea maxLength={500} value={issue} onChange={event => setIssue(event.target.value)} placeholder="Weak street segment, interference or a planning hypothesis" /></label>
            <button type="submit">Create candidate</button></fieldset></form></details>
      </div>
      {study?.baselines.length ? <section className="study-library" aria-label="Baseline library"><h2>Baseline library <small>{study.baselines.length} snapshots</small></h2>
        <div className="study-table-scroll"><table><thead><tr><th>Baseline</th><th>Scope / evidence</th><th>Content identity</th><th>Reference</th></tr></thead><tbody>
          {study.baselines.map(item => { const value = baselinePayload(item), dataset = value.inputs.driveMeasurements;
            return <tr key={item.id}><td><strong>{item.name}</strong><small>{new Date(item.createdAt).toLocaleString()}</small></td>
              <td>Definition v{value.definition.version} · {value.inputs.sites.length} sites<small>{dataset ? `${dataset.samples.length} GPS samples · ${dataset.evidence?.origin ?? 'origin unknown'}` : 'No GPS dataset'}</small></td>
              <td><code title={item.sha256}>{item.sha256.slice(0, 12)}…</code></td><td><button type="button" disabled={locked} aria-pressed={selection?.kind === 'baseline' && selection.id === item.id} onClick={() => void select({ kind: 'baseline', id: item.id })}>Reference {item.name}</button></td></tr>; })}
        </tbody></table></div></section> : <p className="study-empty">No baseline captured. The network remains a working draft.</p>}
      {study?.candidates.length ? <section className="study-candidate-editor" aria-label="Candidate revision editor">
        <header><h2>Candidate review</h2><label>Candidate revision<select disabled={locked} value={selection?.kind === 'candidate' ? `${selection.id}:${selection.version}` : ''} onChange={event => {
          const [id, version] = event.target.value.split(':'); if (id) void select({ kind: 'candidate', id, version: Number(version) });
        }}><option value="">Choose a saved revision</option>{study.candidates.flatMap(item => item.versions.map(version =>
          <option key={`${item.id}:${version.version}`} value={`${item.id}:${version.version}`}>{item.name} · v{version.version}{version.version === item.versions.length ? ' (latest)' : ''}</option>))}</select></label></header>
        {candidate && revision && baseline && <><p>Baseline <strong>{selectedBase?.name}</strong> · definition v{baseline.definition.version} · candidate v{revision.version} · {changes.length} RF changes</p>
          <p className="study-helper">{workingMatches ? 'Working network matches the captured inputs.' : 'Working network has changed since this capture. The baseline retains its original inputs.'}</p>
          {revisionPayload(revision).issue && <p>Issue / hypothesis: {revisionPayload(revision).issue}</p>}
          {!latest && <p>Historical revision is read-only. Select the latest revision to continue editing.</p>}
          <form className="study-rf-form" onSubmit={event => { event.preventDefault(); if (!site) return; const identity = spec.scope === 'cell' ? cell?.id : undefined;
            saveChanges([...changes.filter(change => !(change.siteId === site.id && change.cellId === identity && change.field === field)), { siteId: site.id, ...(identity ? { cellId: identity } : {}), field, after: Number(after) }]); }}>
            <fieldset disabled={locked || !latest}><div className="study-form-grid"><label>Candidate site<select value={site?.id ?? ''} onChange={event => { setSiteId(event.target.value); setCellId(''); }}>{baseline.inputs.sites.map(item => <option key={item.id} value={item.id}>{item.id} · {item.name}</option>)}</select></label>
              <label>RF parameter<select value={field} onChange={event => { setField(event.target.value); setAfter(''); }}>{Object.entries(scenarioFields).map(([id, value]) => <option key={id} value={id}>{value.label} ({value.unit})</option>)}</select></label>
              {spec.scope === 'cell' && <label>Candidate sector<select value={cell?.id ?? ''} onChange={event => setCellId(event.target.value)}>{site?.cells.map(item => <option key={item.id} value={item.id}>{item.id}</option>)}</select></label>}
              <label>Candidate value<input required type="number" min={spec.min} max={spec.max} step="any" value={after} onChange={event => setAfter(event.target.value)} placeholder={`Baseline ${before ?? ''} ${spec.unit}`} /></label></div>
              <button type="submit">Save candidate revision</button></fieldset></form>
          {changes.length ? <div className="study-table-scroll"><table aria-label="Exact candidate changes"><thead><tr><th>Site / sector</th><th>Parameter</th><th>Baseline</th><th>Candidate</th><th>Delta</th><th>Action</th></tr></thead><tbody>
            {changes.map(change => { const fieldSpec = scenarioFields[change.field as keyof typeof scenarioFields]; return <tr key={`${change.siteId}:${change.cellId}:${change.field}`}>
              <td>{change.cellId ?? change.siteId}</td><td>{fieldSpec.label}</td><td>{change.before} {fieldSpec.unit}</td><td>{change.after} {fieldSpec.unit}</td>
              <td>{Number((change.after - change.before).toFixed(4))} {fieldSpec.unit}</td><td><button type="button" disabled={locked || !latest} aria-label={`Revert ${fieldSpec.label} for ${change.cellId ?? change.siteId}`} onClick={() => saveChanges(changes.filter(item => item !== change))}>Revert</button></td></tr>; })}
          </tbody></table></div> : <p className="study-empty">No RF changes in this revision.</p>}
          <details><summary>Revision content identity</summary><code className="study-digest">{revision.sha256}</code><p>{revision.createdAt} · {candidate.versions.length} retained revisions</p></details>
          <p className="study-capability">Propagation can run this captured revision with one isotropic transmitter. A candidate height change applies only to the selected transmitter; sector power, tilt, azimuth, bandwidth and other-site changes block execution. Path output remains uncalibrated.</p>
          <button type="button" onClick={() => onNavigate('ray')}>Review propagation inputs</button>
        </>}
      </section> : null}
    </section>
  </div>;
}
