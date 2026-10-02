import { useState } from 'react';
import OpenSiteScene, { type SiteSceneProject } from '../site-planner/OpenSiteScene';
import type { ProjectMapSession } from '../city-map/ProjectMapSession';
import type { DriveSample } from '../ray-tracing/driveKpi';

export default function DriveGeographicMap({ project, samples, session, view, onSelect }: {
  project: SiteSceneProject; samples: DriveSample[]; session: ProjectMapSession;
  view: ReturnType<ProjectMapSession['getSnapshot']>; onSelect: (index: number) => void;
}) {
  const [fitRequest, setFitRequest] = useState(0);
  const site = project.sites.find(site => site.id === view.siteId) ?? project.sites[0];
  const scene: SiteSceneProject = { ...project, driveView: { samples, metric: view.metric,
    selectedIndex: view.selectedIndex ?? samples[0]?.index ?? null, visible: view.driveVisible, interactive: true },
    radioView: site ? { siteId: site.id, receiver: null, beam: { azimuthDeg: site.cells[0].azimuthDeg,
      downtiltDeg: site.cells[0].downtiltDeg, widthDeg: 65 }, previewPaths: [], showBeam: false, showDirect: false,
      showReflections: false, showSaved: false, showSites: view.sitesVisible, showContext: view.contextVisible } : undefined };
  return <div className="drive-geographic-map">
    <div role="group" aria-label="Drive map view" className="drive-map-controls">
      <button type="button" aria-pressed={view.mapMode === '2d'} onClick={() => session.update({ mapMode: '2d' })}>2D map</button>
      <button type="button" aria-pressed={view.mapMode === 'project-3d'} onClick={() => session.update({ mapMode: 'project-3d' })}>Project 3D</button>
      <button type="button" onClick={() => { session.update({ driveVisible: true }); setFitRequest(value => value + 1); }}>Fit drive route</button>
      <label><input type="checkbox" checked={view.sitesVisible} onChange={event => session.update({ sitesVisible: event.target.checked })} />Cell sites</label>
      <label><input type="checkbox" checked={view.driveVisible} onChange={event => session.update({ driveVisible: event.target.checked })} />Drive trace</label>
    </div>
    <OpenSiteScene project={scene} viewport={view.viewport} onViewChange={viewport => session.update({ viewport })}
      camera={{ yaw: 35, pitch: view.mapMode === '2d' ? 0 : view.pitch, zoom: 1 }} fitDriveRequest={fitRequest} onSelectDriveSample={onSelect} />
    <p>Original WGS84 samples · trace height 1.5 m above flat ground · filters, sample selection and map extent shared across workspaces.</p>
  </div>;
}
