import { lazy, Suspense, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import MissionControlMap, { type MapLayers } from '../mission-control/MissionControlMap';
import { buildMissionMapModel } from '../mission-control/missionMapModel';
import MapScopeControls from '../city-map/MapScopeControls';
import OpenSiteScene, { type SceneCamera, type SiteSceneProject } from '../site-planner/OpenSiteScene';
import '../city-map/city-map.css';
import { placeRadioOnMap } from './radioCommands';
import { RadioSession } from './RadioSession';

const OpenCityScene = lazy(() => import('../city-map/OpenCityScene'));

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type MapMode = '2d' | 'project-3d' | 'city';
type Props = {
  controller: AppController;
  record: ProjectRecord;
  session: RadioSession;
  onError: (message: string) => void;
  onComplete?: () => void;
  onNavigate: (route: 'radio' | 'planner') => void;
};

export default function RadioMapPreview({ controller, record, session, onError, onComplete, onNavigate }: Props) {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [saving, setSaving] = useState(false);
  const [mapMode, setMapMode] = useState<MapMode>('2d');
  const [camera, setCamera] = useState<SceneCamera>({ yaw: 35, pitch: 48, zoom: 1 });
  const [layers, setLayers] = useState<MapLayers>({ buildings: true, sectors: true, ues: true });
  const pending = useRef(false);
  const model = buildMissionMapModel(record, state.selectedSiteId ?? undefined);

  const place = (position: { x: number; y: number }) => {
    const siteId = state.placementSiteId;
    if (!siteId || pending.current) return;
    let request: Promise<void> | null;
    try {
      request = placeRadioOnMap(controller, record.id, siteId, position);
      if (!request) throw new Error('The selected radio site is no longer available.');
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return;
    }
    pending.current = true;
    setSaving(true);
    void request.then(() => {
      session.cancelPlacement();
      onError('');
      onComplete?.();
    }).catch(error => {
      onError(error instanceof Error ? error.message : String(error));
    }).finally(() => {
      pending.current = false;
      setSaving(false);
    });
  };

  return <section className="radio-map-preview" aria-label="Radio map preview route">
    {saving && <p role="status">Saving estimated radio location…</p>}
    {mapMode === 'city' ? <Suspense fallback={<p role="status">Loading open city explorer…</p>}><OpenCityScene onClose={() => setMapMode('2d')} /></Suspense>
      : <>
      <div className="radio-map-heading"><div><p className="preview-eyebrow">SPATIAL WORKSPACE</p><h1>City &amp; network</h1><p>Design in project coordinates. Explore the real world for context.</p></div>
        <button type="button" className="button primary" onClick={() => setMapMode('city')}>Explore 3D city</button></div>
      <div className="radio-map-open-card"><div><span>CALIFORNIA / OPEN MAP</span><h2>A better view of Silicon Valley.</h2><p>Real building footprints, street context, and an interactive 3D perspective. Palo Alto · Mountain View · San Jose.</p></div>
        <button type="button" onClick={() => setMapMode('city')}>Open Silicon Valley ↗</button></div>
      <div className="radio-map-city-action"><p>Project geometry · separate from the open city example</p>
        <div className="radio-map-modes" role="group" aria-label="Map view">
          <button type="button" className="button outline" aria-pressed={mapMode === '2d'} onClick={() => setMapMode('2d')}>2D map</button>
          <button type="button" className="button outline" aria-pressed={mapMode === 'project-3d'} onClick={() => setMapMode('project-3d')}>Project 3D</button>
        </div>
      </div>
      <MapScopeControls controller={controller} record={record} />
      {mapMode === 'project-3d' ? <section className="radio-map-project-scene" aria-label="Project 3D view">
        <div className="radio-map-camera" role="group" aria-label="3D camera controls">
          <button type="button" aria-label="Rotate left" onClick={() => setCamera(value => ({ ...value, yaw: (value.yaw + 345) % 360 }))}>↶ Rotate</button>
          <button type="button" aria-label="Rotate right" onClick={() => setCamera(value => ({ ...value, yaw: (value.yaw + 15) % 360 }))}>Rotate ↷</button>
          <button type="button" aria-label="Lower tilt" onClick={() => setCamera(value => ({ ...value, pitch: Math.max(20, value.pitch - 8) }))}>− Tilt</button>
          <button type="button" aria-label="Raise tilt" onClick={() => setCamera(value => ({ ...value, pitch: Math.min(70, value.pitch + 8) }))}>+ Tilt</button>
          <button type="button" aria-label="Zoom out" onClick={() => setCamera(value => ({ ...value, zoom: Math.max(.5, Math.round((value.zoom - .1) * 10) / 10) }))}>− Zoom</button>
          <button type="button" aria-label="Zoom in" onClick={() => setCamera(value => ({ ...value, zoom: Math.min(2.5, Math.round((value.zoom + .1) * 10) / 10) }))}>+ Zoom</button>
          <span>Yaw {camera.yaw}° · tilt {camera.pitch}° · zoom {camera.zoom.toFixed(1)}×</span>
        </div>
        <OpenSiteScene project={record.project as unknown as SiteSceneProject} camera={camera} />
      </section> : <MissionControlMap model={model} onSelect={siteId => { session.selectSite(siteId); }} onNavigate={onNavigate}
        layers={layers} onToggleLayer={(layer, visible) => setLayers(current => ({ ...current, [layer]: visible }))}
        placement={state.placementSiteId ? {
          siteId: state.placementSiteId, saving, onPlace: place,
          onCancel: () => session.cancelPlacement(),
        } : undefined} />}
    </>}
  </section>;
}
