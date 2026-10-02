import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { useProjectMapView } from '../city-map/ProjectMapSession';
import { SitePlannerSession, type InspectorTab } from './SitePlannerSession';
import type { RadioSession } from '../radio/RadioSession';
import SiteInspector, { type InspectorSite } from './SiteInspector';
import { addPlannedSite } from './sitePlannerCommands';
import OpenSiteScene, { type SceneLoader, type SiteSceneProject } from './OpenSiteScene';
import './site-planner.css';
import './sites-cells.css';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type Project = { sites: InspectorSite[]; map: SiteSceneProject['map'] };
function messageFrom(error: unknown) { return error instanceof Error ? error.message : String(error); }

export default function SitePlannerPreviewLeaf({ controller, record, session, onError, onNavigate, sceneLoader, radioSession, initialTab }: {
  controller: AppController;
  record: ProjectRecord;
  session: SitePlannerSession;
  onError: (message: string) => void;
  onNavigate: (route: string) => void;
  sceneLoader?: SceneLoader;
  radioSession?: RadioSession;
  initialTab?: InspectorTab;
}) {
  const workspaceState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = workspaceState.workspace?.projects.find(item => item.id === record.id) ?? record;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const project = record.project as unknown as Project;
  const sceneProject = record.project as unknown as SiteSceneProject;
  const site = project.sites.find(candidate => candidate.id === state.selectedSiteId) ?? project.sites[0];
  const cell = site.cells.find(candidate => candidate.id === state.selectedCellId) ?? site.cells[0];
  const [newSite, setNewSite] = useState({ name: '', x: '43', y: '49' });
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [siteFilter, setSiteFilter] = useState<'all' | 'positioned' | 'unassigned'>('all');
  const [fitSitesRequest, setFitSitesRequest] = useState(0);
  const newSiteName = useRef<HTMLInputElement>(null);
  const { session: mapSession, view: mapView } = useProjectMapView(controller, record.id, project.map);
  const threeDimensional = mapView.mapMode === 'project-3d';
  const setThreeDimensional = (value: boolean) => mapSession.update({ mapMode: value ? 'project-3d' : '2d' });
  useEffect(() => { session.setProject(record.id, project); }, [record.id, project, session]);
  useEffect(() => { if (initialTab) session.selectInspectorTab(initialTab); }, [record.id, initialTab, session]);
  const isPositioned = (id: string) => {
    const location = sceneProject.sites.find(candidate => candidate.id === id)?.radioLocation;
    return Number.isFinite(location?.latitude) && Number.isFinite(location?.longitude);
  };
  const positionedCount = project.sites.filter(candidate => isPositioned(candidate.id)).length;
  const visibleSites = project.sites.filter(candidate => `${candidate.id} ${candidate.name}`.toLowerCase().includes(search.trim().toLowerCase()) &&
    (siteFilter === 'all' || isPositioned(candidate.id) === (siteFilter === 'positioned')));
  const mapProject: SiteSceneProject = { ...sceneProject, radioView: { receiver: null, siteId: site.id,
    beam: { azimuthDeg: cell.azimuthDeg, downtiltDeg: cell.downtiltDeg, widthDeg: 65 }, previewPaths: [],
    showBeam: true, showDirect: false, showReflections: false, showSaved: false, showSites: true, showContext: mapView.contextVisible } };
  const selectSite = (id: string) => { session.selectSite(id); mapSession.update({ siteId: id }); };
  useEffect(() => {
    const selected = mapSession.getSnapshot().siteId;
    if (selected && project.sites.some(candidate => candidate.id === selected)) session.selectSite(selected);
    if (!mapSession.getSnapshot().viewport) setFitSitesRequest(value => value + 1);
  }, [mapSession, session]);

  const report = (cause: unknown) => {
    const message = messageFrom(cause);
    setError(message);
    onError(message);
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
        selectSite(siteId); setSearch(''); setSiteFilter('all');
        setNewSite({ name: '', x: '43', y: '49' });
        setError('');
        onError('');
      }).catch(report);
    } catch (cause) { report(cause); }
  };
  return <section className="site-planner-preview commercial-planner" aria-label="Site & cell planner preview route">
    <header className="site-planner-title">
      <div><p>NETWORK DESIGN <span>/</span> {record.name}</p><h1>Sites and Cells</h1>
        <span>Shape your radio network, one site and sector at a time.</span></div>
      <div className="site-planner-shortcuts">
        <button type="button" className="button outline" onClick={() => onNavigate('map')}>See city map</button>
        <button type="button" className="button primary" onClick={() => { newSiteName.current?.focus(); newSiteName.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' }); }}>＋ New site</button>
      </div>
    </header>
    <div className="sp-overview" aria-label="Network planning summary">
      <div><span>PLANNED SITES</span><strong>{project.sites.length.toString().padStart(2, '0')}</strong><small>Network inventory</small></div>
      <div><span>CELL SECTORS</span><strong>{project.sites.reduce((sum, candidate) => sum + candidate.cells.length, 0).toString().padStart(2, '0')}</strong><small>Configured RF targets</small></div>
      <div><span>GEOGRAPHIC POSITIONS</span><strong>{positionedCount}<em> / {project.sites.length}</em></strong><small>{positionedCount === project.sites.length ? 'All sites positioned' : `${project.sites.length - positionedCount} need coordinates`}</small></div>
      <div className="sp-save-status" role="status"><span>WORKSPACE STATUS</span><strong>{workspaceState.status === 'saving' ? 'Saving changes…' : workspaceState.status === 'ready' && !workspaceState.dirty ? 'All changes saved' : 'Review save status'}</strong><small>Planning configuration · RF calibration pending</small></div>
    </div>
    {error && <p className="site-planner-error" role="alert">Input rejected · {error}</p>}
    <div className="site-planner-layout">
      <aside className="sp-inventory panel" aria-label={threeDimensional ? '3D scene site and sector list' : 'Site inventory'}>
        <header><h2>Sites <span>{project.sites.length}</span></h2><p>Select a site to configure</p></header>
        <label className="sp-search"><span>⌕</span><input aria-label="Search sites" type="search" placeholder="Search name or site ID" value={search} onChange={event => setSearch(event.target.value)} /></label>
        <div className="sp-site-filters" role="group" aria-label="Filter sites">{([['all', 'All'], ['positioned', 'Positioned'], ['unassigned', 'Needs location']] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={siteFilter === value} onClick={() => setSiteFilter(value)}>{label}</button>)}</div>
        <div className="site-planner-site-list" role="group" aria-label="Select a site">
          {visibleSites.map(candidate => <button key={candidate.id} type="button"
            data-radio-site={candidate.id} aria-pressed={candidate.id === site.id} aria-label={`Select ${candidate.name} site ${candidate.id}`}
            onClick={() => { selectSite(candidate.id); radioSession?.selectSite(candidate.id); }}>
            <strong><i />{candidate.id}<em>{candidate.frontEnd}</em></strong><span>{candidate.name}</span>
            <small>{candidate.cells.length} sectors · {isPositioned(candidate.id) ? 'Positioned' : 'Geographic coordinates not set'}</small>
            <span className="sp-site-sector-summary">{candidate.cells.map(sector => `${sector.id} ${sector.azimuthDeg}° sector`).join(' · ')}</span>
          </button>)}
          {!visibleSites.length && <p className="sp-search-empty">No sites match these filters.<button type="button" onClick={() => { setSearch(''); setSiteFilter('all'); }}>Clear filters</button></p>}
        </div>
        <footer>{visibleSites.length} of {project.sites.length} sites</footer>
      </aside>
      <section className="site-planner-map panel" aria-label="Geographic site map">
        <header className="panel-header"><div><p className="sp-kicker">GEOGRAPHIC WORKSPACE</p><h2>Network layout</h2><p className="panel-caption">Open street map · project site coordinates</p></div>
          <div className="sp-map-controls" role="group" aria-label="Planner map view">
            <button type="button" aria-pressed={!threeDimensional} onClick={() => setThreeDimensional(false)}>2D map</button>
            <button type="button" aria-pressed={threeDimensional} onClick={() => setThreeDimensional(true)}>3D scene</button>
            <button type="button" disabled={!positionedCount} onClick={() => setFitSitesRequest(value => value + 1)}>Fit sites</button>
          </div>
        </header>
        <div className="panel-body"><OpenSiteScene project={mapProject} camera={{ yaw: 35, pitch: threeDimensional ? mapView.pitch : 0, zoom: 1 }}
          viewport={mapView.viewport} onViewChange={viewport => mapSession.update({ viewport })} fitSitesRequest={fitSitesRequest}
          {...(sceneLoader ? { loadDriver: sceneLoader } : {})} />
          <div className="sp-map-caption"><span><i />{site.name} · {site.id}</span><span>Selected sector {cell.azimuthDeg}° · {site.heightM} m</span></div>
        </div>
      </section>
      <SiteInspector key={record.id} controller={controller} record={record} site={site} cell={cell} session={session} tab={state.inspectorTab}
        onError={message => { setError(message); onError(message); }} onNavigate={onNavigate}
        onPlace={radioSession ? () => { radioSession.startPlacement(site.id); onNavigate('map'); } : undefined} />
    </div>
    <div className="site-planner-detail-layout">
      <section className="site-planner-add panel" aria-label="Add a planned site">
        <header className="panel-header"><div><p className="sp-kicker">EXTEND THE NETWORK</p><h2>Add a planned site</h2><p className="panel-caption">Start with three configured cell sectors</p></div></header>
        <form aria-label="Add planned site" onSubmit={createSite} className="site-planner-add-fields">
          <label>New site name<input ref={newSiteName} aria-label="New site name" value={newSite.name} required maxLength={60}
            placeholder="e.g. North Tower" onChange={event => setNewSite(previous => ({ ...previous, name: event.target.value }))} /></label>
          <label>New site X position (%)<input aria-label="New site X position (%)" type="number" min="0" max="100" required
            value={newSite.x} onChange={event => setNewSite(previous => ({ ...previous, x: event.target.value }))} /></label>
          <label>New site Y position (%)<input aria-label="New site Y position (%)" type="number" min="0" max="100" required
            value={newSite.y} onChange={event => setNewSite(previous => ({ ...previous, y: event.target.value }))} /></label>
          <button type="submit" className="button primary">Add site</button>
        </form>
        <p className="site-planner-note">Project scope position is a planning input. Add geographic coordinates in the Position tab.</p>
      </section>
    </div>
    <footer className="sp-workspace-footer"><span>PROJECT SCOPED <i /> WGS84 / EPSG:4326</span><p>Site and sector configuration is saved locally. Network execution and RF calibration remain pending.</p></footer>
  </section>;
}
