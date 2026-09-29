const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

export const CITY_PRESETS = Object.freeze({
  seoul: { label: 'Seoul · City Hall', latitude: 37.5665, longitude: 126.9780, radiusMeters: 720 },
  manhattan: { label: 'New York · Midtown', latitude: 40.7580, longitude: -73.9855, radiusMeters: 720 },
  sanFrancisco: { label: 'San Francisco · Downtown', latitude: 37.7897, longitude: -122.4011, radiusMeters: 720 },
  london: { label: 'London · City', latitude: 51.5136, longitude: -0.0890, radiusMeters: 720 },
});

export function sceneView(project, helpers, { yaw = 35, pitch = 48, zoom = 1, rays = null, selectedRayId = null,
  cityPreset = null, citySource = 'demo', cityStatus = '', cityLoading = false } = {}) {
  const scene = project.map.scene;
  const located = project.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude)).length;
  const city = cityPreset && CITY_PRESETS[cityPreset];
  const caption = city ? `${city.label} · ${citySource === 'ion' ? 'live Cesium OSM Buildings' : 'generated city preview'}` : scene
    ? `${esc(scene.fileName)} · WGS84 EPSG:4326 · ${scene.footprints.length} footprints loaded`
    : 'WGS84 EPSG:4326 · load GeoJSON to add building geometry';
  const controls = `<div class="scene-toolbar" aria-label="3D camera controls"><button type="button" data-scene-control="left" aria-label="Rotate left">↶ Rotate</button><button type="button" data-scene-control="right" aria-label="Rotate right">Rotate ↷</button><button type="button" data-scene-control="tilt-down" aria-label="Lower tilt">− Tilt</button><button type="button" data-scene-control="tilt-up" aria-label="Raise tilt">+ Tilt</button><button type="button" data-scene-control="zoom-out" aria-label="Zoom out">− Zoom</button><button type="button" data-scene-control="zoom-in" aria-label="Zoom in">+ Zoom</button><span>Yaw ${yaw}° · tilt ${pitch}° · zoom ${zoom.toFixed(1)}×</span></div>`;
  if (city) {
    const locations = Object.entries(CITY_PRESETS).map(([id, preset]) =>
      `<button type="button" data-city-preset="${id}" class="${cityPreset === id ? 'active' : ''}" aria-pressed="${cityPreset === id}">${esc(preset.label)}</button>`).join('');
    const status = cityStatus ? `<p class="city-status${citySource === 'ion' ? ' live' : ''}" role="status">${esc(cityStatus)}</p>` : '';
    const connection = `<div class="city-connect"><label for="cesium-ion-token">Cesium ion access token</label><input id="cesium-ion-token" data-city-token type="password" autocomplete="off" spellcheck="false" placeholder="Paste a token for live OSM buildings"/><button type="button" data-city-connect ${cityLoading ? 'disabled' : ''}>${cityLoading ? 'Connecting…' : 'Load live OSM Buildings'}</button>${citySource === 'ion' ? '<button type="button" data-city-demo>Use demo city</button>' : ''}<a href="https://ion.cesium.com/tokens" target="_blank" rel="noopener noreferrer">Get a Cesium ion token ↗</a></div>`;
    return helpers.panel('3D city explorer', esc(caption),
      `<div class="city-picker" role="group" aria-label="Explore a city">${locations}</div>${connection}${status}${controls}<div class="scene-stage city-stage" data-cesium-scene role="img" aria-label="3D view of ${esc(city.label)} ${citySource === 'ion' ? 'with live OSM buildings' : 'with illustrative buildings'}"><div class="scene-loading" role="status">Loading city view…</div></div><p class="scene-disclaimer">${citySource === 'ion' ? 'Buildings, imagery and terrain stream from Cesium ion. © OpenStreetMap contributors. Cesium displays the required source credits.' : 'The buildings in this preview are generated examples, not OpenStreetMap data.'} City exploration does not change the project map, radio positions or Sionna-RT scene. A token is kept in this tab’s memory, sent to Cesium ion, and not stored in the project database.</p>`,
      helpers.badge(citySource === 'ion' ? 'LIVE OSM BUILDINGS' : 'ILLUSTRATIVE CITY', citySource === 'ion' ? '' : 'warn'));
  }
  const raysNote = rays ? `<span>${rays.paths.length} ${rays.provenance === 'sionna-rt-local' ? 'local Sionna-RT' : 'imported'} ray paths · ${rays.provenance === 'sionna-rt-local' ? 'uncalibrated' : 'source unverified'}${selectedRayId ? ` · selected ${esc(selectedRayId)}` : ''}</span>` : '<span>No ray paths loaded</span>';
  return helpers.panel('CesiumJS 3D scene', caption,
    `${controls}<div class="scene-stage" data-cesium-scene role="img" aria-label="3D globe with ${scene?.footprints.length || 0} loaded footprints, ${located} located radio sites${rays ? ` and ${rays.paths.length} ray paths` : ''}"><div class="scene-loading" role="status">Loading CesiumJS globe…</div></div><div class="scene-legend"><span><i class="scene-key building"></i> Footprints ${scene?.footprints.length || 0}</span><span><i class="scene-key located"></i> Located radios ${located}</span><span>Unlocated radios ${project.sites.length - located} require coordinates</span>${raysNote}</div><p class="scene-disclaimer">CesiumJS places imported geometry at its WGS84 coordinates with actual building and antenna heights. The globe uses an ellipsoid without terrain or imagery. Imported paths remain unverified; local Sionna-RT output uses uncalibrated geometry and material assumptions.</p>`,
    helpers.badge(scene ? 'GEOJSON LOADED' : 'NO BUILDINGS', scene ? '' : 'warn'));
}

export function createCesiumViewer(container, Cesium, { online = false } = {}) {
  container.replaceChildren();
  const viewer = new Cesium.Viewer(container, {
    ...(online ? { terrain: Cesium.Terrain.fromWorldTerrain() }
      : { baseLayer: false, terrainProvider: new Cesium.EllipsoidTerrainProvider() }),
    baseLayerPicker: false,
    animation: false, timeline: false, geocoder: false, homeButton: false,
    sceneModePicker: false, navigationHelpButton: false, infoBox: false,
    selectionIndicator: false, fullscreenButton: false, scene3DOnly: true,
  });
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0d2233');
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#153840');
  if (!online) {
    viewer.scene.skyBox.show = false;
    viewer.scene.skyAtmosphere.show = false;
    viewer.scene.sun.show = false;
    viewer.scene.moon.show = false;
  }
  return viewer;
}

export function syncDemoCity(viewer, Cesium, presetId = 'seoul') {
  const center = CITY_PRESETS[presetId];
  if (!center) throw new Error('Unknown city preset');
  viewer.entities.removeAll();
  const metersPerDegreeLatitude = 111_320;
  const metersPerDegreeLongitude = metersPerDegreeLatitude * Math.cos(center.latitude * Math.PI / 180);
  let count = 0;
  for (let row = -9; row <= 9; row++) {
    for (let column = -9; column <= 9; column++) {
      if (row % 6 === 0 || column % 6 === 0) continue;
      const seed = Math.abs((row * 73856093) ^ (column * 19349663));
      const width = 35 + seed % 23;
      const depth = 35 + (seed >> 4) % 23;
      const east = column * 73;
      const north = row * 73;
      const longitude = center.longitude + east / metersPerDegreeLongitude;
      const latitude = center.latitude + north / metersPerDegreeLatitude;
      const halfLongitude = width / (2 * metersPerDegreeLongitude);
      const halfLatitude = depth / (2 * metersPerDegreeLatitude);
      const downtown = Math.max(0, 9 - Math.hypot(row, column));
      const height = Math.round(12 + seed % 45 + downtown * (5 + seed % 7));
      const positions = [
        [longitude - halfLongitude, latitude - halfLatitude],
        [longitude + halfLongitude, latitude - halfLatitude],
        [longitude + halfLongitude, latitude + halfLatitude],
        [longitude - halfLongitude, latitude + halfLatitude],
      ].map(([lon, lat]) => Cesium.Cartesian3.fromDegrees(lon, lat));
      viewer.entities.add({
        id: `illustrative-${presetId}-${++count}`, name: 'Illustrative city building',
        description: 'Generated building for visual exploration; not OSM data or an RF simulation input.',
        polygon: { hierarchy: positions, height: 0, extrudedHeight: height,
          material: Cesium.Color.fromCssColorString(['#a9c7ca', '#84afb8', '#6d9aa7', '#c3c8bc'][seed % 4]),
          outline: true, outlineColor: Cesium.Color.fromCssColorString('#e3eeee') },
      });
    }
  }
  viewer.scene.requestRender();
  return count;
}

export function syncCesiumScene(viewer, Cesium, project, { rays = null, selectedRayId = null } = {}) {
  viewer.entities.removeAll();
  for (const [index, footprint] of (project.map.scene?.footprints || []).entries()) {
    const positions = footprint.ring.map(([longitude, latitude]) => Cesium.Cartesian3.fromDegrees(longitude, latitude));
    viewer.entities.add({
      id: `building-${index}`, name: footprint.id,
      description: `${esc(footprint.id)} · ${footprint.heightM} m${footprint.assumedHeight ? ' estimated' : ''}`,
      polygon: {
        hierarchy: positions, height: 0, extrudedHeight: footprint.heightM,
        material: Cesium.Color.fromCssColorString(index % 3 === 0 ? '#74b9af' : '#48949c').withAlpha(0.9),
        outline: true, outlineColor: Cesium.Color.fromCssColorString('#d6ece5'),
      },
    });
  }
  for (const site of project.sites) {
    const { latitude, longitude } = site.radioLocation;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
    const top = Cesium.Cartesian3.fromDegrees(longitude, latitude, site.heightM);
    viewer.entities.add({
      id: `radio-${site.id}`, name: site.name,
      polyline: {
        positions: [Cesium.Cartesian3.fromDegrees(longitude, latitude), top],
        width: 4, arcType: Cesium.ArcType.NONE,
        material: Cesium.Color.fromCssColorString('#46efd0'),
      },
      point: { pixelSize: 9, color: Cesium.Color.fromCssColorString('#cffff0'), outlineColor: Cesium.Color.fromCssColorString('#18856f'), outlineWidth: 2 },
      label: {
        text: site.id, font: 'bold 13px sans-serif', fillColor: Cesium.Color.WHITE,
        showBackground: true, backgroundColor: Cesium.Color.fromCssColorString('#123340').withAlpha(0.8),
        pixelOffset: new Cesium.Cartesian2(0, -18),
      },
      position: top,
    });
  }
  for (const [index, ray] of (rays?.paths || []).entries()) {
    const selected = !selectedRayId || ray.id === selectedRayId;
    const positions = ray.points.map(point => Cesium.Cartesian3.fromDegrees(point.longitude, point.latitude, point.heightM));
    viewer.entities.add({
      id: `ray-${index}`, name: ray.id,
      description: `${esc(ray.id)} · ${ray.pathLossDb} dB · ${rays.provenance === 'sionna-rt-local' ? 'local Sionna-RT, uncalibrated' : 'imported, unverified'}`,
      polyline: {
        positions, arcType: Cesium.ArcType.NONE, width: selected ? 4 : 2,
        material: Cesium.Color.fromCssColorString('#e5a3ff').withAlpha(selected ? 1 : 0.25),
      },
    });
  }
  viewer.scene.requestRender();
}

export function setCesiumCamera(viewer, Cesium, map, { yaw = 35, pitch = 48, zoom = 1 } = {}) {
  const target = Cesium.Cartesian3.fromDegrees(map.longitude, map.latitude);
  const heading = Cesium.Math.toRadians(yaw);
  const tilt = Cesium.Math.toRadians(-pitch);
  const range = Math.max(250, map.radiusMeters * 2.8) / zoom;
  viewer.camera.lookAt(target, new Cesium.HeadingPitchRange(heading, tilt, range));
  viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
  viewer.scene.requestRender();
}
