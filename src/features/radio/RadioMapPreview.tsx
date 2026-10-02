import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import { MissionControlSiteInspector } from '../mission-control/MissionControlMap';
import { buildMissionMapModel } from '../mission-control/missionMapModel';
import MapScopeControls from '../city-map/MapScopeControls';
import { useProjectMapView } from '../city-map/ProjectMapSession';
import OpenSiteScene, { type SceneCamera, type SiteSceneProject } from '../site-planner/OpenSiteScene';
import DriveKpiControls, { DriveKpiInspector } from '../ray-tracing/DriveKpiControls';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';
import type { GeoPoint } from '../ray-tracing/propagationGeometry';
import { placeRadioAtCoordinates, placeRadioOnMap } from './radioCommands';
import { RadioSession } from './RadioSession';
import '../city-map/city-map.css';
import '../ray-tracing/ray-tracing.css';

const OpenCityScene = lazy(() => import('../city-map/OpenCityScene'));
type ProjectRecord = WorkspaceSnapshot['projects'][number];
type MapMode = '2d' | 'project-3d' | 'city';
type Props = { controller: AppController; record: ProjectRecord; session: RadioSession;
  onError: (message: string) => void; onComplete?: () => void; onNavigate: (route: 'site-position' | 'planner' | 'ray') => void };

export default function RadioMapPreview({ controller, record, session, onError, onComplete, onNavigate }: Props) {
  const workspaceState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = workspaceState.workspace?.projects.find(item => item.id === record.id) ?? record;
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const project = record.project as unknown as SiteSceneProject;
  const { session: mapSession, view } = useProjectMapView(controller, record.id, project.map);
  const [saving, setSaving] = useState(false);
  const [exploringCity, setExploringCity] = useState(false);
  const mapMode: MapMode = exploringCity ? 'city' : view.mapMode;
  const setMapMode = (mode: MapMode) => {
    setExploringCity(mode === 'city');
    if (mode !== 'city') mapSession.update({ mapMode: mode });
  };
  const [camera, setCamera] = useState<SceneCamera>({ yaw: 35, pitch: 52, zoom: 1 });
  const [fitDriveRequest, setFitDriveRequest] = useState(0), [fitSitesRequest, setFitSitesRequest] = useState(0);
  const [placementX, setPlacementX] = useState('50'), [placementY, setPlacementY] = useState('50');
  const pending = useRef(false);
  const siteId = state.placementSiteId ?? view.siteId ?? state.selectedSiteId ?? project.sites[0]?.id ?? '';
  const model = buildMissionMapModel(record, siteId);
  const measurements = (record.project as { driveMeasurements?: DriveMeasurements | null }).driveMeasurements ?? null;
  const samples = useMemo(() => measurements?.samples.filter(sample => view.technology === 'ALL' || sample.technology === view.technology) ?? [], [measurements, view.technology]);
  const selectedIndex = samples.some(sample => sample.index === view.selectedIndex) ? view.selectedIndex : samples[0]?.index ?? null;
  const positionedCount = project.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude)).length;
  const sceneProject: SiteSceneProject = { ...project,
    driveView: { samples, metric: view.metric, selectedIndex, visible: view.driveVisible, interactive: !state.placementSiteId },
    radioView: { receiver: null, siteId, beam: { azimuthDeg: 0, downtiltDeg: 0, widthDeg: 65 }, previewPaths: [],
      showBeam: false, showDirect: true, showReflections: true, showSaved: true, showSites: view.sitesVisible, showContext: view.contextVisible } };
  useEffect(() => { if (!mapSession.getSnapshot().viewport) setFitDriveRequest(value => value + 1); }, [mapSession]);
  useEffect(() => { if (state.placementSiteId) mapSession.update({ siteId: state.placementSiteId }); }, [state.placementSiteId, mapSession]);

  const place = (position: { x: number; y: number } | GeoPoint) => {
    const target = state.placementSiteId;
    if (!target || pending.current) return;
    let request: Promise<void> | null;
    try {
      request = 'latitude' in position ? placeRadioAtCoordinates(controller, record.id, target, position)
        : placeRadioOnMap(controller, record.id, target, position);
      if (!request) throw new Error('The selected radio site is no longer available.');
    } catch (error) { onError(error instanceof Error ? error.message : String(error)); return; }
    pending.current = true; setSaving(true);
    void request.then(() => { session.cancelPlacement(); onError(''); onComplete?.(); })
      .catch(error => onError(error instanceof Error ? error.message : String(error)))
      .finally(() => { pending.current = false; setSaving(false); });
  };
  const submitPlacement = (event: FormEvent) => {
    event.preventDefault();
    if (placementX.trim() && placementY.trim()) place({ x: Number(placementX), y: Number(placementY) });
  };

  return <section className="radio-map-preview" aria-label="Radio map preview route">
    {saving && <p role="status">Saving radio location…</p>}
    {mapMode === 'city' ? <Suspense fallback={<p role="status">Loading open city explorer…</p>}><OpenCityScene onClose={() => setExploringCity(false)} /></Suspense> : <>
      <div className="radio-map-heading"><div><p className="preview-eyebrow">PROJECT / GEOGRAPHIC WORKSPACE</p><h1>City map</h1>
        <p>The same streets, sites and drive-test data as Ray Tracing Lab.</p></div>
        <button type="button" className="button primary" onClick={() => onNavigate('ray')}>Open ray tracing lab ↗</button></div>
      <section className="radio-map-project-scene" aria-label={mapMode === '2d' ? 'Project 2D view' : 'Project 3D view'}>
        <div className="radio-map-city-action"><p>{record.name} · WGS84 · {positionedCount} / {project.sites.length} sites positioned</p>
          <div className="radio-map-modes" role="group" aria-label="Map view">
            <button type="button" className="button outline" aria-pressed={mapMode === '2d'} onClick={() => setMapMode('2d')}>2D map</button>
            <button type="button" className="button outline" aria-pressed={mapMode === 'project-3d'} onClick={() => setMapMode('project-3d')}>Project 3D</button>
          </div></div>
        {measurements && <DriveKpiControls measurements={measurements} samples={samples} metric={view.metric} technology={view.technology}
          visible={view.driveVisible} busy={saving} error="" onMetric={metric => mapSession.update({ metric })}
          onTechnology={technology => mapSession.update({ technology, selectedIndex: null })}
          onVisible={driveVisible => mapSession.update({ driveVisible })} onFit={() => setFitDriveRequest(value => value + 1)} />}
        <div className="radio-map-camera" role="group" aria-label="Map camera controls">
          <label><input type="checkbox" checked={view.sitesVisible} onChange={event => mapSession.update({ sitesVisible: event.target.checked })} />Cell sites</label>
          <label><input type="checkbox" checked={view.contextVisible} onChange={event => mapSession.update({ contextVisible: event.target.checked })} />Open map context</label>
          <button type="button" disabled={!positionedCount} onClick={() => { mapSession.update({ sitesVisible: true }); setFitSitesRequest(value => value + 1); }}>Fit cell sites</button>
          <button type="button" aria-label="Rotate left" onClick={() => setCamera(value => ({ ...value, yaw: ((view.viewport?.bearing ?? value.yaw) + 345) % 360 }))}>↶ Rotate</button>
          <button type="button" aria-label="Rotate right" onClick={() => setCamera(value => ({ ...value, yaw: ((view.viewport?.bearing ?? value.yaw) + 15) % 360 }))}>Rotate ↷</button>
          {mapMode === 'project-3d' && <>
            <button type="button" aria-label="Lower tilt" onClick={() => mapSession.update({ pitch: Math.max(20, view.pitch - 8) })}>− Tilt</button>
            <button type="button" aria-label="Raise tilt" onClick={() => mapSession.update({ pitch: Math.min(70, view.pitch + 8) })}>+ Tilt</button></>}
          <button type="button" aria-label="Zoom out" onClick={() => { if (view.viewport) mapSession.update({ viewport: { ...view.viewport, zoom: Math.max(10, view.viewport.zoom - .5) } }); else setCamera(value => ({ ...value, zoom: Math.max(.5, value.zoom - .1) })); }}>− Zoom</button>
          <button type="button" aria-label="Zoom in" onClick={() => { if (view.viewport) mapSession.update({ viewport: { ...view.viewport, zoom: Math.min(19, view.viewport.zoom + .5) } }); else setCamera(value => ({ ...value, zoom: Math.min(2.5, value.zoom + .1) })); }}>+ Zoom</button>
        </div>
        {state.placementSiteId && <form className="radio-map-placement" aria-label={`Radio map placement for ${state.placementSiteId}`} onSubmit={submitPlacement}>
          <div><strong>Place {state.placementSiteId} radio</strong><p>Click the street map for WGS84 coordinates, or enter a position within the project scope.</p></div>
          <label>Map X position (%)<input type="number" min="0" max="100" step="0.1" required disabled={saving} value={placementX} onChange={event => setPlacementX(event.target.value)} /></label>
          <label>Map Y position (%)<input type="number" min="0" max="100" step="0.1" required disabled={saving} value={placementY} onChange={event => setPlacementY(event.target.value)} /></label>
          <button type="submit" disabled={saving}>Place radio at these coordinates</button>
          <button type="button" disabled={saving} onClick={() => session.cancelPlacement()}>Cancel placement</button>
        </form>}
        <OpenSiteScene project={sceneProject} camera={{ ...camera, pitch: mapMode === '2d' ? 0 : view.pitch }}
          viewport={view.viewport} onViewChange={viewport => mapSession.update({ viewport })}
          fitDriveRequest={fitDriveRequest} fitSitesRequest={fitSitesRequest} onPick={place}
          onSelectDriveSample={selectedIndex => mapSession.update({ selectedIndex })} />
        {measurements && <DriveKpiInspector measurements={measurements} sites={project.sites} onSite={siteId => mapSession.update({ siteId })} samples={samples} metric={view.metric} selectedIndex={selectedIndex} onSelect={selectedIndex => mapSession.update({ selectedIndex })} />}
      </section>
      <div className="radio-map-site-details"><div className="mission-control-site-list" role="group" aria-label="Site list">
        {project.sites.map(site => <button type="button" key={site.id} aria-label={`${site.name} in site list`} aria-pressed={site.id === siteId}
          onClick={() => { session.selectSite(site.id); mapSession.update({ siteId: site.id }); }}>{site.name} · {site.id}</button>)}
      </div>{model.kind === 'ready' && <MissionControlSiteInspector model={model} onNavigate={onNavigate} />}</div>
      <details className="radio-map-settings" open><summary>Project map scope &amp; building geometry</summary><MapScopeControls controller={controller} record={record} /></details>
      <div className="radio-map-open-card"><div><span>OPEN MAP / CITY EXPLORER</span><h2>Explore Silicon Valley.</h2><p>Palo Alto · Mountain View · San Jose</p></div>
        <div><button type="button" onClick={() => setMapMode('city')}>Open Silicon Valley ↗</button>
          <button type="button" onClick={() => setMapMode('city')}>Explore 3D city</button></div></div>
    </>}
  </section>;
}
