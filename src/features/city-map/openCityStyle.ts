import type { StyleSpecification } from 'maplibre-gl';

export const CITY_LOCATIONS = {
  'palo-alto': { label: 'Palo Alto', detail: 'Downtown · University Avenue', center: [-122.1623, 37.4442], zoom: 16.2, bearing: -28 },
  'mountain-view': { label: 'Mountain View', detail: 'Downtown · Castro Street', center: [-122.0796, 37.3942], zoom: 16.2, bearing: -25 },
  'san-jose': { label: 'San Jose', detail: 'Downtown · Santa Clara Street', center: [-121.8907, 37.3361], zoom: 15.8, bearing: -25 },
} as const;
export type OpenCityId = keyof typeof CITY_LOCATIONS;
export const BUILDING_LAYER = 'atlas-buildings-3d';
export const LABEL_LAYERS = ['road-labels', 'place-labels'];

// A local style keeps the product palette stable. Geometry and source attribution
// come from OpenFreeMap's OpenMapTiles-compatible public vector tiles.
export function openCityStyle(): StyleSpecification {
  return {
    version: 8,
    name: 'Atlas · Open city',
    glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources: {
      'atlas-selected': { type: 'geojson', data: { type: 'FeatureCollection', features: [] } },
      openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet',
        attribution: '<a href="https://openfreemap.org/">OpenFreeMap</a> · <a href="https://openmaptiles.org/">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors</a>' },
    },
    light: { anchor: 'viewport', color: '#fff7ea', intensity: 0.45, position: [1.5, 210, 40] },
    layers: [
      { id: 'background', type: 'background', paint: { 'background-color': '#e8ece8' } },
      { id: 'landuse', type: 'fill', source: 'openmaptiles', 'source-layer': 'landuse', paint: { 'fill-color': '#e1e6e1' } },
      { id: 'parks', type: 'fill', source: 'openmaptiles', 'source-layer': 'park', paint: { 'fill-color': '#cbdcc6', 'fill-opacity': 0.8 } },
      { id: 'woods', type: 'fill', source: 'openmaptiles', 'source-layer': 'landcover', filter: ['==', ['get', 'class'], 'wood'], paint: { 'fill-color': '#cbdcc6' } },
      { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#b6d4df' } },
      { id: 'waterways', type: 'line', source: 'openmaptiles', 'source-layer': 'waterway', paint: { 'line-color': '#b6d4df', 'line-width': 2 } },
      { id: 'roads-casing', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        paint: { 'line-color': '#c9d0cb', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 2, 17, 14] } },
      { id: 'roads', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation',
        filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service']]],
        paint: { 'line-color': '#fafbf8', 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 17, 12] } },
      { id: 'paths', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'path'],
        paint: { 'line-color': '#f7f9f3', 'line-width': 1.5, 'line-dasharray': [2, 2] } },
      { id: 'rail', type: 'line', source: 'openmaptiles', 'source-layer': 'transportation', filter: ['==', ['get', 'class'], 'rail'],
        paint: { 'line-color': '#a9b4ad', 'line-width': 2, 'line-dasharray': [2, 2] } },
      { id: BUILDING_LAYER, type: 'fill-extrusion', source: 'openmaptiles', 'source-layer': 'building', minzoom: 14,
        filter: ['!=', ['get', 'hide_3d'], true],
        paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#d0d8d2', 20, '#b0c1b8', 80, '#769d91'],
          'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 1 } },
      { id: 'atlas-selected-building', type: 'fill-extrusion', source: 'atlas-selected',
        paint: { 'fill-extrusion-color': '#5c8867', 'fill-extrusion-height': ['+', ['coalesce', ['get', 'render_height'], 6], 0.15],
          'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': 1 } },
      { id: 'road-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'transportation_name', minzoom: 14,
        layout: { 'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''],
          'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-angle': 30 },
        paint: { 'text-color': '#57665f', 'text-halo-color': '#fafbf8', 'text-halo-width': 2 } },
      { id: 'place-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'place',
        layout: { 'text-field': ['coalesce', ['get', 'name:en'], ['get', 'name'], ''], 'text-font': ['Noto Sans Regular'],
          'text-size': 13, 'text-letter-spacing': 0.08 }, paint: { 'text-color': '#445d52', 'text-halo-color': '#fafbf8', 'text-halo-width': 2 } },
    ],
  };
}
