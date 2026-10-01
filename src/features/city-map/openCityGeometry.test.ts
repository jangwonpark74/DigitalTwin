import type { Geometry } from 'geojson';
import { describe, expect, it } from 'vitest';
import { countFootprintParts, selectFootprint } from './openCityGeometry';

const left = [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]];
const right = [[[10, 0], [11, 0], [11, 1], [10, 1], [10, 0]]];
const merged: Geometry = { type: 'MultiPolygon', coordinates: [left, right] };

describe('merged open map footprints', () => {
  it('counts distinct polygon parts even when tiles merge features, reuse IDs or repeat geometry', () => {
    const features = [
      { id: 42, geometry: merged },
      { id: 42, geometry: { type: 'Polygon', coordinates: left } as Geometry },
      { id: 42, geometry: { type: 'Point', coordinates: [0, 0] } as Geometry },
    ];
    expect(countFootprintParts(features)).toBe(2);
  });

  it('selects only the clicked footprint from a merged feature, including projected roof clicks', () => {
    expect(selectFootprint(merged, [10.5, .5])).toEqual({ type: 'Polygon', coordinates: right });
    expect(selectFootprint(merged, [12, .5])).toEqual({ type: 'Polygon', coordinates: right });
    expect(selectFootprint(merged, [.5, .5])).toEqual({ type: 'Polygon', coordinates: left });
    expect(selectFootprint({ type: 'Point', coordinates: [0, 0] }, [0, 0])).toBeNull();
  });
});
