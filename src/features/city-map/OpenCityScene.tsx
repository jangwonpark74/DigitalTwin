import { useEffect, useRef, useState } from 'react';
import { BUILDING_LAYER, CITY_LOCATIONS, LABEL_LAYERS, openCityStyle, type OpenCityId } from './openCityStyle';
import { addBaseStationLayer, type BaseStation } from '../site-planner/baseStationLayer';
import { countFootprintParts, selectFootprint } from './openCityGeometry';
import './open-city.css';

export type CityBuilding = { id: string; height: number | null; base: number; longitude: number; latitude: number };
export type CityMapState = { phase: 'loading' | 'ready' | 'error'; count: number; message: string };
export type OpenCityHandle = {
  setLocation(id: OpenCityId): void;
  setView(threeD: boolean): void;
  setLayer(layer: 'buildings' | 'stations' | 'labels', visible: boolean): void;
  reset(): void;
  inspect(): void;
  destroy(): void;
};
export type OpenCityLoader = () => Promise<(host: HTMLElement, onState: (state: CityMapState) => void,
  onSelect: (building: CityBuilding) => void) => OpenCityHandle>;

export function exampleCityStations(location: OpenCityId): BaseStation[] {
  const [longitude, latitude] = CITY_LOCATIONS[location].center;
  return [[-100, 75, 30], [130, 35, 36], [10, -120, 24]].map(([east, north, heightM], index) => ({
    id: `BS-0${index + 1}`, name: `${CITY_LOCATIONS[location].label} example station ${index + 1}`,
    longitude: longitude + east / (111320 * Math.cos(latitude * Math.PI / 180)), latitude: latitude + north / 111320,
    heightM, azimuths: [0, 120, 240], example: true,
  }));
}

const loadOpenCity: OpenCityLoader = async () => {
  const { Map, NavigationControl, ScaleControl, MercatorCoordinate } = await import('maplibre-gl');
  await import('maplibre-gl/dist/maplibre-gl.css');
  return (host, onState, onSelect) => {
    let location: OpenCityId = 'palo-alto';
    let threeD = true;
    const visibility = { buildings: true, stations: true, labels: true };
    let stations: ReturnType<typeof addBaseStationLayer> | null = null;
    const initial = CITY_LOCATIONS[location];
    const map = new Map({ container: host, style: openCityStyle(), center: [...initial.center], zoom: initial.zoom,
      pitch: 58, bearing: initial.bearing, maxPitch: 70, minZoom: 11, maxZoom: 19,
      canvasContextAttributes: { antialias: true, preserveDrawingBuffer: true }, attributionControl: { compact: false } });
    map.addControl(new NavigationControl({ visualizePitch: true }), 'top-right');
    map.addControl(new ScaleControl({ unit: 'metric' }), 'bottom-left');
    let disposed = false;
    let tileFailure: string | null = null;
    const applyLayers = () => {
      if (!map.getLayer(BUILDING_LAYER)) return;
      map.setLayoutProperty(BUILDING_LAYER, 'visibility', visibility.buildings ? 'visible' : 'none');
      for (const layer of LABEL_LAYERS) map.setLayoutProperty(layer, 'visibility', visibility.labels ? 'visible' : 'none');
      stations?.setVisible(visibility.stations);
    };
    const report = () => {
      if (disposed || !map.isStyleLoaded() || !map.getLayer(BUILDING_LAYER)) return;
      if (tileFailure) {
        onState({ phase: 'error', count: 0, message: tileFailure });
        return;
      }
      if (!visibility.buildings) {
        onState({ phase: 'ready', count: 0, message: 'Building layer hidden' });
        return;
      }
      // Only count delivered geometry, never infer success from a canvas alone.
      const buildings = map.queryRenderedFeatures(undefined, { layers: [BUILDING_LAYER] });
      const count = countFootprintParts(buildings);
      if (count) onState({ phase: 'ready', count, message: 'Open map connected' });
      else onState({ phase: 'error', count: 0, message: 'No building geometry in this view. Zoom in or reset the view.' });
    };
    map.on('load', () => {
      stations = addBaseStationLayer(map, MercatorCoordinate);
      stations.update(exampleCityStations(location));
      applyLayers();
    });
    map.on('idle', report);
    map.on('movestart', () => { if (!disposed && !tileFailure) onState({ phase: 'loading', count: 0, message: 'Loading visible map tiles…' }); });
    map.on('error', () => {
      if (!disposed) {
        tileFailure = 'Map tiles could not load. Check your connection and retry.';
        onState({ phase: 'error', count: 0, message: tileFailure });
      }
    });
    const selectBuilding = (feature: import('maplibre-gl').MapGeoJSONFeature | undefined, longitude: number, latitude: number) => {
      if (!feature) return;
      const footprint = selectFootprint(feature.geometry, [longitude, latitude]);
      if (!footprint) return;
      const value = Number(feature.properties?.render_height);
      const base = Number(feature.properties?.render_min_height);
      onSelect({ id: String(feature.id ?? 'OSM footprint'), height: Number.isFinite(value) && value > 0 ? value : null,
        base: Number.isFinite(base) ? base : 0, longitude, latitude });
      (map.getSource('atlas-selected') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection',
        features: [{ type: 'Feature', geometry: footprint, properties: feature.properties }] });
    };
    map.on('click', BUILDING_LAYER, event => {
      selectBuilding(event.features?.[0], event.lngLat.lng, event.lngLat.lat);
    });
    map.on('mouseenter', BUILDING_LAYER, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', BUILDING_LAYER, () => { map.getCanvas().style.cursor = ''; });
    const observer = new ResizeObserver(() => map.resize());
    observer.observe(host);
    const reset = () => {
      const city = CITY_LOCATIONS[location];
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      map.easeTo({ center: [...city.center], zoom: city.zoom, bearing: city.bearing, pitch: threeD ? 58 : 0, duration: reduced ? 0 : 650 });
    };
    return {
      setLocation(id) {
        location = id;
        stations?.update(exampleCityStations(location));
        if (map.isStyleLoaded()) (map.getSource('atlas-selected') as import('maplibre-gl').GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
        reset();
      },
      setView(value) { threeD = value; map.easeTo({ pitch: value ? 58 : 0, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 450 }); },
      setLayer(layer, visible) {
        visibility[layer] = visible; applyLayers();
        if (layer === 'buildings' && map.getLayer('atlas-selected-building')) map.setLayoutProperty('atlas-selected-building', 'visibility', visible ? 'visible' : 'none');
        if (layer === 'buildings' && !visible && !tileFailure) onState({ phase: 'ready', count: 0, message: 'Building layer hidden' });
      },
      reset,
      inspect() {
        if (!map.isStyleLoaded() || !visibility.buildings) return;
        const feature = map.queryRenderedFeatures(undefined, { layers: [BUILDING_LAYER] })[0];
        if (!feature) return;
        const point = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0][0]
          : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates[0][0][0] : null;
        if (point) selectBuilding(feature, point[0], point[1]);
      },
      destroy() { disposed = true; observer.disconnect(); map.remove(); },
    };
  };
};

export default function OpenCityScene({ onClose, loadDriver = loadOpenCity }: { onClose: () => void; loadDriver?: OpenCityLoader }) {
  const host = useRef<HTMLDivElement>(null);
  const driver = useRef<OpenCityHandle | null>(null);
  const [location, setLocation] = useState<OpenCityId>('palo-alto');
  const [threeD, setThreeD] = useState(true);
  const [layers, setLayers] = useState({ buildings: true, stations: true, labels: true });
  const [state, setState] = useState<CityMapState>({ phase: 'loading', count: 0, message: 'Loading open city map…' });
  const [building, setBuilding] = useState<CityBuilding | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [driverReady, setDriverReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDriverReady(false);
    setState({ phase: 'loading', count: 0, message: 'Loading open city map…' });
    void loadDriver().then(create => {
      if (cancelled || !host.current) return;
      const handle = create(host.current, update => { if (!cancelled) setState(update); }, value => { if (!cancelled) setBuilding(value); });
      driver.current = handle;
      setDriverReady(true);
    }).catch(() => {
      if (!cancelled) setState({ phase: 'error', count: 0, message: '3D map unavailable. WebGL and an internet connection are required.' });
    });
    return () => { cancelled = true; driver.current?.destroy(); driver.current = null; };
  }, [loadDriver, attempt]);

  useEffect(() => {
    if (!driverReady) return;
    driver.current?.setLocation(location);
  }, [driverReady, location]);
  useEffect(() => {
    if (!driverReady) return;
    driver.current?.setView(threeD);
  }, [driverReady, threeD]);
  useEffect(() => {
    if (!driverReady) return;
    driver.current?.setLayer('buildings', layers.buildings);
    driver.current?.setLayer('stations', layers.stations);
    driver.current?.setLayer('labels', layers.labels);
  }, [driverReady, layers]);

  const city = CITY_LOCATIONS[location];
  return <section className="open-city" aria-label="Silicon Valley open 3D map">
    <header className="open-city-heading"><div><p className="open-city-eyebrow">OPEN WORLD / CALIFORNIA</p>
      <h1>Silicon Valley <span>in context.</span></h1><p>Explore the built environment before you plan the network.</p></div>
      <button type="button" className="button outline" onClick={onClose}>Return to radio map</button></header>
    <div className="open-city-workspace">
      <div className="open-city-canvas-wrap">
        <div className="open-city-map" ref={host} aria-label="Interactive open street map with extruded buildings and base stations" />
        <div className="open-city-floating-title"><span className="open-city-pin" aria-hidden="true">◈</span><div><strong>{city.label}, CA</strong><small>{city.detail}</small></div><span className="open-city-tag">OPEN MAP</span></div>
        <div className="open-city-view" role="group" aria-label="City camera view">
          <button type="button" aria-pressed={threeD} disabled={!driverReady} onClick={() => setThreeD(true)}>3D perspective</button>
          <button type="button" aria-pressed={!threeD} disabled={!driverReady} onClick={() => setThreeD(false)}>2D plan</button>
          <button type="button" disabled={!driverReady} onClick={() => driver.current?.reset()} aria-label="Reset city camera">↺</button>
        </div>
        {state.phase === 'loading' && <div className="open-city-loading" aria-hidden="true"><span /> Loading map</div>}
        {state.phase === 'error' && <div className="open-city-error"><strong>Map needs attention</strong><p>{state.message}</p>
          <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry open map</button></div>}
        <div className="open-city-map-hint">Drag to pan · right-drag to orbit · scroll to zoom · select a building</div>
      </div>
      <aside className="open-city-inspector" aria-label="City map inspector">
        <div className="open-city-inspector-head"><span>SCENE EXPLORER</span><small>01 / OPEN CITY</small></div>
        <label className="open-city-location">Explore a location<select aria-label="Silicon Valley location" disabled={!driverReady} value={location}
          onChange={event => { setLocation(event.target.value as OpenCityId); setBuilding(null); }}>
          {Object.entries(CITY_LOCATIONS).map(([id, value]) => <option value={id} key={id}>{value.label}, California</option>)}
        </select></label>
        <div className="open-city-health" data-phase={state.phase}><span className="open-city-status-dot" /><p role="status" aria-live="polite">{state.message}</p></div>
        <div className="open-city-stat"><strong>{state.count ? new Intl.NumberFormat('en-US').format(state.count) : '—'}</strong><span>loaded footprint parts</span></div>
        <fieldset className="open-city-layers"><legend>Map layers</legend>
          {(['buildings', 'stations', 'labels'] as const).map(layer => <label key={layer}><span>{layer === 'buildings' ? '3D buildings' : layer === 'stations' ? 'Base stations' : 'Street & place labels'}</span>
            <input type="checkbox" checked={layers[layer]} disabled={!driverReady} onChange={event => setLayers(current => ({ ...current, [layer]: event.target.checked }))} /></label>)}
        </fieldset>
        <section className="open-city-stations" aria-label="Example base stations"><strong>◉ 3 example base stations</strong>
          <p>24–36 m above ground · markers sit at the antenna tip. Illustrative locations for network planning.</p></section>
        <section className="open-city-selection" aria-label="Selected open map building"><p className="open-city-eyebrow">BUILDING INSPECTOR</p>
          {building ? <><h2>Building footprint</h2><dl><div><dt>Tile feature</dt><dd>{building.id}</dd></div>
            <div><dt>Rendered height</dt><dd>{building.height === null ? '6 m fallback' : `${building.height.toFixed(1)} m`}</dd></div>
            <div><dt>Base height</dt><dd>{building.base.toFixed(1)} m</dd></div>
            <div><dt>Selected point</dt><dd>{building.latitude.toFixed(5)}<br />{building.longitude.toFixed(5)}</dd></div></dl>
            <small>Tile-derived or estimated height. The feature ID identifies a tile feature, not necessarily an OSM object.</small></>
            : <><div className="open-city-selection-icon" aria-hidden="true">▥</div><h2>Look a little closer</h2><p>Select a building on the map to inspect its height and location.</p></>}
          <button type="button" className="open-city-inspect-button" disabled={state.phase !== 'ready' || !layers.buildings} onClick={() => driver.current?.inspect()}>Inspect a visible building</button>
        </section>
        <details className="open-city-source"><summary>Data &amp; fidelity</summary><p>OpenStreetMap footprints via OpenFreeMap / OpenMapTiles. Heights may be estimated. Extruded geometry, without photogrammetry or RF materials. Counts polygon parts returned by the renderer; tile clipping can split one building into several parts.</p>
          <a href="https://openfreemap.org/" target="_blank" rel="noreferrer">View map source ↗</a></details>
        <div className="open-city-boundary"><strong>Visual context</strong><p>This example is separate from your project. Exploring it does not change sites, coordinates, or simulation inputs.</p></div>
      </aside>
    </div>
    <footer className="open-city-footer"><span>MAPLIBRE GL · OPENSTREETMAP GEOMETRY</span><span>Building heights may be estimated · RF simulation requires validated project geometry</span></footer>
  </section>;
}
