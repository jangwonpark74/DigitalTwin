import { useRef } from 'react';
import { DRIVE_HEIGHT_M, driveColors, driveLevel, driveMetrics, type DriveMeasurements, type DriveMetric, type DriveSample, type DriveTechnology } from './driveKpi';
import MeasurementCellAssociation from '../drive/MeasurementCellAssociation';
import type { IdentitySite } from '../drive/cellIdentityTypes';

export default function DriveKpiControls({ measurements, samples, metric, technology, visible, busy, error, readOnly = false, importDisabled = false,
  onImport, onMetric, onTechnology, onVisible, onFit }: {
  measurements: DriveMeasurements | null; samples: DriveSample[]; metric: DriveMetric; technology: DriveTechnology;
  visible: boolean; busy: boolean; error: string; readOnly?: boolean; importDisabled?: boolean;
  onImport?: (file: File) => Promise<void>; onMetric: (metric: DriveMetric) => void; onTechnology: (technology: DriveTechnology) => void;
  onVisible: (value: boolean) => void; onFit: () => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const spec = driveMetrics[metric];
  const available = samples.filter(sample => Number.isFinite(sample[spec.key])).length;
  const poor = samples.filter(sample => driveLevel(sample[spec.key], metric) === 'poor').length;
  return <div className="rt-drive-controls" aria-label="Street-level drive test results">
    <div className="rt-drive-heading"><div><p className="rt-eyebrow">DRIVE TEST / STREET LEVEL</p><h3>Radio quality along the route</h3></div>
      <div className="rt-drive-actions">{onImport && <button type="button" className="button outline" disabled={busy || readOnly || importDisabled}
        title={readOnly ? 'Captured evidence is read-only. Select the working network to import a replacement.' : undefined} onClick={() => fileInput.current?.click()}>
        {busy ? 'Importing…' : 'Import drive test CSV'}</button>}
        <button type="button" className="button outline" disabled={!samples.length} onClick={onFit}>Fit drive route</button></div>
      {onImport && <input ref={fileInput} type="file" hidden accept=".csv,text/csv" aria-label="Import drive test CSV" disabled={busy || readOnly || importDisabled}
        onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void onImport(file); }} />}
    </div>
    <div className="rt-kpi-toolbar"><div className="rt-segment" role="group" aria-label="Drive test KPI">{Object.entries(driveMetrics).map(([key, item]) =>
      <button key={key} type="button" aria-pressed={metric === key} onClick={() => onMetric(key as DriveMetric)}>{key === 'dl' ? 'DL throughput' : key === 'ul' ? 'UL throughput' : key.toUpperCase()} <span>{item.unit}</span></button>)}</div>
      <label>Technology<select aria-label="Drive test technology" value={technology} onChange={event => onTechnology(event.target.value as DriveTechnology)}>
        <option value="ALL">LTE + 5G NR</option><option value="NR">5G NR</option><option value="LTE">4G LTE</option></select></label>
      <label className="rt-drive-toggle"><input type="checkbox" checked={visible} onChange={event => onVisible(event.target.checked)} />Drive test overlay</label>
    </div>
    <div className="rt-drive-meta"><p>{measurements ? `${measurements.fileName} · ${samples.length}/${measurements.samples.length} GPS samples · ${DRIVE_HEIGHT_M} m above ground · ${measurements.evidence?.origin === 'synthetic' ? 'synthetic, not measured' : measurements.evidence?.origin === 'field-measured' ? 'declared field measurement' : 'origin unknown'} · imported, unverified`
      : 'Import GPS drive-test results here or in Drive workspace to see radio quality on the street map.'}</p>
      {samples.length > 0 && <span>{poor} poor / {available} available · {available ? `${Math.round(100 * poor / available)}%` : '—'} · {samples.length - available} missing</span>}</div>
    <div className="rt-kpi-legend" aria-label={`${metric.toUpperCase()} color thresholds`}>
      <span><i style={{ background: driveColors.poor }} />Poor &lt; {spec.poor} {spec.unit}</span>
      <span><i style={{ background: driveColors.fair }} />Fair {spec.poor} to &lt; {spec.good} {spec.unit}</span>
      <span><i style={{ background: driveColors.good }} />Good ≥ {spec.good} {spec.unit}</span>
      <span><i style={{ background: driveColors.unavailable }} />Unavailable</span>
    </div>
    {error && <p role="alert" className="rt-drive-error">Drive import failed · {error}</p>}
    <details className="rt-drive-format"><summary>GPS CSV format</summary><p>Up to 5,000 rows / 1 MB. Map vendor columns and units in import review. Time, technology, serving cell and WGS84 coordinates are required; KPIs and event are optional. Canonical columns:</p>
      <code>time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event</code><p>Technology: NR/5G or LTE/4G. Event is optional. Color bands use the Drive workspace’s example thresholds.</p></details>
  </div>;
}

export function DriveKpiInspector({ samples, metric, selectedIndex, onSelect, measurements, sites, onSite }: {
  samples: DriveSample[]; metric: DriveMetric; selectedIndex: number | null; onSelect: (index: number) => void;
  measurements?: DriveMeasurements; sites?: IdentitySite[]; onSite?: (siteId: string) => void;
}) {
  const spec = driveMetrics[metric];
  const selected = samples.find(sample => sample.index === selectedIndex) ?? samples[0];
  const position = selected ? samples.indexOf(selected) : 0;
  const value = selected?.[spec.key], available = typeof value === 'number' && Number.isFinite(value);
  const format = (value: number | null) => value === null ? '—' : String(value);
  return selected ? <div className="rt-drive-inspector" aria-label="Selected drive sample">
      <div className="rt-drive-value" style={{ color: driveColors[driveLevel(value, metric)] }}><strong>{available ? value.toFixed(1) : 'Unavailable'}</strong> {spec.unit}<small>{metric.toUpperCase()} · {driveLevel(value, metric)}</small></div>
      <div className="rt-drive-sample-details"><strong>Sample {selected.index + 1} · {selected.technology} · {selected.servingCell}</strong>
        <span>{selected.timeS} s · {selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}{selected.event ? ` · ${selected.event}` : ''}</span>
        <span>RSRP {format(selected.rsrpDbm)} dBm · SINR {format(selected.sinrDb)} dB · RSRQ {format(selected.rsrqDb)} dB · DL {format(selected.dlMbps)} Mbps · UL {format(selected.ulMbps)} Mbps</span></div>
      {measurements && sites && <MeasurementCellAssociation measurements={measurements} sites={sites} sample={selected} onSite={onSite} />}
      <div className="rt-drive-scrubber"><label htmlFor="rt-drive-sample">Inspect sample {position + 1} / {samples.length}</label>
        <input id="rt-drive-sample" aria-label="Drive sample position" type="range" min="0" max={samples.length - 1} value={position}
          onChange={event => onSelect(samples[Number(event.target.value)].index)} /><span>Click a colored point on the map</span></div>
    </div> : <p className="rt-empty">No samples for this technology. Select LTE + 5G NR to view the full route.</p>;
}
