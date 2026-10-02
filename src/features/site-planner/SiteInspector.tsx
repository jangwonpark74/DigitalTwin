import { useRef, useState, type KeyboardEvent } from 'react';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { applyCellField, applySiteField, type CellField, type SiteField } from './sitePlannerCommands';
import { applyRadioField, type RadioConfigField, type RadioField } from '../radio/radioCommands';
import { cellIdentityRows } from '../../../cell-identity.mjs';
import SectorCompass from './SectorCompass';
import type { InspectorTab, SitePlannerSession } from './SitePlannerSession';
import CellInventoryEditor from './CellInventoryEditor';
import type { InventoryIdentity } from './inventoryIdentityTypes';
import { inventoryIdentityLabel } from '../../../network-cell-identity.mjs';

export type InspectorSite = { id: string; name: string; heightM: number; frontEnd: 'Antenna' | 'MMU'; x: number; y: number;
  radio: { manufacturer: string; technology: string; ruModel: string; band: string; mmuModel: string; mmuElements: number | null; beamformingProfile: string };
  radioLocation: { latitude: number | null; longitude: number | null; source: string };
  cells: { id: string; antenna: string; azimuthDeg: number; downtiltDeg: number; txPowerDbm: number; bandwidthMhz: number; inventoryIdentity?: InventoryIdentity }[] };
const tabs: InspectorTab[] = ['summary', 'position', 'rf', 'antenna', 'topology'];
const tabLabels = ['Summary', 'Position', 'RF', 'Antenna', 'Topology'];
type Field = { kind: 'site'; prop: SiteField } | { kind: 'cell'; prop: CellField } | { kind: 'config'; prop: RadioConfigField }
  | { kind: 'location'; prop: 'latitude' | 'longitude' } | { kind: 'frontEnd' };

export default function SiteInspector({ controller, record, site, cell, session, tab, onError, onPlace, onNavigate }: {
  controller: AppController; record: WorkspaceSnapshot['projects'][number]; site: InspectorSite; cell: InspectorSite['cells'][number];
  session: SitePlannerSession; tab: InspectorTab; onError: (message: string) => void; onPlace?: () => void; onNavigate: (route: string) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const tabList = useRef<HTMLDivElement>(null), sectors = useRef<HTMLDivElement>(null);
  const key = (field: Field) => `${site.id}:${field.kind === 'cell' ? cell.id : ''}:${field.kind}:${'prop' in field ? field.prop : 'frontEnd'}`;
  const forget = (id: string) => setDrafts(previous => { const next = { ...previous }; delete next[id]; return next; });
  const commit = (field: Field, value: string) => {
    const id = key(field);
    try {
      const save = field.kind === 'site' ? applySiteField(controller, record.id, site.id, field.prop, value)
        : field.kind === 'cell' ? applyCellField(controller, record.id, cell.id, field.prop, value)
        : applyRadioField(controller, record.id, { ...field, siteId: site.id } as RadioField, value);
      if (!save) { forget(id); return; }
      void save.then(() => { forget(id); onError(''); }).catch(cause => { forget(id); onError(cause instanceof Error ? cause.message : String(cause)); });
    } catch (cause) { forget(id); onError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const input = (label: string, field: Field, value: unknown, options: { min?: number; max?: number; type?: string; values?: string[] } = {}) => {
    const id = key(field), shown = drafts[id] ?? (value == null ? '' : String(value));
    return <label key={label}>{label}{options.values ? <select aria-label={label} value={shown} onChange={event => commit(field, event.target.value)}
      {...(field.kind === 'frontEnd' ? { 'data-radio-front-end': site.id } : field.kind === 'config' ? { 'data-radio-config': site.id, 'data-prop': field.prop } : {})}>
      {options.values.map(option => <option key={option}>{option}</option>)}</select> : <input aria-label={label} value={shown}
      type={options.type ?? (options.min !== undefined ? 'number' : 'text')} min={options.min} max={options.max} step={options.min !== undefined ? 'any' : undefined}
      {...(field.kind === 'location' ? { 'data-radio-location': site.id, 'data-prop': field.prop } : field.kind === 'config' ? { 'data-radio-config': site.id, 'data-prop': field.prop } : {})}
      onChange={event => setDrafts(previous => ({ ...previous, [id]: event.target.value }))} onBlur={event => commit(field, event.target.value)} />}</label>;
  };
  const config = (label: string, prop: RadioConfigField, options?: { min?: number; max?: number; values?: string[] }) => input(label, { kind: 'config', prop }, site.radio[prop], options);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number, length: number, choose: (index: number) => void, list: HTMLDivElement | null) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + length) % length;
    choose(next); list?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };
  const located = Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude);
  const source = site.radioLocation.source === 'map-estimate' ? 'Schematic-map estimate' : site.radioLocation.source === 'manual' ? 'Manually entered' : 'Unassigned';
  const associations = cellIdentityRows(record.project.driveMeasurements, record.project.sites).filter(row => row.siteId === site.id);
  const architecture = record.project.architecture as Record<string, { kind: string; name?: string }>;
  return <section className="site-planner-site panel sp-canonical-inspector" aria-label="Site configuration">
    <header className="panel-header"><div><p className="sp-kicker">SELECTED SITE AND CELL</p><h2>{site.name}</h2><p className="panel-caption">{site.id} · {cell.id}</p></div><span className="sp-site-tag">{site.frontEnd}</span></header>
    <div ref={sectors} className="site-planner-cell-tabs" role="tablist" aria-label={`${site.name} sectors`}>
      {site.cells.map((candidate, index) => <button key={candidate.id} type="button" role="tab" tabIndex={candidate.id === cell.id ? 0 : -1} aria-selected={candidate.id === cell.id}
        aria-controls="sp-inspector-panel" onClick={() => session.selectCell(candidate.id)} onKeyDown={event => move(event, index, site.cells.length, next => session.selectCell(site.cells[next].id), sectors.current)}>
        <span>Sector 0{index + 1}<strong>{candidate.azimuthDeg}°</strong></span><small>{candidate.id}</small></button>)}
    </div>
    <div ref={tabList} className="sp-inspector-tabs" role="tablist" aria-label="Site inspector">{tabs.map((value, index) => <button key={value} role="tab" type="button"
      id={`sp-inspector-${value}`} aria-controls="sp-inspector-panel" aria-selected={tab === value} tabIndex={tab === value ? 0 : -1}
      onClick={() => session.selectInspectorTab(value)} onKeyDown={event => move(event, index, tabs.length, next => session.selectInspectorTab(tabs[next]), tabList.current)}>{tabLabels[index]}</button>)}</div>
    <div id="sp-inspector-panel" role="tabpanel" aria-labelledby={`sp-inspector-${tab}`} className="sp-inspector-content">
      {tab === 'summary' && <><h3>Site summary</h3><div className="site-planner-fields">{input('Site name', { kind: 'site', prop: 'name' }, site.name)}</div>
        <dl className="sp-inspector-summary"><dt>Location</dt><dd>{located ? `${site.radioLocation.latitude!.toFixed(5)}, ${site.radioLocation.longitude!.toFixed(5)}` : 'Coordinates not set'}</dd>
          <dt>Mounting height</dt><dd>{site.heightM} m</dd><dt>Radio technology</dt><dd>{site.radio.technology}</dd><dt>Front end</dt><dd>{site.frontEnd}</dd>
          <dt>Cell power / bandwidth</dt><dd>{cell.txPowerDbm} dBm / {cell.bandwidthMhz} MHz</dd>
          <dt>Declared cell identity</dt><dd>{inventoryIdentityLabel(cell.inventoryIdentity)}{cell.inventoryIdentity && ' · unverified'}</dd>
          {cell.inventoryIdentity?.carrierName && <><dt>Carrier label</dt><dd>{cell.inventoryIdentity.carrierName}</dd></>}
          <dt>Measurement identities</dt><dd>{associations.length} associated source / RAT pairs · unverified</dd></dl>
        <p className="site-planner-note">Planning configuration · RF calibration and hardware compatibility unverified.</p></>}
      {tab === 'position' && <><h3>Geographic location</h3><p>{located ? 'Coordinates set' : 'Coordinates not set'} · {source}</p>
        <div className="site-planner-fields">{input('Latitude', { kind: 'location', prop: 'latitude' }, site.radioLocation.latitude, { min: -90, max: 90 })}
          {input('Longitude', { kind: 'location', prop: 'longitude' }, site.radioLocation.longitude, { min: -180, max: 180 })}
          {input('Height (m)', { kind: 'site', prop: 'heightM' }, site.heightM, { min: 1, max: 300 })}</div>
        <div className="sp-inspector-actions">{onPlace && <button type="button" className="button primary" data-radio-place={site.id} onClick={onPlace}>⌖ Place on map</button>}
          <button type="button" className="button outline" onClick={() => onNavigate('map')}>View map scope</button></div>
        <details><summary>Project scope position</summary><div className="site-planner-fields">
          {input('Map X position (%)', { kind: 'site', prop: 'x' }, site.x, { min: 0, max: 100 })}{input('Map Y position (%)', { kind: 'site', prop: 'y' }, site.y, { min: 0, max: 100 })}</div>
          <p className="site-planner-note">Changing these values replaces geographic coordinates with a map estimate.</p></details></>}
      {tab === 'rf' && <><h3>Radio unit and carrier targets</h3><p>{site.radio.manufacturer} · compatibility unverified</p><div className="site-planner-fields">
        {config('Radio technology', 'technology', { values: ['4G LTE', '5G NR', '4G LTE + 5G NR'] })}{config('RU model / part number', 'ruModel')}{config('Band / spectrum profile', 'band')}
        {input('Tx power (dBm)', { kind: 'cell', prop: 'txPowerDbm' }, cell.txPowerDbm, { min: 0, max: 60 })}
        {input('Bandwidth (MHz)', { kind: 'cell', prop: 'bandwidthMhz' }, cell.bandwidthMhz, { min: 5, max: 400 })}</div>
        <p className="site-planner-note">Vendor and spectrum declarations are planning inputs. Catalog compatibility and live carrier configuration remain unverified.</p></>}
      {tab === 'antenna' && <><h3>Antenna and sector alignment</h3><SectorCompass sectors={site.cells} selectedId={cell.id} /><div className="site-planner-fields">
        {input('RF front end', { kind: 'frontEnd' }, site.frontEnd, { values: ['Antenna', 'MMU'] })}
        {input('Azimuth (°)', { kind: 'cell', prop: 'azimuthDeg' }, cell.azimuthDeg, { min: 0, max: 359 })}
        {input('Downtilt (°)', { kind: 'cell', prop: 'downtiltDeg' }, cell.downtiltDeg, { min: 0, max: 30 })}
        {site.frontEnd === 'MMU' && <>{config('MMU model / reference', 'mmuModel')}{config('Array elements', 'mmuElements', { min: 1, max: 1024 })}{config('Beamforming profile', 'beamformingProfile')}</>}</div>
        <p className="site-planner-note">{cell.antenna} antenna pattern · declared reference, not a calibrated array model.</p></>}
      {tab === 'topology' && <><h3>Planned RAN boundaries</h3><dl className="sp-inspector-summary">{Object.entries(architecture).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value.kind}</dd></div>)}</dl>
        <p className="site-planner-note">Topology relationships remain unverified. Site-specific gNB, CU, DU and RU identities have not been supplied.</p>
        <div className="sp-inspector-actions"><button type="button" className="button outline" onClick={() => onNavigate('stack')}>Open RAN topology</button>
          <button type="button" className="button outline" onClick={() => onNavigate('measurements')}>Review measurement identities</button></div></>}
      <CellInventoryEditor controller={controller} projectId={record.id} site={site} cell={cell} hidden={tab !== 'rf'} />
    </div>
    <p className="site-planner-note sp-inspector-save-note">RF and position fields save when you leave a field. Cell identity declarations use Save. Original observations and frozen studies retain their saved inputs.</p>
  </section>;
}
