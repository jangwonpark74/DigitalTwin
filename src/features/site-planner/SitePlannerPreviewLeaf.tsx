import { useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import MissionControlMap from '../mission-control/MissionControlMap';
import { buildMissionMapModel } from '../mission-control/missionMapModel';
import { SitePlannerSession } from './SitePlannerSession';
import { addPlannedSite, applyCellField, applySiteField, type CellField, type SiteField } from './sitePlannerCommands';
import OpenSiteScene, { type SceneLoader, type SiteSceneProject } from './OpenSiteScene';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type Cell = { id: string; antenna: string; azimuthDeg: number; downtiltDeg: number; txPowerDbm: number; bandwidthMhz: number };
type Site = { id: string; name: string; heightM: number; frontEnd: 'Antenna' | 'MMU'; x: number; y: number; cells: Cell[] };
type Project = { sites: Site[] };
type SiteDraft = Pick<Site, 'name' | 'heightM' | 'frontEnd' | 'x' | 'y'>;
type CellDraft = Pick<Cell, 'azimuthDeg' | 'downtiltDeg' | 'txPowerDbm' | 'bandwidthMhz'>;

function siteDraft(site: Site): SiteDraft {
  return { name: site.name, heightM: site.heightM, frontEnd: site.frontEnd, x: site.x, y: site.y };
}
function cellDraft(cell: Cell): CellDraft {
  return { azimuthDeg: cell.azimuthDeg, downtiltDeg: cell.downtiltDeg,
    txPowerDbm: cell.txPowerDbm, bandwidthMhz: cell.bandwidthMhz };
}
function messageFrom(error: unknown) { return error instanceof Error ? error.message : String(error); }

export default function SitePlannerPreviewLeaf({ controller, record, session, onError, onNavigate, sceneLoader }: {
  controller: AppController;
  record: ProjectRecord;
  session: SitePlannerSession;
  onError: (message: string) => void;
  onNavigate: (route: string) => void;
  sceneLoader?: SceneLoader;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const project = record.project as unknown as Project;
  const sceneProject = record.project as unknown as SiteSceneProject;
  const site = project.sites.find(candidate => candidate.id === state.selectedSiteId) ?? project.sites[0];
  const cell = site.cells.find(candidate => candidate.id === state.selectedCellId) ?? site.cells[0];
  const [siteValues, setSiteValues] = useState<SiteDraft>(() => siteDraft(site));
  const [cellValues, setCellValues] = useState<CellDraft>(() => cellDraft(cell));
  const [newSite, setNewSite] = useState({ name: '', x: '43', y: '49' });
  const [error, setError] = useState('');
  const [threeDimensional, setThreeDimensional] = useState(false);
  const cellTabList = useRef<HTMLDivElement>(null);
  const dirtyFields = useRef(new Set<string>());
  const mapModel = buildMissionMapModel(record, site.id);

  useLayoutEffect(() => {
    const siteDefaults = siteDraft(site);
    const cellDefaults = cellDraft(cell);
    setSiteValues(previous => Object.fromEntries(Object.entries(siteDefaults).map(([field, value]) => [
      field, dirtyFields.current.has(`${record.id}:${site.id}:site:${field}`) ? previous[field as keyof SiteDraft] : value,
    ])) as SiteDraft);
    setCellValues(previous => Object.fromEntries(Object.entries(cellDefaults).map(([field, value]) => [
      field, dirtyFields.current.has(`${record.id}:${site.id}:${cell.id}:cell:${field}`) ? previous[field as keyof CellDraft] : value,
    ])) as CellDraft);
  }, [record, site.id, cell.id]);

  const report = (cause: unknown) => {
    const message = messageFrom(cause);
    setError(message);
    onError(message);
  };
  const commitSite = (field: SiteField, value: string) => {
    const dirtyKey = `${record.id}:${site.id}:site:${field}`;
    try {
      const save = applySiteField(controller, record.id, site.id, field, value);
      if (!save) { dirtyFields.current.delete(dirtyKey); return; }
      void save.then(() => { dirtyFields.current.delete(dirtyKey); setError(''); onError(''); })
        .catch(cause => { dirtyFields.current.delete(dirtyKey); report(cause); });
    } catch (cause) {
      dirtyFields.current.delete(dirtyKey);
      setSiteValues(siteDraft(site));
      report(cause);
    }
  };
  const commitCell = (field: CellField, value: string) => {
    const dirtyKey = `${record.id}:${site.id}:${cell.id}:cell:${field}`;
    try {
      const save = applyCellField(controller, record.id, cell.id, field, value);
      if (!save) { dirtyFields.current.delete(dirtyKey); return; }
      void save.then(() => { dirtyFields.current.delete(dirtyKey); setError(''); onError(''); })
        .catch(cause => { dirtyFields.current.delete(dirtyKey); report(cause); });
    } catch (cause) {
      dirtyFields.current.delete(dirtyKey);
      setCellValues(cellDraft(cell));
      report(cause);
    }
  };
  const createSite = (event: FormEvent) => {
    event.preventDefault();
    try {
      const save = addPlannedSite(controller, record.id, {
        name: newSite.name, x: Number(newSite.x), y: Number(newSite.y),
      });
      if (!save) return;
      void save.then(siteId => {
        const workspace = controller.getSnapshot().workspace;
        const active = workspace?.projects.find(item => item.id === workspace.activeProjectId);
        if (active) session.setProject(active.id, active.project as unknown as Project);
        session.selectSite(siteId);
        setNewSite({ name: '', x: '43', y: '49' });
        setError('');
        onError('');
      }).catch(report);
    } catch (cause) { report(cause); }
  };
  const moveCellTab = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? site.cells.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + site.cells.length) % site.cells.length;
    session.selectCell(site.cells[nextIndex].id);
    cellTabList.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[nextIndex]?.focus();
  };

  return <section className="site-planner-preview" aria-label="Site & cell planner preview route">
    <header className="site-planner-title">
      <div><p>5G RAN DIGITAL TWIN / SITE DESIGN</p><h1>Site &amp; cell planner</h1>
        <span>Configure schematic placement and three-sector cell targets. Coordinates remain planning estimates.</span></div>
      <div className="site-planner-shortcuts">
        <button type="button" className="button outline" onClick={() => onNavigate('map')}>See city map</button>
        <button type="button" className="button primary" onClick={() => onNavigate('radio')}>Radio &amp; GPS</button>
      </div>
    </header>
    <div className="site-planner-layout">
      <section className="site-planner-map panel" aria-label="Schematic site map">
        <header className="panel-header"><div><h2>Site placement</h2><p className="panel-caption">Schematic city map · not a surveyed basemap</p></div>
          <button type="button" className="button outline" aria-pressed={threeDimensional}
            onClick={() => setThreeDimensional(value => !value)}>{threeDimensional ? 'Return to schematic 2D' : 'Open 3D RF scene'}</button>
        </header>
        <div className="panel-body">{threeDimensional
          ? <><OpenSiteScene project={sceneProject} {...(sceneLoader ? { loadDriver: sceneLoader } : {})} />
            <section className="site-planner-scene-alternative" aria-label="3D scene site and sector list">
              <h3>Site and sector list</h3>
              <ul>{sceneProject.sites.map(candidate => {
                const location = candidate.radioLocation;
                const coordinates = Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
                  ? `${location.latitude!.toFixed(5)}, ${location.longitude!.toFixed(5)} · ${location.source === 'map-estimate' ? 'schematic map estimate' : 'manual'}`
                  : 'Geographic coordinates not set';
                return <li key={candidate.id}><button type="button" className="button outline"
                  aria-pressed={candidate.id === site.id} onClick={() => session.selectSite(candidate.id)}>
                  Select {candidate.name} ({candidate.id})
                </button><span>{coordinates}</span><span>{candidate.cells.map(sector => `${sector.id} ${sector.azimuthDeg}° sector`).join(' · ')}</span></li>;
              })}</ul>
            </section>
          </>
          : <MissionControlMap model={mapModel} onSelect={siteId => session.selectSite(siteId)}
            onNavigate={onNavigate} showInspector={false} />}</div>
      </section>
      <section className="site-planner-site panel" aria-label="Site configuration">
        <header className="panel-header"><div><h2>Site configuration</h2><p className="panel-caption">Virtual RU placement and front-end target</p></div>
          <span className="mini-pill">{site.id}</span></header>
        <div className="site-planner-site-list" role="group" aria-label="Select a site">
          {project.sites.map(candidate => <button key={candidate.id} type="button"
            aria-pressed={candidate.id === site.id} aria-label={`Select ${candidate.name} site ${candidate.id}`}
            onClick={() => session.selectSite(candidate.id)}>
            <strong>{candidate.id}</strong><span>{candidate.name}</span><small>{candidate.cells.length} planned cells</small>
          </button>)}
        </div>
        <div className="site-planner-fields">
          <label>Site name<input aria-label="Site name" value={siteValues.name}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:site:name`); setSiteValues(previous => ({ ...previous, name: event.target.value })); }}
            onBlur={event => commitSite('name', event.currentTarget.value)} maxLength={60} /></label>
          <label>Height (m)<input aria-label="Height (m)" type="number" min="1" max="300" value={siteValues.heightM}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:site:heightM`); setSiteValues(previous => ({ ...previous, heightM: Number(event.target.value) })); }}
            onBlur={event => commitSite('heightM', event.currentTarget.value)} /></label>
          <label>Virtual RF front end<select aria-label="Virtual RF front end" value={siteValues.frontEnd}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:site:frontEnd`); setSiteValues(previous => ({ ...previous, frontEnd: event.target.value as SiteDraft['frontEnd'] }));
              commitSite('frontEnd', event.target.value); }}>
            <option>Antenna</option><option>MMU</option>
          </select></label>
          <label>Map X position (%)<input aria-label="Map X position (%)" type="number" min="0" max="100" value={siteValues.x}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:site:x`); setSiteValues(previous => ({ ...previous, x: Number(event.target.value) })); }}
            onBlur={event => commitSite('x', event.currentTarget.value)} /></label>
          <label>Map Y position (%)<input aria-label="Map Y position (%)" type="number" min="0" max="100" value={siteValues.y}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:site:y`); setSiteValues(previous => ({ ...previous, y: Number(event.target.value) })); }}
            onBlur={event => commitSite('y', event.currentTarget.value)} /></label>
        </div>
        <p className="site-planner-note">Changing map percentages creates a schematic map estimate for Radio planner. Verify geographic coordinates before deployment.</p>
      </section>
    </div>
    <div className="site-planner-detail-layout">
      <section className="site-planner-cell panel" aria-label="Cell and sector parameters">
        <header className="panel-header"><div><h2>Cell / sector parameters</h2><p className="panel-caption">{site.name} · RF calibration is pending</p></div></header>
        <div ref={cellTabList} className="site-planner-cell-tabs" role="tablist" aria-label={`${site.name} sectors`}>
          {site.cells.map((candidate, index) => <button key={candidate.id} role="tab" type="button"
            tabIndex={candidate.id === cell.id ? 0 : -1} aria-selected={candidate.id === cell.id}
            onKeyDown={event => moveCellTab(event, index)} onClick={() => session.selectCell(candidate.id)}>
            {candidate.id} · {candidate.azimuthDeg}°
          </button>)}
        </div>
        <div className="site-planner-fields site-planner-cell-fields" role="tabpanel" aria-label={`${cell.id} parameters`}>
          <label>Azimuth (°)<input aria-label="Azimuth (°)" type="number" min="0" max="359" value={cellValues.azimuthDeg}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:${cell.id}:cell:azimuthDeg`); setCellValues(previous => ({ ...previous, azimuthDeg: Number(event.target.value) })); }}
            onBlur={event => commitCell('azimuthDeg', event.currentTarget.value)} /></label>
          <label>Downtilt (°)<input aria-label="Downtilt (°)" type="number" min="0" max="30" value={cellValues.downtiltDeg}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:${cell.id}:cell:downtiltDeg`); setCellValues(previous => ({ ...previous, downtiltDeg: Number(event.target.value) })); }}
            onBlur={event => commitCell('downtiltDeg', event.currentTarget.value)} /></label>
          <label>Tx power (dBm)<input aria-label="Tx power (dBm)" type="number" min="0" max="60" value={cellValues.txPowerDbm}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:${cell.id}:cell:txPowerDbm`); setCellValues(previous => ({ ...previous, txPowerDbm: Number(event.target.value) })); }}
            onBlur={event => commitCell('txPowerDbm', event.currentTarget.value)} /></label>
          <label>Bandwidth (MHz)<input aria-label="Bandwidth (MHz)" type="number" min="5" max="400" value={cellValues.bandwidthMhz}
            onChange={event => { dirtyFields.current.add(`${record.id}:${site.id}:${cell.id}:cell:bandwidthMhz`); setCellValues(previous => ({ ...previous, bandwidthMhz: Number(event.target.value) })); }}
            onBlur={event => commitCell('bandwidthMhz', event.currentTarget.value)} /></label>
        </div>
        <p className="site-planner-note">Pattern: {cell.antenna} · RF calibration is pending.</p>
      </section>
      <section className="site-planner-add panel" aria-label="Add a planned site">
        <header className="panel-header"><div><h2>Add a planned site</h2><p className="panel-caption">A new site starts with three virtual cells</p></div></header>
        <form aria-label="Add planned site" onSubmit={createSite} className="site-planner-add-fields">
          <label>New site name<input aria-label="New site name" value={newSite.name} required maxLength={60}
            placeholder="e.g. North Tower" onChange={event => setNewSite(previous => ({ ...previous, name: event.target.value }))} /></label>
          <label>New site X position (%)<input aria-label="New site X position (%)" type="number" min="0" max="100" required
            value={newSite.x} onChange={event => setNewSite(previous => ({ ...previous, x: event.target.value }))} /></label>
          <label>New site Y position (%)<input aria-label="New site Y position (%)" type="number" min="0" max="100" required
            value={newSite.y} onChange={event => setNewSite(previous => ({ ...previous, y: event.target.value }))} /></label>
          <button type="submit" className="button primary">Add site</button>
        </form>
        <p className="site-planner-note">Coordinates are canvas percentages until a real scene is imported and georeferenced.</p>
      </section>
    </div>
    {error && <p className="site-planner-error" role="alert">Input rejected · {error}</p>}
  </section>;
}
