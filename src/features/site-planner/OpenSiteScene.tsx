import { useEffect, useRef, useState } from 'react';
import { openCityStyle } from '../city-map/openCityStyle';
import { createRadioOverlay, type RadioLine } from '../ray-tracing/radioOverlay';
import type { GeoPoint, PreviewPath, BeamSettings } from '../ray-tracing/propagationGeometry';
import { captureOpenBuildings, type CapturedBuildings } from '../ray-tracing/openMapCapture';
import { beamOutline } from '../ray-tracing/propagationGeometry';
import { DRIVE_HEIGHT_M, driveLines, driveDots, type DriveView } from '../ray-tracing/driveKpi';
import { addBaseStationLayer } from './baseStationLayer';
import type { MapViewport } from '../city-map/ProjectMapSession';
import './open-site-scene.css';

export type SiteSceneProject = {
  map: { latitude: number; longitude: number; radiusMeters: number; scene?: { footprints: Array<{
    id: string; heightM: number; assumedHeight?: boolean; ring: [number, number][];
  }> } | null };
  rayResults?: { provenance: string; paths: Array<{ id: string; pathLossDb: number; points: GeoPoint[] }> } | null;
  selectedRayId?: string | null;
  driveView?: DriveView;
  sites: Array<{ id: string; name: string; heightM: number;
    radioLocation: { latitude: number | null; longitude: number | null; source: string };
    cells: Array<{ id: string; azimuthDeg: number; downtiltDeg: number }> }>;
  radioView?: { receiver: GeoPoint | null; siteId: string; beam: BeamSettings; previewPaths: PreviewPath[];
    showBeam: boolean; showDirect: boolean; showReflections: boolean; showContext: boolean; showSaved: boolean; showSites?: boolean };
};
export type SceneCamera = { yaw: number; pitch: number; zoom: number };
export type SceneHandle = { update(project: SiteSceneProject): void; setCamera(project: SiteSceneProject, camera: SceneCamera): void; setViewport?(viewport: MapViewport): void; fitDriveRoute?(): void; fitCellSites?(): void; captureBuildings?(): CapturedBuildings | Promise<CapturedBuildings>; destroy(): void };
export type SceneDriver = (host: HTMLElement, project: SiteSceneProject, onPick?: (point: GeoPoint) => void,
  onStatus?: (message: string) => void, onSelectDriveSample?: (index: number) => void, onViewChange?: (viewport: MapViewport) => void) => SceneHandle;
export type SceneLoader = () => Promise<SceneDriver>;

export function sceneLines(project: SiteSceneProject): RadioLine[] {
  const lines: RadioLine[] = [];
  const view = project.radioView;
  for (const site of project.sites) {
    if (view?.showSites === false) continue;
    const { latitude, longitude } = site.radioLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const top = { latitude: latitude as number, longitude: longitude as number, heightM: site.heightM };
    lines.push({ points: [{ ...top, heightM: 0 }, top], color: '#18bdb0', width: 4 });
    if (view?.siteId === site.id && view.showBeam) {
      lines.push(...beamOutline(top, view.beam, Math.min(project.map.radiusMeters, 350)).map(points =>
        ({ points, color: '#19b5a5', width: 1.5 })));
    }
  }
  if (view?.receiver) lines.push({ points: [{ ...view.receiver, heightM: 0 }, view.receiver], color: '#3c6ded', width: 6 });
  for (const path of view?.previewPaths ?? []) {
    if (path.kind === 'reflection' ? !view?.showReflections : !view?.showDirect) continue;
    lines.push({ points: path.points, color: path.kind === 'blocked' ? '#e66d58' : path.kind === 'reflection' ? '#e5a13d' : '#19b5a5',
      width: project.selectedRayId === path.id ? 5 : 2.5 });
  }
  if (!view || view.showSaved) for (const ray of project.rayResults?.paths ?? []) {
    lines.push({ points: ray.points, color: '#9972e8', width: project.selectedRayId === ray.id ? 5 : 2.5 });
  }
  return lines;
}

export const loadOpenScene: SceneLoader = async () => {
  const maplibre = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  return (host, initialProject, onPick, onStatus, onSelectDriveSample, onViewChange) => {
    let current = initialProject;
    let disposed = false;
    let ready = false;
    let contextAdded = false;
    let contextVisible = false;
    let fitPending = false;
    let fitSitesPending = false;
    let cameraScope = '';
    let cameraZoom: number | null = null;
    let cameraYaw: number | null = null;
    const map = new maplibre.Map({ container: host,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8ece8' } }] },
      center: [current.map.longitude, current.map.latitude], zoom: 16, pitch: 52, bearing: 35, maxPitch: 75,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true }, attributionControl: { compact: false } });
    host.dataset.mapReady = 'false';
    map.on('movestart', () => { host.dataset.mapReady = 'false'; });
    map.on('dataloading', () => { host.dataset.mapReady = 'false'; });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibre.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const overlay = createRadioOverlay(maplibre.MercatorCoordinate, () => sceneLines(current),
      () => [current.map.longitude, current.map.latitude]);
    const driveOverlay = createRadioOverlay(maplibre.MercatorCoordinate, () => driveLines(current.driveView),
      () => [current.map.longitude, current.map.latitude], { id: 'drive-kpi-3d', dots: () => driveDots(current.driveView) });
    const markers: import('maplibre-gl').Marker[] = [];
    let stations: ReturnType<typeof addBaseStationLayer> | null = null;
    const fitRoute = () => {
      if (disposed) return;
      if (!ready) { fitPending = true; fitSitesPending = false; return; }
      fitPending = false;
      const samples = current.driveView?.samples ?? [];
      if (!samples.length) return;
      const bounds = new maplibre.LngLatBounds();
      samples.forEach(sample => bounds.extend([sample.longitude, sample.latitude]));
      map.fitBounds(bounds, { padding: host.clientWidth < 600 ? 30 : 70, maxZoom: 17.5, duration: 0, pitch: map.getPitch(), bearing: map.getBearing() });
    };
    const fitSites = () => {
      if (disposed) return;
      if (!ready) { fitSitesPending = true; fitPending = false; return; }
      fitSitesPending = false;
      const located = current.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude));
      if (!located.length) return;
      const bounds = new maplibre.LngLatBounds();
      located.forEach(site => bounds.extend([site.radioLocation.longitude!, site.radioLocation.latitude!]));
      map.fitBounds(bounds, { padding: host.clientWidth < 600 ? 50 : 90, maxZoom: 17, duration: 0, pitch: map.getPitch(), bearing: map.getBearing() });
    };
    const publishView = () => {
      if (!ready || disposed) return;
      const center = map.getCenter();
      const viewport = { longitude: center.lng, latitude: center.lat, zoom: map.getZoom(), bearing: map.getBearing() };
      host.dataset.mapLongitude = String(viewport.longitude); host.dataset.mapLatitude = String(viewport.latitude);
      host.dataset.mapZoom = String(viewport.zoom); host.dataset.mapBearing = String(viewport.bearing);
      host.dataset.mapPitch = String(map.getPitch());
      onViewChange?.(viewport);
    };
    map.on('moveend', publishView);
    const sync = () => {
      if (!ready || disposed) return;
      const footprints = current.map.scene?.footprints ?? [];
      (map.getSource('rf-buildings') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection',
        features: footprints.map(footprint => ({ type: 'Feature', properties: { height: footprint.heightM },
          geometry: { type: 'Polygon', coordinates: [[...footprint.ring, footprint.ring[0]]] } })) });
      const showContext = current.radioView?.showContext !== false;
      if (showContext !== contextVisible) {
        contextVisible = showContext;
        onStatus?.(showContext ? 'Loading open map context…' : '3D RF scene ready · project layers, open map context hidden.');
      }
      if (showContext && !contextAdded) {
        const style = openCityStyle();
        map.addSource('openmaptiles', style.sources.openmaptiles);
        map.setGlyphs(style.glyphs!);
        for (const layer of style.layers) if ('source' in layer && layer.source === 'openmaptiles') map.addLayer(layer, 'rf-buildings');
        contextAdded = true;
      }
      if (contextAdded) for (const layer of openCityStyle().layers) if ('source' in layer && layer.source === 'openmaptiles')
        map.setLayoutProperty(layer.id, 'visibility', showContext ? 'visible' : 'none');
      markers.splice(0).forEach(marker => marker.remove());
      const mark = (point: GeoPoint, label: string, kind: string) => {
        const element = document.createElement('span');
        element.className = `rf-map-marker ${kind}`;
        element.textContent = label;
        element.title = `${label} ground location · antenna height ${point.heightM} m`;
        markers.push(new maplibre.Marker({ element, anchor: 'bottom' }).setLngLat([point.longitude, point.latitude]).addTo(map));
      };
      stations?.update(current.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude))
        .map(site => ({ id: site.id, name: site.name, latitude: site.radioLocation.latitude!, longitude: site.radioLocation.longitude!,
          heightM: site.heightM, azimuths: site.cells.map(cell => cell.azimuthDeg), selected: current.radioView?.siteId === site.id })));
      stations?.setVisible(current.radioView?.showSites !== false);
      if (current.radioView?.receiver) mark(current.radioView.receiver, 'RX', 'rx');
      overlay.invalidate();
      driveOverlay.invalidate();
      map.triggerRepaint();
    };
    map.on('load', () => {
      if (disposed) return;
      map.addSource('rf-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'rf-buildings', type: 'fill-extrusion', source: 'rf-buildings', paint: {
        'fill-extrusion-color': '#668d83', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': .92 } });
      map.addLayer(overlay);
      stations = addBaseStationLayer(map, maplibre.MercatorCoordinate);
      map.addLayer(driveOverlay);
      ready = true;
      sync();
      if (fitPending) fitRoute();
      if (fitSitesPending) fitSites();
      publishView();
      onStatus?.('3D RF scene ready · MapLibre open map with project layers.');
    });
    map.on('idle', () => {
      if (!disposed) host.dataset.mapReady = 'true';
      if (!disposed && contextAdded && current.radioView?.showContext !== false && map.getLayer('roads') &&
        map.queryRenderedFeatures(undefined, { layers: ['roads'] }).length)
        onStatus?.('3D RF scene ready · open map context connected, project layers over open streets.');
    });
    map.on('error', () => onStatus?.('Open map context unavailable · project geometry and ray layers remain available.'));
    map.on('click', event => {
      const sampleIndex = ready && current.driveView?.interactive && current.driveView.visible
        ? driveOverlay.pickDot([event.point.x, event.point.y]) : null;
      if (sampleIndex !== null) onSelectDriveSample?.(sampleIndex);
      else onPick?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng, heightM: 2 });
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    return {
      update(project) { current = project; sync(); },
      fitDriveRoute: fitRoute,
      fitCellSites: fitSites,
      setViewport(viewport) {
        const center = map.getCenter();
        if (Math.abs(center.lng - viewport.longitude) < 1e-8 && Math.abs(center.lat - viewport.latitude) < 1e-8 &&
          Math.abs(map.getZoom() - viewport.zoom) < 1e-6 && Math.abs(map.getBearing() - viewport.bearing) < 1e-6) return;
        map.jumpTo({ center: [viewport.longitude, viewport.latitude], zoom: viewport.zoom, bearing: viewport.bearing });
      },
      setCamera(project, camera) {
        const scope = `${project.map.longitude}:${project.map.latitude}:${project.map.radiusMeters}`;
        const recenter = scope !== cameraScope;
        const zoom = recenter || cameraZoom !== camera.zoom
          ? Math.max(10, Math.min(19, 16 - Math.log2(Math.max(100, project.map.radiusMeters) / 500) + Math.log2(camera.zoom))) : map.getZoom();
        map.jumpTo({ ...(recenter ? { center: [project.map.longitude, project.map.latitude] as [number, number] } : {}),
          ...(recenter || cameraYaw !== camera.yaw ? { bearing: camera.yaw } : {}), pitch: camera.pitch, zoom });
        cameraScope = scope; cameraZoom = camera.zoom; cameraYaw = camera.yaw;
      },
      async captureBuildings() {
        if (!ready || !contextAdded || !map.getLayer('atlas-buildings-3d')) throw new Error('Open map buildings are still loading.');
        await new Promise<void>(resolve => { map.once('render', () => resolve()); map.triggerRepaint(); });
        if (disposed) throw new Error('The map was closed before capture finished.');
        return captureOpenBuildings(map.queryRenderedFeatures(undefined, { layers: ['atlas-buildings-3d'] }));
      },
      destroy() { if (disposed) return; disposed = true; observer.disconnect(); markers.forEach(marker => marker.remove()); map.remove(); },
    };
  };
};

const defaultCamera = { yaw: 35, pitch: 52, zoom: 1 };
export default function OpenSiteScene({ project, camera = defaultCamera, loadDriver = loadOpenScene, onPick, onCapture, captureBusy = false, onSelectDriveSample, fitDriveRequest = 0, fitSitesRequest = 0, viewport = null, onViewChange }: {
  project: SiteSceneProject; camera?: SceneCamera; loadDriver?: SceneLoader; onPick?: (point: GeoPoint) => void; onCapture?: (capture: CapturedBuildings) => Promise<void>; captureBusy?: boolean;
  onSelectDriveSample?: (index: number) => void; fitDriveRequest?: number; fitSitesRequest?: number;
  viewport?: MapViewport | null; onViewChange?: (viewport: MapViewport) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const driverRef = useRef<SceneHandle | null>(null);
  const projectRef = useRef(project);
  const cameraRef = useRef(camera);
  const pickRef = useRef(onPick);
  const selectRef = useRef(onSelectDriveSample);
  const fitRef = useRef(fitDriveRequest);
  const fitSitesRef = useRef(fitSitesRequest);
  const viewportRef = useRef(viewport);
  const viewChangeRef = useRef(onViewChange);
  const [captureError, setCaptureError] = useState('');
  const [status, setStatus] = useState('Loading open 3D map…');
  projectRef.current = project; cameraRef.current = camera; pickRef.current = onPick; selectRef.current = onSelectDriveSample; fitRef.current = fitDriveRequest;
  fitSitesRef.current = fitSitesRequest;
  viewportRef.current = viewport; viewChangeRef.current = onViewChange;
  useEffect(() => {
    let cancelled = false;
    void loadDriver().then(driver => {
      if (cancelled || !host.current) return;
      driverRef.current = driver(host.current, projectRef.current, point => pickRef.current?.(point),
        message => { if (!cancelled) setStatus(message); }, index => selectRef.current?.(index), view => viewChangeRef.current?.(view));
      driverRef.current.setCamera(projectRef.current, cameraRef.current);
      if (viewportRef.current) driverRef.current.setViewport?.(viewportRef.current);
      if (fitRef.current) driverRef.current.fitDriveRoute?.();
      if (fitSitesRef.current) driverRef.current.fitCellSites?.();
      setStatus('3D RF scene ready · MapLibre open map with project layers.');
    }).catch(cause => { if (!cancelled) setStatus(`3D scene unavailable · ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; driverRef.current?.destroy(); driverRef.current = null; };
  }, [loadDriver]);
  useEffect(() => { driverRef.current?.update(project); }, [project]);
  useEffect(() => { driverRef.current?.setCamera(project, camera); }, [project.map.latitude, project.map.longitude,
    project.map.radiusMeters, camera.yaw, camera.pitch, camera.zoom]);
  useEffect(() => { if (fitDriveRequest) driverRef.current?.fitDriveRoute?.(); }, [fitDriveRequest]);
  useEffect(() => { if (fitSitesRequest) driverRef.current?.fitCellSites?.(); }, [fitSitesRequest]);
  useEffect(() => { if (viewport) driverRef.current?.setViewport?.(viewport); }, [viewport]);
  const capture = async () => {
    setCaptureError('');
    try {
      const result = await driverRef.current?.captureBuildings?.();
      if (!result) throw new Error('Open map buildings are still loading.');
      await onCapture?.(result);
    } catch (cause) { setCaptureError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="site-planner-3d open-rf-scene" aria-label={camera.pitch === 0 ? 'Two-dimensional project RF scene' : 'Three-dimensional project RF scene'}>
    <div className="site-planner-3d-host open-rf-host" data-drive-height-m={project.driveView ? DRIVE_HEIGHT_M : undefined} ref={host} />
    {captureError && <p role="alert">Open map import failed · {captureError}</p>}
    <div className="rf-source-footer"><p role="status" aria-live="polite">{camera.pitch === 0 ? status.replace('3D RF scene', 'Open RF map') : status}</p>
      {onCapture && <button type="button" disabled={captureBusy} onClick={() => { void capture(); }}>Use visible map buildings</button>}</div>
  </section>;
}
