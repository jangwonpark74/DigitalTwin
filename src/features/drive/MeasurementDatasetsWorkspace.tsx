import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { DM_METRICS } from '../../../dm.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { PreviewRouteId } from '../../app/routeRegistry';
import DriveImportReview from './DriveImportReview';
import { commitDriveImport, retainCurrentMeasurement, selectWorkingMeasurement, saveCellIdentity } from './driveImportCommands';
import { cellIdentityRows } from '../../../cell-identity.mjs';
import CellIdentityReview from './CellIdentityReview';
import type { CellIdentityBinding, IdentitySite } from './cellIdentityTypes';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';
import type { DriveImportPreview } from './driveImport';
import type { SiteSceneProject } from '../site-planner/OpenSiteScene';
import './measurement-datasets.css';

type Props = { controller: AppController; record: WorkspaceSnapshot['projects'][number]; onNavigate: (route: PreviewRouteId) => void };
type Dataset = { fileName: string; samples: { servingCell: string; latitude: number; longitude: number; [key: string]: unknown }[];
  evidence?: { origin: string; rawCsv: string; sha256: string; normalizationSha256?: string; sourceDate: string | null; importedAt: string; transformations: { mapping?: Record<string, { column: string | null; unit: string | null }> }[] } };
type Entry = { id: string; version: number; registeredAt: string; inputJson: string; sha256: string };
type Library = { schemaVersion: 1; records: Entry[]; activeId: string | null };
const origin = (data: Dataset) => data.evidence?.origin ?? (/synthetic(?:[-_ .]|$)/i.test(data.fileName) ? 'synthetic' : 'unknown');
function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MeasurementDatasetsWorkspace(props: Props) { return <DatasetLibrary key={props.record.id} {...props} />; }
function DatasetLibrary({ controller, record, onNavigate }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const library = record.project.measurementLibrary as Library | undefined, current = record.project.driveMeasurements as Dataset | null;
  const entries = useMemo(() => library?.records.map(entry => ({ ...entry, data: JSON.parse(entry.inputJson) as Dataset })) ?? [], [library]);
  const [selectedId, setSelectedId] = useState(library?.activeId ?? ''), [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false);
  const [identityReview, setIdentityReview] = useState(false);
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (!entries.some(entry => entry.id === selectedId)) setSelectedId(library?.activeId ?? entries.at(-1)?.id ?? ''); }, [entries, library?.activeId, selectedId]);
  const selected = entries.find(entry => entry.id === selectedId), data = selected?.data;
  const locked = busy || snapshot.status !== 'ready' || snapshot.dirty;
  const cellIds = ((record.project.sites ?? []) as { cells: { id: string }[] }[]).flatMap(site => site.cells.map(cell => cell.id));
  const identityRows = data ? cellIdentityRows(data, record.project.sites) : [];
  const unmatched = identityRows.filter(row => !row.cellId);
  const act = async (action: () => Promise<void>, message: string) => {
    if (pending.current || locked) return;
    pending.current = true; setBusy(true); setError(''); setNotice('');
    try { await action(); if (mounted.current) setNotice(message); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  const importDataset = async (measurements: DriveImportPreview['measurements']) => {
    await commitDriveImport(controller, record.id, measurements);
    if (mounted.current) { setFile(null); setNotice('Measurement dataset retained and selected'); setSelectedId((controller.getSnapshot().workspace?.projects.find(item => item.id === record.id)?.project.measurementLibrary as Library)?.activeId ?? ''); }
  };
  const saveIdentity = async (bindings: CellIdentityBinding[]) => {
    if (pending.current || locked || !selected) throw new Error('Dataset review is busy. Wait for the current save.');
    pending.current = true; setBusy(true);
    try {
      await saveCellIdentity(controller, record.id, selected.id, bindings);
      if (mounted.current) { setIdentityReview(false); setNotice('Cell identity interpretation retained and selected'); setSelectedId((controller.getSnapshot().workspace?.projects.find(item => item.id === record.id)?.project.measurementLibrary as Library).activeId ?? ''); }
    } finally { pending.current = false; if (mounted.current) setBusy(false); }
  };
  return <div className="measurement-workspace">
    <header className="measurement-header"><div><p className="eyebrow">DATA AND TWIN SETUP / MEASUREMENTS</p><h1>Measurement datasets</h1>
      <p>Retain source versions, review measurement quality, then choose evidence for the working network.</p></div>
      <label className="measurement-import">Import GPS CSV<input type="file" accept=".csv,text/csv" aria-label="Import measurement CSV" disabled={locked || !!file || identityReview}
        onChange={event => { const next = event.target.files?.[0]; if (next) { setError(''); setNotice(''); setFile(next); } event.target.value = ''; }} /></label></header>
    <section className="measurement-context" aria-label="Measurement library context"><div><small>Retained versions</small><strong>{entries.length} / 20</strong></div>
      <div><small>Working dataset</small><strong>{current?.fileName ?? 'No selection'}</strong></div>
      <p>Maps and analysis use the working selection. Frozen baselines and run inputs retain their original evidence.</p></section>
    {error && <p role="alert" className="measurement-error">{error}</p>}{notice && <p role="status" className="measurement-notice">{notice}</p>}
    {file && <DriveImportReview file={file} knownCellIds={cellIds} project={record.project as unknown as SiteSceneProject} onCommit={importDataset} onCancel={() => setFile(null)} />}
    {!library && current && <section className="measurement-legacy"><h2>Existing working dataset</h2><p>{current.fileName} · {current.samples.length} GPS samples · {origin(current)} · unverified</p>
      <p>Retain this capture with its current schema and provenance. A missing original CSV remains unavailable.</p>
      <button type="button" disabled={locked || !!file} onClick={() => void act(() => retainCurrentMeasurement(controller, record.id), 'Current dataset retained')}>Retain current dataset</button></section>}
    {!entries.length && !current && !file && <section className="measurement-empty"><h2>Start with measurement evidence</h2><p>Import a GPS CSV to map source columns, review available KPIs and retain the original file. Synthetic examples remain labeled synthetic.</p></section>}
    {!!entries.length && <div className="measurement-columns"><section className="measurement-list" aria-label="Retained measurement datasets"><h2>Source versions</h2>
      <p>Review a version before changing working analysis.</p>{entries.slice().reverse().map(entry => <button type="button" key={entry.id} aria-label={`Review v${entry.version} ${entry.data.fileName}`}
        aria-pressed={selectedId === entry.id} disabled={busy} onClick={() => { setSelectedId(entry.id); setIdentityReview(false); setError(''); setNotice(''); }}>
        <span className="measurement-version">v{entry.version}{entry.id === library?.activeId && <small>Working</small>}</span>
        <strong>{entry.data.fileName}</strong><span>{entry.data.samples.length} GPS samples · {origin(entry.data)} · unverified</span>
        <small>Acquired {entry.data.evidence?.sourceDate ?? 'unknown'} · retained {new Date(entry.registeredAt).toLocaleString()}</small></button>)}
      <button type="button" className="measurement-clear" disabled={locked || !library?.activeId || !!file} onClick={() => void act(() => selectWorkingMeasurement(controller, record.id, null), 'Working selection cleared; retained versions unchanged')}>Clear working selection</button></section>
      {selected && data && <section className="measurement-detail" role="region" aria-label="Selected measurement dataset"><header><div><p className="eyebrow">RETAINED VERSION {selected.version}</p><h2>{data.fileName}</h2>
        <p>{origin(data)} · unverified · {data.samples.length} GPS samples</p></div><span className="measurement-state">{selected.id === library?.activeId ? 'Working selection' : 'Retained evidence'}</span></header>
        <div className="measurement-actions"><button type="button" disabled={locked || !!file || selected.id === library?.activeId} onClick={() => void act(() => selectWorkingMeasurement(controller, record.id, selected.id), 'Working dataset selected')}>Use for working analysis</button>
          <button type="button" disabled={selected.id !== library?.activeId} onClick={() => onNavigate('drive')}>Open measurement analysis</button>
          <button type="button" disabled={!data.evidence?.rawCsv} onClick={() => data.evidence && download(data.fileName, data.evidence.rawCsv, 'text/csv;charset=utf-8')}>Download original CSV</button></div>
        <h3>KPI availability</h3><table aria-label="Retained KPI availability"><thead><tr><th>KPI</th><th>Available</th><th>Missing</th></tr></thead><tbody>
          {Object.values(DM_METRICS).map(spec => { const available = data.samples.filter(sample => Number.isFinite(sample[spec.key])).length;
            return <tr key={spec.key}><th scope="row">{spec.label} <small>{spec.unit}</small></th><td>{available} / {data.samples.length}</td><td>{data.samples.length - available}</td></tr>; })}</tbody></table>
        <h3>Cell identity associations</h3><p>{unmatched.length} unresolved serving-cell identifiers in the working inventory.</p>
        <p>{identityRows.filter(row => row.status === 'reviewed').length} reviewed associations · {identityRows.filter(row => row.status === 'exact-id').length} exact internal IDs · scoped by radio technology</p>
        {!!unmatched.length && <details><summary>Review unresolved identifiers</summary><p className="measurement-identifiers">{unmatched.map(row => `${row.technology} ${row.sourceCell} (${row.status})`).join(' · ')}</p><p>Original identifiers remain unchanged. Link them to compatible project cells after reviewing the source identity.</p></details>}
        <button type="button" disabled={locked || !!file || selected.id !== library?.activeId || identityReview} onClick={() => { setNotice(''); setIdentityReview(true); }}>Review cell identities</button>
        {selected.id !== library?.activeId && <p>Select this version for working analysis before editing its interpretation.</p>}
        {identityReview && selected.id === library?.activeId && <CellIdentityReview key={selected.id} measurements={data as unknown as DriveMeasurements} sites={record.project.sites as IdentitySite[]}
          locked={locked} onSave={saveIdentity} onCancel={() => setIdentityReview(false)} />}
        <h3>Source and interpretation</h3><dl className="measurement-provenance"><dt>Acquisition date</dt><dd>{data.evidence?.sourceDate ?? 'Unknown'}</dd><dt>Imported</dt><dd>{data.evidence?.importedAt ?? 'Not retained in legacy capture'}</dd>
          <dt>Registered in library</dt><dd>{selected.registeredAt}</dd><dt>Coordinate reference</dt><dd>WGS84 · EPSG:4326 · displayed 1.5 m above flat ground</dd></dl>
        {!data.evidence && <p>Original CSV and source digest are unavailable in this legacy capture. The retained snapshot preserves the existing values.</p>}
        {data.evidence?.transformations[0]?.mapping && <details><summary>Retained column and unit mapping</summary><ul className="measurement-mapping">{Object.entries(data.evidence.transformations[0].mapping).filter(([field]) => !['x_pct', 'y_pct'].includes(field)).map(([field, value]) => <li key={field}><strong>{field}</strong><span>{value.column ?? 'Not provided'}{value.unit ? ` · ${value.unit}` : ''}</span></li>)}</ul></details>}
        <details><summary>Content identity and exports</summary><p className="measurement-digest">Snapshot SHA-256 {selected.sha256}</p>{data.evidence && <><p className="measurement-digest">Source SHA-256 {data.evidence.sha256}</p>{data.evidence.normalizationSha256 && <p className="measurement-digest">Normalization SHA-256 {data.evidence.normalizationSha256}</p>}</>}
          <button type="button" onClick={() => download(`measurement-v${selected.version}.json`, selected.inputJson, 'application/json')}>Download normalized snapshot</button><p>Content integrity preserves source interpretation; it does not verify physical accuracy.</p></details>
      </section>}</div>}
  </div>;
}
