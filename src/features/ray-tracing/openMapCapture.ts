import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { parseGeoJsonScene } from '../../../scene.mjs';

export type CapturedBuildings = { geojson: FeatureCollection; skipped: number };

// Capture only delivered visible polygons. Tile clipping and source height
// uncertainty remain explicit; no footprints are invented when tiles fail.
export function captureOpenBuildings(features: ReadonlyArray<{ geometry: Geometry; properties?: Record<string, unknown> | null }>): CapturedBuildings {
  const selected: Feature[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const feature of features) {
    const polygons = feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates]
      : feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : [];
    for (const polygon of polygons) {
      const key = JSON.stringify(polygon);
      if (seen.has(key)) continue;
      seen.add(key);
      if (selected.length >= 200 || polygon.length !== 1 || Number(feature.properties?.render_min_height ?? 0) > 0) { skipped++; continue; }
      const height = Number(feature.properties?.render_height);
      const item: Feature = { type: 'Feature', id: `open-map-${selected.length + 1}`,
        properties: Number.isFinite(height) && height >= 1 ? { height } : {},
        geometry: { type: 'Polygon', coordinates: polygon } };
      try { parseGeoJsonScene({ type: 'FeatureCollection', features: [item] }); selected.push(item); }
      catch { skipped++; }
    }
  }
  if (!selected.length) throw new Error('No supported open-map buildings are visible. Enable open map context, zoom in, and wait for tiles to load.');
  return { geojson: { type: 'FeatureCollection', features: selected }, skipped };
}
