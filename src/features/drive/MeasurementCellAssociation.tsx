import { resolveMeasurementCell } from '../../../cell-identity.mjs';
import { inventoryIdentityLabel } from '../../../network-cell-identity.mjs';
import type { DriveMeasurements, DriveSample } from '../ray-tracing/driveKpi';
import type { IdentitySite } from './cellIdentityTypes';
import './cell-identity.css';

const labels: Record<string, string> = { reviewed: 'Reviewed association · unverified', 'exact-id': 'Exact internal ID · unverified',
  unresolved: 'Unresolved source identity', 'missing-cell': 'Target cell missing', ambiguous: 'Ambiguous inventory target', 'technology-mismatch': 'Radio technology mismatch' };
export default function MeasurementCellAssociation({ measurements, sites, sample, onSite }: {
  measurements: DriveMeasurements; sites: IdentitySite[]; sample: Pick<DriveSample, 'technology' | 'servingCell'>; onSite?: (siteId: string) => void;
}) {
  const resolution = resolveMeasurementCell(measurements, sites, sample);
  const identity = resolution.cellId ? sites.find(site => site.id === resolution.siteId)?.cells.find(cell => cell.id === resolution.cellId)?.inventoryIdentity : undefined;
  return <div className="measurement-cell-association" aria-label="Cell identity association">
    <p>Project cell: {resolution.cellId ?? 'Unresolved'}{!resolution.cellId && resolution.targetCellId && resolution.status !== 'unresolved' ? ` · retained target ${resolution.targetCellId}` : ''}</p>
    <small>{labels[resolution.status]}</small>
    {identity && <p>Declared identity: {inventoryIdentityLabel(identity)}{identity.carrierName ? ` · ${identity.carrierName}` : ''} · unverified</p>}
    {resolution.siteId && onSite && <button type="button" onClick={() => onSite(resolution.siteId!)}>Select associated site</button>}
  </div>;
}
