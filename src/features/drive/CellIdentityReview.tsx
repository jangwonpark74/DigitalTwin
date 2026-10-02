import { useMemo, useState } from 'react';
import { cellIdentityRows, cellSupportsTechnology } from '../../../cell-identity.mjs';
import { inventoryIdentityLabel } from '../../../network-cell-identity.mjs';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';
import type { CellIdentityBinding, IdentitySite } from './cellIdentityTypes';
import './cell-identity.css';

const labels: Record<string, string> = { reviewed: 'Reviewed association', 'exact-id': 'Exact internal ID', unresolved: 'Unresolved',
  'missing-cell': 'Target cell missing', ambiguous: 'Ambiguous target', 'technology-mismatch': 'Radio technology mismatch' };
export default function CellIdentityReview({ measurements, sites, locked, onSave, onCancel }: {
  measurements: DriveMeasurements; sites: IdentitySite[]; locked: boolean;
  onSave: (bindings: CellIdentityBinding[]) => Promise<void>; onCancel: () => void;
}) {
  const rows = useMemo(() => cellIdentityRows(measurements, sites), [measurements, sites]);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(rows.map(row => [row.key, row.targetCellId && row.status !== 'unresolved' ? row.targetCellId : ''])));
  const [search, setSearch] = useState(''), [page, setPage] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const filtered = rows.filter(row => `${row.technology} ${row.sourceCell}`.toLowerCase().includes(search.trim().toLowerCase()));
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 50) - 1)), visible = filtered.slice(currentPage * 50, (currentPage + 1) * 50);
  const save = async () => {
    if (busy || locked) return;
    setBusy(true); setError('');
    try { await onSave(rows.map(row => ({ technology: row.technology as 'LTE' | 'NR', sourceCell: row.sourceCell, targetCellId: draft[row.key] || null }))); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  return <section className="measurement-identity-review" aria-label="Cell identity review">
    <h3>Cell identity review</h3><p>Associate source identifiers with the current project inventory. The source ID and radio technology together define each association within this dataset. PCI alone is not a unique network identity.</p>
    <p>Saving retains a new interpretation and selects it for working analysis. Original samples, source CSV and frozen studies remain unchanged. These associations remain unverified.</p>
    {error && <p role="alert" className="measurement-error">{error}</p>}
    <label className="measurement-identity-search">Find source identifier<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} /></label>
    <div className="measurement-identity-rows">{visible.map(row => {
      const targets = sites.flatMap(site => site.cells.filter(cell => cellSupportsTechnology(site, row.technology, cell)).map(cell => ({ id: cell.id,
        name: `${site.name} · ${cell.id}${cell.inventoryIdentity ? ` · ${inventoryIdentityLabel(cell.inventoryIdentity)}${cell.inventoryIdentity.carrierName ? ` · ${cell.inventoryIdentity.carrierName}` : ''} · unverified` : ''}` })));
      return <div className="measurement-identity-row" key={row.key}><div><strong>{row.sourceCell}</strong><small>{row.technology} · {row.count} samples · saved: {labels[row.status]}</small></div>
        <label>Project cell<select aria-label={`${row.technology} ${row.sourceCell} project cell`} disabled={busy || locked} value={draft[row.key] ?? ''}
          onChange={event => setDraft(previous => ({ ...previous, [row.key]: event.target.value }))}>
          <option value="">Leave unresolved</option>{draft[row.key] && !targets.some(target => target.id === draft[row.key]) && <option value={draft[row.key]}>Unavailable target · {draft[row.key]}</option>}
          {targets.map(target => <option key={target.id} value={target.id}>{target.name}</option>)}
        </select></label></div>;
    })}</div>
    {!filtered.length && <p>No matching source identifiers.</p>}
    <div className="measurement-identity-pagination"><span>{filtered.length ? currentPage * 50 + 1 : 0}–{Math.min(filtered.length, (currentPage + 1) * 50)} / {filtered.length} identifiers</span>
      <button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>Previous identifiers</button>
      <button type="button" disabled={(currentPage + 1) * 50 >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next identifiers</button></div>
    <div className="measurement-actions"><button type="button" disabled={busy || locked} onClick={() => void save()}>{busy ? 'Saving identity interpretation…' : 'Save identity interpretation'}</button>
      <button type="button" disabled={busy} onClick={onCancel}>Cancel identity review</button></div>
  </section>;
}
