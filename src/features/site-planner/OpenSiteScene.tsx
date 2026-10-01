import { useEffect, useRef, useState } from 'react';
import { openCityStyle } from '../city-map/openCityStyle';
import { createRadioOverlay, type RadioLine } from '../ray-tracing/radioOverlay';
import type { GeoPoint, PreviewPath, BeamSettings } from '../ray-tracing/propagationGeometry';
import { captureOpenBuildings, type CapturedBuildings } from '../ray-tracing/openMapCapture';
import { beamOutline } from '../ray-tracing/propagationGeometry';
import { driveFeatures, type DriveView } from '../ray-tracing/driveKpi';
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
    showBeam: boolean; showDirect: boolean; showReflections: boolean; showContext: boolean; showSaved: boolean };
};
export type SceneCamera = { yaw: number; pitch: number; zoom: number };
export type SceneHandle = { update(project: SiteSceneProject): void; setCamera(project: SiteSceneProject, camera: SceneCamera): void; fitDriveRoute?(): void; captureBuildings?(): CapturedBuildings | Promise<CapturedBuildings>; destroy(): void };
export type SceneDriver = (host: HTMLElement, project: SiteSceneProject, onPick?: (point: GeoPoint) => void,
  onStatus?: (message: string) => void, onSelectDriveSample?: (index: number) => void) => SceneHandle;
export type SceneLoader = () => Promise<SceneDriver>;

export function sceneLines(project: SiteSceneProject): RadioLine[] {
  const lines: RadioLine[] = [];
  const view = project.radioView;
  for (const site of project.sites) {
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
  return (host, initialProject, onPick, onStatus, onSelectDriveSample) => {
    let current = initialProject;
    let disposed = false;
    let ready = false;
    let contextAdded = false;
    let contextVisible = false;
    let fitPending = false;
    let cameraScope = '';
    let cameraZoom: number | null = null;
    const map = new maplibre.Map({ container: host,
      style: { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#e8ece8' } }] },
      center: [current.map.longitude, current.map.latitude], zoom: 16, pitch: 52, bearing: 35, maxPitch: 75,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true }, attributionControl: { compact: false } });
    map.addControl(new maplibre.NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new maplibre.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const overlay = createRadioOverlay(maplibre.MercatorCoordinate, () => sceneLines(current),
      () => [current.map.longitude, current.map.latitude]);
    const markers: import('maplibre-gl').Marker[] = [];
    const fitRoute = () => {
      if (disposed) return;
      if (!ready) { fitPending = true; return; }
      fitPending = false;
      const samples = current.driveView?.samples ?? [];
      if (!samples.length) return;
      const bounds = new maplibre.LngLatBounds();
      samples.forEach(sample => bounds.extend([sample.longitude, sample.latitude]));
      map.fitBounds(bounds, { padding: host.clientWidth < 600 ? 30 : 70, maxZoom: 17.5, duration: 0, pitch: 52, bearing: 35 });
    };
    const sync = () => {
      if (!ready || disposed) return;
      const footprints = current.map.scene?.footprints ?? [];
      (map.getSource('rf-buildings') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection',
        features: footprints.map(footprint => ({ type: 'Feature', properties: { height: footprint.heightM },
          geometry: { type: 'Polygon', coordinates: [[...footprint.ring, footprint.ring[0]]] } })) });
      (map.getSource('drive-kpi') as import('maplibre-gl').GeoJSONSource).setData(driveFeatures(current.driveView));
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
      for (const site of current.sites) if (Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude))
        mark({ latitude: site.radioLocation.latitude!, longitude: site.radioLocation.longitude!, heightM: site.heightM },
          `TX · ${site.id}`, 'tx');
      if (current.radioView?.receiver) mark(current.radioView.receiver, 'RX', 'rx');
      overlay.invalidate();
      map.triggerRepaint();
    };
    map.on('load', () => {
      if (disposed) return;
      map.addSource('rf-buildings', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'rf-buildings', type: 'fill-extrusion', source: 'rf-buildings', paint: {
        'fill-extrusion-color': '#668d83', 'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': .92 } });
      map.addLayer(overlay);
      map.addSource('drive-kpi', { type: 'geojson', data: driveFeatures(current.driveView) });
      map.addLayer({ id: 'drive-kpi-route', type: 'line', source: 'drive-kpi', filter: ['==', ['geometry-type'], 'LineString'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': 7, 'line-opacity': .8 } });
      map.addLayer({ id: 'drive-kpi-samples', type: 'circle', source: 'drive-kpi', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'selected'], 10, 5.5],
          'circle-stroke-color': '#ffffff', 'circle-stroke-width': ['case', ['get', 'selected'], 3, 1.5],
          'circle-pitch-alignment': 'map' } });
      ready = true;
      sync();
      if (fitPending) fitRoute();
      onStatus?.('3D RF scene ready · MapLibre open map with project layers.');
    });
    map.on('idle', () => {
      if (!disposed && contextAdded && current.radioView?.showContext !== false && map.getLayer('roads') &&
        map.queryRenderedFeatures(undefined, { layers: ['roads'] }).length)
        onStatus?.('3D RF scene ready · open map context connected, project layers over open streets.');
    });
    map.on('error', () => onStatus?.('Open map context unavailable · project geometry and ray layers remain available.'));
    map.on('click', event => {
      const sample = ready && current.driveView?.interactive && current.driveView.visible
        ? map.queryRenderedFeatures([[event.point.x - 6, event.point.y - 6], [event.point.x + 6, event.point.y + 6]],
          { layers: ['drive-kpi-samples'] }).sort((a, b) => {
            const distance = (feature: import('maplibre-gl').MapGeoJSONFeature) => {
              if (feature.geometry.type !== 'Point') return Infinity;
              const projected = map.project(feature.geometry.coordinates as [number, number]);
              return (projected.x - event.point.x) ** 2 + (projected.y - event.point.y) ** 2;
            };
            return distance(a) - distance(b);
          })[0] : null;
      if (sample) onSelectDriveSample?.(Number(sample.properties.index));
      else onPick?.({ latitude: event.lngLat.lat, longitude: event.lngLat.lng, heightM: 2 });
    });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    return {
      update(project) { current = project; sync(); },
      fitDriveRoute: fitRoute,
      setCamera(project, camera) {
        const scope = `${project.map.longitude}:${project.map.latitude}:${project.map.radiusMeters}`;
        const recenter = scope !== cameraScope;
        const zoom = recenter || cameraZoom !== camera.zoom
          ? Math.max(10, Math.min(19, 16 - Math.log2(Math.max(100, project.map.radiusMeters) / 500) + Math.log2(camera.zoom))) : map.getZoom();
        map.jumpTo({ ...(recenter ? { center: [project.map.longitude, project.map.latitude] as [number, number] } : {}),
          bearing: camera.yaw, pitch: camera.pitch, zoom });
        cameraScope = scope; cameraZoom = camera.zoom;
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
export default function OpenSiteScene({ project, camera = defaultCamera, loadDriver = loadOpenScene, onPick, onCapture, captureBusy = false, onSelectDriveSample, fitDriveRequest = 0 }: {
  project: SiteSceneProject; camera?: SceneCamera; loadDriver?: SceneLoader; onPick?: (point: GeoPoint) => void; onCapture?: (capture: CapturedBuildings) => Promise<void>; captureBusy?: boolean;
  onSelectDriveSample?: (index: number) => void; fitDriveRequest?: number;
}) {
  const host = useRef<HTMLDivElement>(null);
  const driverRef = useRef<SceneHandle | null>(null);
  const projectRef = useRef(project);
  const cameraRef = useRef(camera);
  const pickRef = useRef(onPick);
  const selectRef = useRef(onSelectDriveSample);
  const fitRef = useRef(fitDriveRequest);
  const [captureError, setCaptureError] = useState('');
  const [status, setStatus] = useState('Loading open 3D map…');
  projectRef.current = project; cameraRef.current = camera; pickRef.current = onPick; selectRef.current = onSelectDriveSample; fitRef.current = fitDriveRequest;
  useEffect(() => {
    let cancelled = false;
    void loadDriver().then(driver => {
      if (cancelled || !host.current) return;
      driverRef.current = driver(host.current, projectRef.current, point => pickRef.current?.(point),
        message => { if (!cancelled) setStatus(message); }, index => selectRef.current?.(index));
      driverRef.current.setCamera(projectRef.current, cameraRef.current);
      if (fitRef.current) driverRef.current.fitDriveRoute?.();
      setStatus('3D RF scene ready · MapLibre open map with project layers.');
    }).catch(cause => { if (!cancelled) setStatus(`3D scene unavailable · ${cause instanceof Error ? cause.message : String(cause)}`); });
    return () => { cancelled = true; driverRef.current?.destroy(); driverRef.current = null; };
  }, [loadDriver]);
  useEffect(() => { driverRef.current?.update(project); }, [project]);
  useEffect(() => { driverRef.current?.setCamera(project, camera); }, [project.map.latitude, project.map.longitude,
    project.map.radiusMeters, camera.yaw, camera.pitch, camera.zoom]);
  useEffect(() => { if (fitDriveRequest) driverRef.current?.fitDriveRoute?.(); }, [fitDriveRequest]);
  const capture = async () => {
    setCaptureError('');
    try {
      const result = await driverRef.current?.captureBuildings?.();
      if (!result) throw new Error('Open map buildings are still loading.');
      await onCapture?.(result);
    } catch (cause) { setCaptureError(cause instanceof Error ? cause.message : String(cause)); }
  };
  return <section className="site-planner-3d open-rf-scene" aria-label="Three-dimensional project RF scene">
    <div className="site-planner-3d-host open-rf-host" ref={host} />
    {captureError && <p role="alert">Open map import failed · {captureError}</p>}
    <div className="rf-source-footer"><p role="status" aria-live="polite">{status}</p>
      {onCapture && <button type="button" disabled={captureBusy} onClick={() => { void capture(); }}>Use visible map buildings</button>}</div>
  </section>;
}
