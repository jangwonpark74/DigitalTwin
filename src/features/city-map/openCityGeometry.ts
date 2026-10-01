import type { Geometry, Polygon } from 'geojson';

function parts(geometry: Geometry): Polygon[] {
  if (geometry.type === 'Polygon') return [geometry];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.map(coordinates => ({ type: 'Polygon', coordinates }));
  return [];
}

export function countFootprintParts(features: ReadonlyArray<{ geometry: Geometry }>): number {
  // OpenMapTiles can merge many footprints into one feature. Count polygon
  // parts and deduplicate geometry; IDs and feature counts aren't building counts.
  return new Set(features.flatMap(feature => parts(feature.geometry)).map(part => JSON.stringify(part.coordinates))).size;
}

function inside(ring: number[][], [x, y]: number[]): boolean {
  let result = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) result = !result;
  }
  return result;
}

export function selectFootprint(geometry: Geometry, point: [number, number]): Polygon | null {
  const polygons = parts(geometry);
  const containing = polygons.find(polygon => inside(polygon.coordinates[0], point)
    && !polygon.coordinates.slice(1).some(hole => inside(hole, point)));
  if (containing) return containing;
  // A click on a raised roof can project outside its ground footprint. Use
  // the closest boundary within the actual feature returned by MapLibre.
  let closest: Polygon | null = null, distance = Infinity;
  for (const polygon of polygons) {
    const ring = polygon.coordinates[0];
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1], b = ring[i];
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length)) : 0;
      const candidate = (point[0] - a[0] - t * dx) ** 2 + (point[1] - a[1] - t * dy) ** 2;
      if (candidate < distance) { distance = candidate; closest = polygon; }
    }
  }
  return closest;
}
