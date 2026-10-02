import { useMemo, useState } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { ProjectMapSession } from '../city-map/ProjectMapSession';
import OpenSiteScene, { type SiteSceneProject } from '../site-planner/OpenSiteScene';
import DriveKpiControls, { DriveKpiInspector } from '../ray-tracing/DriveKpiControls';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';
import type { buildMissionMapModel } from './missionMapModel';
import type { MapLayers } from './MissionControlMap';
import '../ray-tracing/ray-tracing.css';

type Record = WorkspaceSnapshot['projects'][number];
type ReadyMap = Extract<ReturnType<typeof buildMissionMapModel>, { kind: 'ready' }>;

export default function MissionControlProjectMap({ record, model, session, view, onSelect, layers }: {
  record: Record; model: ReadyMap; session: ProjectMapSession;
  view: ReturnType<ProjectMapSession['getSnapshot']>; onSelect: (id: string) => void; layers?: MapLayers;
}) {
  const project = record.project as unknown as SiteSceneProject;
  const measurements = (record.project as { driveMeasurements?: DriveMeasurements | null }).driveMeasurements ?? null;
  const samples = useMemo(() => measurements?.samples.filter(sample => view.technology === 'ALL' || sample.technology === view.technology) ?? [], [measurements, view.technology]);
  const selectedIndex = samples.some(sample => sample.index === view.selectedIndex) ? view.selectedIndex : samples[0]?.index ?? null;
  const [fitSitesRequest, setFitSitesRequest] = useState(0), [fitDriveRequest, setFitDriveRequest] = useState(0);
  const selected = project.sites.find(site => site.id === model.selectedSite.id)!;
  const cell = selected.cells[0];
  const positioned = project.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude)).length;
  const sceneProject: SiteSceneProject = { ...project,
    driveView: { samples, metric: view.metric, selectedIndex, visible: view.driveVisible && layers?.ues !== false, interactive: true },
    radioView: { receiver: null, siteId: selected.id,
      beam: { azimuthDeg: cell.azimuthDeg, downtiltDeg: cell.downtiltDeg, widthDeg: 65 }, previewPaths: [],
      showBeam: layers?.sectors === true, showDirect: false, showReflections: false, showSaved: false,
      showSites: view.sitesVisible, showContext: view.contextVisible } };
  return <section className="mission-control-map-panel mission-control-project-map" aria-label="City and cluster radio environment">
    <header><div><h2>City / cluster radio environment</h2><p>{model.map.city} / {model.map.cluster} · {positioned} / {project.sites.length} sites positioned</p>
      <p>WGS84 center {project.map.latitude.toFixed(5)}, {project.map.longitude.toFixed(5)} · radius {project.map.radiusMeters} m</p></div><span>PROJECT MAP</span></header>
    <div className="mission-control-project-map-controls" role="group" aria-label="Mission Control map view">
      <button type="button" aria-pressed={view.mapMode === '2d'} onClick={() => session.update({ mapMode: '2d' })}>2D map</button>
      <button type="button" aria-pressed={view.mapMode === 'project-3d'} onClick={() => session.update({ mapMode: 'project-3d' })}>Project 3D</button>
      <button type="button" disabled={!positioned} onClick={() => { session.update({ sitesVisible: true }); setFitSitesRequest(value => value + 1); }}>Fit cell sites</button>
      <label><input type="checkbox" checked={view.sitesVisible} onChange={event => session.update({ sitesVisible: event.target.checked })} />Cell sites</label>
      <label><input type="checkbox" checked={view.contextVisible} onChange={event => session.update({ contextVisible: event.target.checked })} />Open map context</label>
    </div>
    {measurements && <DriveKpiControls measurements={measurements} samples={samples} metric={view.metric} technology={view.technology}
      visible={view.driveVisible} busy={false} error="" onMetric={metric => session.update({ metric })}
      onTechnology={technology => session.update({ technology, selectedIndex: null })}
      onVisible={driveVisible => session.update({ driveVisible })} onFit={() => setFitDriveRequest(value => value + 1)} />}
    <OpenSiteScene project={sceneProject} camera={{ yaw: 35, pitch: view.mapMode === '2d' ? 0 : view.pitch, zoom: 1 }}
      viewport={view.viewport} onViewChange={viewport => session.update({ viewport })}
      fitDriveRequest={fitDriveRequest} fitSitesRequest={fitSitesRequest}
      onSelectDriveSample={selectedIndex => session.update({ selectedIndex })} />
    {measurements && <DriveKpiInspector measurements={measurements} sites={project.sites} onSite={siteId => { session.update({ siteId }); onSelect(siteId); }} samples={samples} metric={view.metric} selectedIndex={selectedIndex} onSelect={selectedIndex => session.update({ selectedIndex })} />}
    <div className="mission-control-site-list" role="group" aria-label="Site list">
      {project.sites.map(site => <button type="button" key={site.id} aria-label={`${site.name} in site list`}
        aria-pressed={site.id === selected.id} onClick={() => onSelect(site.id)}>{site.name} · {site.id}
        {(!Number.isFinite(site.radioLocation.latitude) || !Number.isFinite(site.radioLocation.longitude)) && <small> · Coordinates not set</small>}
      </button>)}
    </div>
    <p className="mission-control-project-map-note">Map area and site selection are shared with City map, Site &amp; cell planner and Ray tracing lab. Unpositioned sites need radio coordinates. Open streets provide visual context; RF inputs use the project’s imported geometry.</p>
  </section>;
}
