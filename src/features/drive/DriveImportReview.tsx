import { useEffect, useRef, useState } from 'react';
import { prepareDriveImport, readDriveCsv, type DriveOrigin, type DriveImportPreview, type CsvMapping } from './driveImport';
import { DM_CSV_FIELDS, inspectDmCsv } from '../../../dm.mjs';
import OpenSiteScene, { type SiteSceneProject } from '../site-planner/OpenSiteScene';

type CsvFile = { name: string; size: number; text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> };
export default function DriveImportReview({ file, knownCellIds, project, onCommit, onCancel }: {
  file: CsvFile; knownCellIds: string[]; project?: SiteSceneProject;
  onCommit: (measurements: DriveImportPreview['measurements']) => Promise<void>; onCancel: () => void;
}) {
  const [origin, setOrigin] = useState<DriveOrigin>('unknown'), [sourceDate, setSourceDate] = useState('');
  const [preview, setPreview] = useState<DriveImportPreview | null>(null), [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [rawCsv, setRawCsv] = useState<string | null>(null), [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<CsvMapping | null>(null), [loading, setLoading] = useState(true);
  const [mappingOpen, setMappingOpen] = useState(false);
  const generation = useRef(0), saving = useRef(false);
  useEffect(() => {
    const ticket = ++generation.current; setPreview(null); setError(''); setBusy(false); setLoading(true); setRawCsv(null); setHeaders([]); setMapping(null);
    void (async () => {
      if (file.size > 1_000_000) throw new Error('Drive CSV must be smaller than 1 MB.');
      const raw = await readDriveCsv(file), source = inspectDmCsv(raw);
      if (ticket === generation.current) {
        setRawCsv(raw); setHeaders(source.headers); setMapping(source.mapping);
        setMappingOpen(!['time_s', 'technology', 'serving_cell', 'latitude', 'longitude'].every(field => source.mapping[field].column));
      }
    })().catch(cause => { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (ticket === generation.current) setLoading(false); });
    return () => { generation.current++; };
  }, [file]);
  const invalidate = () => { generation.current++; setPreview(null); setError(''); };
  const validate = async () => {
    if (rawCsv === null || !mapping) return;
    const ticket = ++generation.current;
    setBusy(true); setPreview(null); setError('');
    try {
      if (file.size > 1_000_000) throw new Error('Drive CSV must be smaller than 1 MB.');
      const result = await prepareDriveImport({ name: file.name, rawCsv, mapping, origin, sourceDate, knownCellIds });
      if (ticket === generation.current) setPreview(result);
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (ticket === generation.current) setBusy(false); }
  };
  const save = async () => {
    if (!preview || saving.current) return;
    const ticket = generation.current;
    saving.current = true; setBusy(true); setError('');
    try { await onCommit(preview.measurements); }
    catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { saving.current = false; if (ticket === generation.current) setBusy(false); }
  };
  return <section role="region" aria-label="Drive CSV import review" className="drive-import-review panel">
    <header><p className="eyebrow">DATA AND TWIN SETUP / IMPORT REVIEW</p><h2>Review drive evidence</h2>
      <p>{file.name} · original CSV preserved with a SHA-256 digest when saved.</p></header>
    <fieldset disabled={busy || loading || !mapping}><legend>1. Declare source and acquisition date</legend>
      <label>Dataset origin<select aria-label="Dataset origin" value={origin} onChange={event => { invalidate(); setOrigin(event.target.value as DriveOrigin); }}>
        <option value="unknown">Unknown origin</option><option value="synthetic">Synthetic example</option><option value="field-measured">Field measurement · unverified</option>
      </select></label>
      <label>Source date<input aria-label="Source date" type="date" value={sourceDate} max={new Date().toISOString().slice(0, 10)} onChange={event => { invalidate(); setSourceDate(event.target.value); }} /></label>
      <p>Origin is a declaration. Verification and physical calibration remain separate.</p>
    </fieldset>
    {loading && <p role="status">Reading source columns…</p>}
    {mapping && <details open={mappingOpen} onToggle={event => setMappingOpen(event.currentTarget.open)}>
      <summary>2. Column and unit mapping</summary>
      <p>Map the original source columns. Required: elapsed time, LTE/NR technology, serving-cell identifier and WGS84 coordinates. KPIs and events are optional.</p>
      <p>Absent KPI columns and blank / NA / N/A / NULL values remain unavailable. Invalid provided values reject the import. No missing value becomes zero.</p>
      <fieldset disabled={busy} className="drive-column-mapping"><legend>Source fields</legend>
        {Object.entries(DM_CSV_FIELDS).filter(([field]) => !['x_pct', 'y_pct'].includes(field)).map(([field, spec]) =>
          <div key={field} className="drive-mapping-row"><strong>{spec.label} <small>{spec.required ? 'Required' : 'Optional'}</small></strong>
            <label><span>Source column</span><select aria-label={`${spec.label} source column`} value={mapping[field].column ?? ''}
              onChange={event => { invalidate(); setMapping({ ...mapping, [field]: { ...mapping[field], column: event.target.value || null } }); }}>
              <option value="">{spec.required ? 'Select a column' : 'Not provided'}</option>{headers.map(header => <option key={header} value={header}>{header}</option>)}</select></label>
            <label><span>Source unit</span><select aria-label={`${spec.label} source unit`} value={mapping[field].unit ?? ''} disabled={spec.units.length === 1 || !mapping[field].column}
              onChange={event => { invalidate(); setMapping({ ...mapping, [field]: { ...mapping[field], unit: event.target.value || null } }); }}>
              {spec.units.map(unit => <option key={unit ?? 'text'} value={unit ?? ''}>{unit ?? 'Text'}</option>)}</select></label>
          </div>)}
      </fieldset>
      <p>Values normalize to seconds, degrees, dBm, dB and Mbps. Mapping and unit conversions are saved with the original CSV.</p>
    </details>}
    <button type="button" className="button" disabled={busy || loading || !mapping} onClick={() => { void validate(); }}>{busy ? 'Working…' : 'Validate and preview'}</button>
    {error && <p role="alert">Import review needs attention · {error}</p>}
    {preview && <div className="drive-import-quality" role="region" aria-label="Import quality preview">
      <h3>3. Quality and geographic extent</h3>
      <p>{preview.quality.accepted} accepted · {preview.quality.rejected} rejected · {preview.quality.duplicates} duplicates retained</p>
      <p>WGS84 latitude {preview.extent.south.toFixed(5)}–{preview.extent.north.toFixed(5)} · longitude {preview.extent.west.toFixed(5)}–{preview.extent.east.toFixed(5)}</p>
      <p>Origin: {preview.measurements.evidence.origin} · verification: unverified</p>
      <table className="drive-kpi-availability" aria-label="KPI availability"><thead><tr><th>KPI</th><th>Available</th><th>Missing</th></tr></thead>
        <tbody>{Object.entries(preview.quality.metrics).map(([metric, population]) => <tr key={metric}><th scope="row">{population.label} <small>{population.unit}</small></th>
          <td>{population.available} / {preview.quality.accepted}</td><td>{population.missing}</td></tr>)}</tbody></table>
      <p>Quality statistics use available values for each KPI. Missing samples remain on the route in gray.</p>
      {preview.quality.warnings.length > 0 && <ul>{preview.quality.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      {preview.quality.unmatchedCells.length > 0 && <details open><summary>Unresolved serving-cell identifiers</summary>
        <ul>{preview.quality.unmatchedCells.map(cell => <li key={cell}>{cell}</li>)}</ul><p>Saving retains these identifiers for later reconciliation. They are not mapped to invented cells.</p></details>}
      {project && <OpenSiteScene project={{ ...project, driveView: { samples: preview.measurements.samples, metric: 'rsrp', selectedIndex: null, visible: true, interactive: false } }}
        camera={{ yaw: 0, pitch: 0, zoom: 1 }} fitDriveRequest={1} />}
      <details><summary>Source integrity</summary><p className="drive-import-digest">SHA-256 {preview.measurements.evidence.sha256}</p></details>
    </div>}
    <div className="drive-import-actions"><button type="button" className="button primary" disabled={!preview || busy} onClick={() => { void save(); }}>Save GPS dataset</button>
      <button type="button" className="button" disabled={busy} onClick={onCancel}>Cancel import</button></div>
  </section>;
}
