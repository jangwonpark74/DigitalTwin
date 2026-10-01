const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

// Legacy markup presenter. The React workspace mounts the shared MapLibre scene.
export function sceneView(project, helpers, { rays = null, selectedRayId = null } = {}) {
  const scene = project.map.scene;
  const caption = scene ? `${esc(scene.fileName)} · WGS84 EPSG:4326 · ${scene.footprints.length} footprints loaded`
    : 'WGS84 EPSG:4326 · load GeoJSON to add building geometry';
  return helpers.panel('Open 3D RF scene', caption,
    `<div class="scene-stage" data-open-map-scene role="img" aria-label="Open 3D map with project buildings and radio paths"></div>
      <p>${rays ? `${rays.paths.length} paths · selected ${esc(selectedRayId ?? 'all')}` : 'No ray paths loaded'}</p>
      <p>MapLibre places imported geometry at WGS84 coordinates with actual building and antenna heights. Open map tiles are visual context.
      Imported paths remain unverified; local Sionna-RT output uses uncalibrated geometry and material assumptions.</p>`,
    helpers.badge(scene ? 'GEOJSON LOADED' : 'NO BUILDINGS', scene ? '' : 'warn'));
}
