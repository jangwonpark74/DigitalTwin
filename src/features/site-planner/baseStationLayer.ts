import type { CustomLayerInterface, GeoJSONSource, Map, MercatorCoordinate } from 'maplibre-gl';
import type { FeatureCollection, Polygon } from 'geojson';
import './base-station.css';

export type BaseStation = { id: string; name: string; longitude: number; latitude: number; heightM: number;
  azimuths: number[]; selected?: boolean; example?: boolean };

export function stationFeatures(stations: BaseStation[]): FeatureCollection<Polygon> {
  const features: FeatureCollection<Polygon>['features'] = [];
  for (const station of stations) {
    const rectangle = (east: number, north: number, width: number, depth: number, angle: number,
      base: number, height: number, color: string) => {
      const radians = angle * Math.PI / 180;
      const ring = [[-width / 2, -depth / 2], [width / 2, -depth / 2], [width / 2, depth / 2], [-width / 2, depth / 2]]
        .map(([x, y]) => [station.longitude + (east + x * Math.cos(radians) + y * Math.sin(radians)) /
          (111320 * Math.cos(station.latitude * Math.PI / 180)),
        station.latitude + (north - x * Math.sin(radians) + y * Math.cos(radians)) / 111320]);
      features.push({ type: 'Feature', properties: { stationId: station.id, base, height, color },
        geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] } });
    };
    const color = station.selected ? '#e58a27' : '#087f76';
    rectangle(0, 0, 2.6, 2.6, 0, 0, .5, color);
    rectangle(0, 0, .9, .9, 0, 0, station.heightM, color);
    for (const angle of station.azimuths) {
      const radians = angle * Math.PI / 180;
      rectangle(Math.sin(radians) * 1.1, Math.cos(radians) * 1.1, 1.1, .4, angle,
        Math.max(0, station.heightM - 2.4), station.heightM, '#edf9f5');
    }
  }
  return { type: 'FeatureCollection', features };
}

// MapLibre DOM markers are ground anchored. Project the actual antenna tip
// with the renderer's matrix so labels follow its height during orbit/zoom.
export function addBaseStationLayer(map: Map, Coordinate: typeof MercatorCoordinate) {
  const sourceId = 'base-stations';
  const layerId = 'base-stations-3d';
  let visible = true;
  let markers: { station: BaseStation; element: HTMLDivElement }[] = [];
  map.addSource(sourceId, { type: 'geojson', data: stationFeatures([]) });
  map.addLayer({ id: layerId, type: 'fill-extrusion', source: sourceId, paint: {
    'fill-extrusion-color': ['get', 'color'], 'fill-extrusion-base': ['get', 'base'],
    'fill-extrusion-height': ['get', 'height'], 'fill-extrusion-opacity': 1 } });
  const labels: CustomLayerInterface = { id: 'base-station-labels', type: 'custom', renderingMode: '3d',
    render(_gl, args) {
      const matrix = args.defaultProjectionData.mainMatrix;
      const canvas = map.getCanvas();
      const project = (station: BaseStation, height: number) => {
        const p = Coordinate.fromLngLat([station.longitude, station.latitude], height);
        const clip = [0, 1, 2, 3].map(row => matrix[row] * p.x + matrix[4 + row] * p.y + matrix[8 + row] * p.z + matrix[12 + row]);
        return { x: (clip[0] / clip[3] + 1) * canvas.clientWidth / 2,
          y: (1 - clip[1] / clip[3]) * canvas.clientHeight / 2, w: clip[3], z: clip[2] / clip[3] };
      };
      for (const { station, element } of markers) {
        const tip = project(station, station.heightM);
        const ground = project(station, 0);
        element.hidden = !visible || tip.w <= 0 || Math.abs(tip.z) > 1 || tip.x < 0 || tip.x > canvas.clientWidth || tip.y < 0 || tip.y > canvas.clientHeight;
        element.style.left = `${tip.x}px`;
        element.style.top = `${tip.y}px`;
        element.dataset.groundY = String(ground.y);
        element.dataset.tipY = String(tip.y);
      }
    },
    onRemove() { markers.forEach(({ element }) => element.remove()); markers = []; },
  };
  map.addLayer(labels);
  return {
    update(stations: BaseStation[]) {
      const located = stations.filter(station => Number.isFinite(station.latitude) && Math.abs(station.latitude) < 85.051129 &&
        Number.isFinite(station.longitude) && Math.abs(station.longitude) <= 180 && Number.isFinite(station.heightM) && station.heightM > 0);
      (map.getSource(sourceId) as GeoJSONSource).setData(stationFeatures(located));
      markers.forEach(({ element }) => element.remove());
      markers = located.map(station => {
        const element = document.createElement('div');
        element.className = `rf-map-marker tx base-station-marker${station.selected ? ' selected' : ''}`;
        element.hidden = true;
        element.dataset.stationId = station.id;
        element.dataset.heightM = String(station.heightM);
        element.title = `${station.name} · ${station.latitude.toFixed(5)}, ${station.longitude.toFixed(5)} · ${station.heightM} m above ground${station.example ? ' · example station' : ''}`;
        element.setAttribute('role', 'img');
        element.setAttribute('aria-label', element.title);
        const name = document.createElement('strong'); name.textContent = `◉ ${station.id}`;
        const height = document.createElement('span'); height.textContent = `${station.heightM} m${station.example ? ' · example' : ''}`;
        element.append(name, height);
        map.getCanvasContainer().append(element);
        return { station, element };
      });
      map.triggerRepaint();
    },
    setVisible(value: boolean) {
      visible = value;
      map.setLayoutProperty(layerId, 'visibility', value ? 'visible' : 'none');
      if (!value) markers.forEach(({ element }) => { element.hidden = true; });
      map.triggerRepaint();
    },
  };
}
