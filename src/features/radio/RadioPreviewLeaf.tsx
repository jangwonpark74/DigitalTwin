import { useEffect, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { RadioSession } from './RadioSession';
import { applyRadioField, type RadioConfigField, type RadioField } from './radioCommands';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type Radio = {
  manufacturer: string;
  technology: string;
  ruModel: string;
  band: string;
  mmuModel: string;
  mmuElements: number | null;
  beamformingProfile: string;
};
type Site = {
  id: string;
  name: string;
  frontEnd: string;
  radio: Radio;
  radioLocation: { latitude: number | null; longitude: number | null; source: string };
  cells: { id: string; azimuthDeg: number; bandwidthMhz: number; txPowerDbm: number }[];
};
type Project = {
  map: { city: string; cluster: string; latitude: number; longitude: number; radiusMeters: number };
  sites: Site[];
};

const technologies = ['4G LTE', '5G NR', '4G LTE + 5G NR'];

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function Panel({ title, caption, badge, children }: {
  title: string; caption: string; badge?: string; children: ReactNode;
}) {
  return <section className="panel">
    <header className="panel-header"><div><h2 className="panel-title">{title}</h2><p className="panel-caption">{caption}</p></div>
      {badge && <span className="mini-pill">{badge}</span>}</header>
    {children}
  </section>;
}

export default function RadioPreviewLeaf({ controller, record: recordProp, session, onError, onNavigate }: {
  controller: AppController;
  record: ProjectRecord;
  session: RadioSession;
  onError: (message: string) => void;
  onNavigate: (route: string) => void;
}) {
  const controllerState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const selection = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const activeProjectId = controllerState.workspace?.activeProjectId;
  const record = controllerState.workspace?.projects.find(project => project.id === activeProjectId) ?? recordProp;
  const project = record.project as unknown as Project;
  const site = project.sites.find(candidate => candidate.id === selection.selectedSiteId) ?? project.sites[0];
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  useEffect(() => {
    session.setProject(record.id, project);
  }, [record.id, project, session]);

  const draftKey = (siteId: string, field: RadioField) => `${record.id}:${siteId}:${field.kind}:${'prop' in field ? field.prop : 'frontEnd'}`;
  const valueFor = (siteId: string, field: RadioField, canonical: unknown) =>
    drafts[draftKey(siteId, field)] ?? (canonical == null ? '' : String(canonical));
  const forgetDraft = (key: string) => setDrafts(current => {
    const next = { ...current };
    delete next[key];
    return next;
  });
  const commit = (field: RadioField, value: string) => {
    const key = draftKey(field.siteId, field);
    try {
      const save = applyRadioField(controller, record.id, field, value);
      if (!save) { forgetDraft(key); return; }
      void save.then(() => { forgetDraft(key); onError(''); })
        .catch(cause => { forgetDraft(key); onError(errorMessage(cause)); });
    } catch (cause) {
      forgetDraft(key);
      onError(errorMessage(cause));
    }
  };
  const draft = (siteId: string, field: RadioField, value: string) => {
    const key = draftKey(siteId, field);
    setDrafts(current => ({ ...current, [key]: value }));
  };

  if (!site) return <section className="radio-planner-preview" role="region" aria-label="Radio planner preview route">
    <div className="page-heading"><div><h1>Radio planner</h1><p>No radio sites are available.</p></div></div>
    <div className="summary-banner warn"><div>
      <strong>Preparation workspace · RAN integration not connected</strong>
      <p>Local GeoJSON and Sionna-RT path jobs are available when a compatible runtime is configured. Real vCore / vDU, GH200 discovery, and calibrated RF results remain unverified.</p>
    </div><span className="mini-pill warn">RAN OFFLINE</span></div>
  </section>;

  const config = (label: string, prop: RadioConfigField, placeholder: string, options?: string[]) => {
    const field: RadioField = { kind: 'config', siteId: site.id, prop };
    const current = site.radio[prop];
    const value = valueFor(site.id, field, current);
    return <label className="form-field" key={prop}><span>{label}</span>
      {options ? <select className="select" data-radio-config={site.id} data-prop={prop} value={value}
        onChange={event => commit(field, event.currentTarget.value)}>
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select> : <input data-radio-config={site.id} data-prop={prop}
        type={prop === 'mmuElements' ? 'number' : 'text'} min={prop === 'mmuElements' ? 1 : undefined}
        max={prop === 'mmuElements' ? 1024 : undefined} step={prop === 'mmuElements' ? 1 : undefined}
        placeholder={placeholder} value={value}
        onChange={event => draft(site.id, field, event.currentTarget.value)}
        onBlur={event => commit(field, event.currentTarget.value)} />}
    </label>;
  };
  const location = (label: string, prop: 'latitude' | 'longitude', min: number, max: number) => {
    const field: RadioField = { kind: 'location', siteId: site.id, prop };
    return <label className="form-field" key={prop}><span>{label}</span>
      <input type="number" data-radio-location={site.id} data-prop={prop} min={min} max={max} step="any"
        placeholder="Not set" value={valueFor(site.id, field, site.radioLocation[prop])}
        onChange={event => draft(site.id, field, event.currentTarget.value)}
        onBlur={event => commit(field, event.currentTarget.value)} />
    </label>;
  };

  const hasLatitude = Number.isFinite(site.radioLocation.latitude);
  const hasLongitude = Number.isFinite(site.radioLocation.longitude);
  const located = hasLatitude && hasLongitude;
  const partial = hasLatitude !== hasLongitude;
  const locationState = located ? 'Coordinates set' : partial ? 'Enter both coordinates' : 'Coordinates not set';
  const sourceLabel = site.radioLocation.source === 'map-estimate' ? 'Schematic-map estimate'
    : site.radioLocation.source === 'manual' ? 'Manually entered' : 'Unassigned';

  return <section className="radio-planner-preview" role="region" aria-label="Radio planner preview route">
    <div className="page-heading"><div>
      <p className="eyebrow">5G RAN DIGITAL TWIN / {project.map.cluster.toUpperCase()}</p>
      <h1>Radio planner</h1>
      <p className="muted">Configure the Samsung RU, RF front end, and location for each planned radio site.</p>
    </div></div>
    <div className="summary-banner warn"><div>
      <strong>Preparation workspace · RAN integration not connected</strong>
      <p>Local GeoJSON and Sionna-RT path jobs are available when a compatible runtime is configured. Real vCore / vDU, GH200 discovery, and calibrated RF results remain unverified.</p>
    </div><span className="mini-pill warn">RAN OFFLINE</span></div>

    <section className="radio-site-section" aria-label="Radio locations">
      <div className="radio-section-heading"><div><h2>Radio locations</h2>
        <p>Select a site to edit its RU, MMU, and geographic position.</p></div>
        <span>{project.sites.length} planned {project.sites.length === 1 ? 'location' : 'locations'}</span>
      </div>
      <div className="radio-site-switcher">{project.sites.map(item => {
        const isLocated = Number.isFinite(item.radioLocation.latitude) && Number.isFinite(item.radioLocation.longitude);
        const selected = item.id === site.id;
        return <button type="button" className={`radio-site-card${selected ? ' active' : ''}`} key={item.id}
          data-radio-site={item.id} aria-pressed={selected} onClick={() => {
            session.selectSite(item.id);
            onError('');
          }}>
          <span className="radio-site-number">{item.id}</span><strong>{item.name}</strong>
          <small>Front end: {item.frontEnd === 'MMU' ? 'MMU' : 'Antenna'} · Location: {isLocated ? 'set' : 'needed'}</small>
        </button>;
      })}</div>
    </section>

    <div className="radio-planner-grid">
      <Panel title="Radio unit" caption={`${site.name} · Samsung RU target`}>
        <div className="radio-field-grid">
          <div className="radio-vendor"><span>Target manufacturer</span><strong>{site.radio.manufacturer}</strong>
            <small>Planning target · no model compatibility asserted</small></div>
          {config('Radio technology', 'technology', '', technologies)}
          {config('RU model / part number', 'ruModel', `Add confirmed ${site.radio.manufacturer} model`)}
          {config('Band / spectrum profile', 'band', 'e.g. B3 or n78')}
        </div>
        <p className="radio-inline-note">Enter exact vendor part numbers only when confirmed; this planner does not validate catalog compatibility or licensing.</p>
      </Panel>
      <Panel title="Geographic location"
        caption={`Map scope center ${project.map.latitude.toFixed(4)}, ${project.map.longitude.toFixed(4)} · radius ${project.map.radiusMeters} m`}>
        <div className="radio-location-status"><div><span className={`radio-state-dot${located ? ' set' : ''}`} />
          <strong>{locationState}</strong><small>{sourceLabel}</small></div>
          {!located && <span className="mini-pill warn">{partial ? 'COMPLETE LAT / LON' : 'ENTER OR PLACE'}</span>}
        </div>
        <div className="radio-field-grid radio-coordinate-fields">
          {location('Latitude', 'latitude', -90, 90)}{location('Longitude', 'longitude', -180, 180)}
        </div>
        <p className="radio-coordinate-hint">Enter coordinates manually or place the radio on the map.</p>
        <div className="radio-location-actions">
          <button type="button" className="button primary" data-radio-place={site.id} onClick={() => {
            session.startPlacement(site.id);
            onNavigate('map');
          }}>⌖ Place on map</button>
          <button type="button" className="button outline" data-go="map" onClick={() => onNavigate('map')}>View map scope</button>
        </div>
        <p className="radio-location-note">Map placement estimates coordinates from the configured center and radius; the schematic canvas is not a real basemap. Prefer verified site coordinates for deployment.</p>
      </Panel>
    </div>

    <div className="radio-planner-grid radio-planner-lower">
      <Panel title="MMU & RF front end" caption="Site-specific front-end configuration · compatibility unverified">
        <div className="radio-field-grid">
          <label className="form-field"><span>RF front end</span>
            <select className="select" data-radio-front-end={site.id} value={site.frontEnd}
              onChange={event => commit({ kind: 'frontEnd', siteId: site.id }, event.currentTarget.value)}>
              <option value="Antenna">Antenna</option><option value="MMU">MMU</option>
            </select>
          </label>
          {site.frontEnd === 'MMU' ? <>
            {config('MMU model / reference', 'mmuModel', 'Add confirmed MMU model')}
            {config('Array elements', 'mmuElements', 'Not set')}
            {config('Beamforming profile', 'beamformingProfile', 'Profile name or note')}
          </> : <div className="radio-front-end-help"><strong>Antenna front end selected</strong>
            <span>Select MMU to configure its model, array elements, and beamforming profile.</span></div>}
        </div>
        <p className="radio-inline-note">MMU values are site-specific planning inputs; they do not validate vendor compatibility or a calibrated antenna pattern.</p>
      </Panel>
      <Panel title="Sector summary" caption="Current per-site cell parameters" badge={`${site.cells.length} SECTORS`}>
        <div className="radio-table-wrap" role="region" aria-label={`Sector table for ${site.id}`} tabIndex={0}>
          <table className="radio-sector-table"><thead><tr><th>Sector</th><th>Azimuth</th><th>Bandwidth</th><th>Tx power</th></tr></thead>
            <tbody>{site.cells.map(cell => <tr key={cell.id}><th scope="row">{cell.id}</th>
              <td>{cell.azimuthDeg}°</td><td>{cell.bandwidthMhz} MHz</td><td>{cell.txPowerDbm} dBm</td></tr>)}</tbody>
          </table>
        </div>
        <div className="radio-sector-actions"><span>Sector alignment and power are configured in the cell planner.</span>
          <button type="button" className="button outline" data-go="planner" onClick={() => onNavigate('planner')}>Edit sectors →</button>
        </div>
      </Panel>
    </div>
  </section>;
}
