import { describe, expect, it } from 'vitest';
import type { Polygon } from 'geojson';
import { captureOpenBuildings } from './openMapCapture';
const geometry: Polygon = { type: 'Polygon', coordinates: [[[126.978, 37.566], [126.979, 37.566],
  [126.979, 37.567], [126.978, 37.567], [126.978, 37.566]]] };
describe('visible open map capture', () => {
  it('deduplicates delivered polygon parts and keeps bounded source heights', () => {
    const captured = captureOpenBuildings([{ geometry, properties: { render_height: 23 } },
      { geometry, properties: { render_height: 23 } }]);
    expect(captured.geojson.features).toHaveLength(1);
    expect(captured.geojson.features[0].properties).toEqual({ height: 23 });
  });
  it('omits courtyards and elevated structures that the ground-based solver cannot represent', () => {
    const hole = { ...geometry, coordinates: [...geometry.coordinates, geometry.coordinates[0]] };
    const captured = captureOpenBuildings([{ geometry: hole }, { geometry, properties: { render_min_height: 4 } },
      { geometry: { ...geometry, coordinates: geometry.coordinates.map(ring => ring.map(([x, y]) => [x + .01, y])) } }]);
    expect(captured.geojson.features).toHaveLength(1);
    expect(captured.skipped).toBe(2);
  });
  it('fails closed when geometry is unavailable instead of manufacturing a city', () => {
    expect(() => captureOpenBuildings([])).toThrow(/No supported open-map buildings/);
    expect(() => captureOpenBuildings([{ geometry, properties: { render_height: 1000 } }])).toThrow(/No supported/);
    expect(captureOpenBuildings([{ geometry }]).geojson.features[0].properties).toEqual({});
  });
});
