import test from 'node:test';
import assert from 'node:assert/strict';
import { parseGeoJsonScene, validateScene, parseRayPaths, validateRayPaths, sceneFit, geoToLocalMeters } from './scene.mjs';
import { CITY_PRESETS, sceneView, createCesiumViewer, syncCesiumScene, syncDemoCity, setCesiumCamera } from './scene-ui.mjs';
import { defaultProject, validateProject, createManifest, upgradeProject } from './model.mjs';

const feature = {
  type: 'Feature', id: 'tower-1', properties: { height: '24 m' },
  geometry: { type: 'Polygon', coordinates: [[
    [126.9778, 37.5664], [126.9780, 37.5664], [126.9780, 37.5666],
    [126.9778, 37.5666], [126.9778, 37.5664],
  ]] },
};
const sceneFile = { type: 'FeatureCollection', features: [feature] };
const rayFile = {
  schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326',
  runId: 'demo-run', solver: 'external-sample', paths: [{
    id: 'path-1', pathLossDb: 92.5, points: [
      { latitude: 37.5664, longitude: 126.9778, heightM: 24 },
      { latitude: 37.5666, longitude: 126.9780, heightM: 1.5 },
    ],
  }],
};

test('GeoJSON import normalizes bounded WGS84 footprints and fits the map', () => {
  const scene = parseGeoJsonScene(sceneFile, { fileName: 'buildings.geojson', importedAt: '2026-09-30T00:00:00Z' });
  assert.equal(scene.footprints.length, 1);
  assert.equal(scene.footprints[0].heightM, 24);
  assert.equal(scene.assumedHeightCount, 0);
  assert.deepEqual(validateScene(scene), []);
  const fit = sceneFit(defaultProject().map, scene);
  assert.ok(fit.radiusMeters >= 100 && fit.radiusMeters <= 20_000);
  assert.ok(Math.abs(fit.longitude - 126.9779) < .0001);
  const local = geoToLocalMeters({ ...defaultProject().map, ...fit }, 37.5666, 126.9780);
  assert.ok(Math.abs(local.eastM) < fit.radiusMeters && Math.abs(local.northM) < fit.radiusMeters);
});

test('scene import rejects unsupported CRS, holes, and invalid normalized geometry', () => {
  assert.throws(() => parseGeoJsonScene({ ...sceneFile, crs: { properties: { name: 'EPSG:3857' } } }), /WGS84/);
  assert.throws(() => parseGeoJsonScene({ ...sceneFile, features: [{ ...feature, geometry: { ...feature.geometry, coordinates: [feature.geometry.coordinates[0], feature.geometry.coordinates[0]] } }] }), /without holes/);
  const crossing = [[126.9778, 37.5664], [126.9781, 37.5667], [126.9781, 37.5664],
    [126.9778, 37.5667], [126.9779, 37.5668], [126.9778, 37.5664]];
  assert.throws(() => parseGeoJsonScene({ ...sceneFile, features: [{ ...feature, geometry: { type: 'Polygon', coordinates: [crossing] } }] }), /self-intersections/);
  const scene = parseGeoJsonScene(sceneFile);
  scene.bbox.north = NaN;
  assert.match(validateScene(scene)[0], /metadata/);
});

test('ray results validate path points, retain unverified provenance, and render in 3D', () => {
  const rays = parseRayPaths(rayFile, { fileName: 'paths.json' });
  assert.equal(rays.provenance, 'imported-unverified');
  assert.deepEqual(validateRayPaths(rays), []);
  assert.throws(() => parseRayPaths({ ...rayFile, paths: [{ ...rayFile.paths[0], pathLossDb: Infinity }] }), /pathLossDb/);
  const project = defaultProject();
  project.map.scene = parseGeoJsonScene(sceneFile);
  project.map.source = 'GeoJSON';
  project.rayResults = rays;
  assert.deepEqual(validateProject(project), []);
  const html = sceneView(project, { panel: (_title, caption, body) => caption + body, badge: value => value }, { rays, selectedRayId: 'path-1' });
  assert.match(html, /1 footprints loaded/);
  assert.match(html, /data-cesium-scene/);
  assert.match(html, /path-1/);
  assert.match(html, /uncalibrated geometry and material assumptions/);
  const manifest = JSON.parse(createManifest(project));
  const imported = upgradeProject({ ...manifest, name: manifest.project, useCases: manifest.useCaseConfig, scenario: 'baseline' });
  assert.deepEqual(validateProject(imported), []);
  assert.equal(imported.rayResults.provenance, 'imported-unverified');
  assert.equal(imported.map.scene.footprints.length, 1);
});

test('local Sionna result keeps bounded job and scene provenance through validation', () => {
  const data = { ...rayFile, sceneSha256: 'a'.repeat(64), totalPaths: 2,
    assumptions: 'Concrete buildings and isotropic antennas', job: {
      siteId: 'SITE-01', frequencyGhz: 3.5, samplesPerSrc: 1000, maxDepth: 0,
      reflections: false, diffraction: false, footprints: 1,
      transmitter: rayFile.paths[0].points[0], receiver: rayFile.paths[0].points[1],
    } };
  const rays = parseRayPaths(data, { provenance: 'sionna-rt-local' });
  assert.deepEqual(validateRayPaths(rays), []);
  assert.equal(rays.provenance, 'sionna-rt-local');
  assert.equal(rays.job.siteId, 'SITE-01');
  assert.equal(rays.totalPaths, 2);
  assert.equal(rays.sceneSha256, data.sceneSha256);
  const project = defaultProject();
  project.rayResults = rays;
  const manifest = JSON.parse(createManifest(project));
  assert.equal(manifest.rayResults.provenance, 'imported-unverified');
  assert.match(manifest.note, /local Sionna-RT path job completed/);
  assert.throws(() => parseRayPaths({ ...data, sceneSha256: 'bad' }), /scene hash/);
});

test('scene labels are escaped in HTML markup', () => {
  const project = defaultProject();
  project.map.scene = parseGeoJsonScene(sceneFile, { fileName: '<img src=x onerror=alert(1)>.geojson' });
  const html = sceneView(project, { panel: (_title, caption, body) => caption + body, badge: value => value });
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('Cesium entities keep WGS84 coordinate order and real heights', () => {
  const project = defaultProject();
  project.map.scene = parseGeoJsonScene(sceneFile);
  project.sites[0].radioLocation = { latitude: 37.5665, longitude: 126.9779, source: 'manual' };
  const rays = parseRayPaths(rayFile);
  const entities = [];
  const viewer = {
    entities: { removeAll: () => { entities.length = 0; }, add: entity => entities.push(entity) },
    scene: { requestRender() {} },
    camera: { lookAt(target, hpr) { this.target = target; this.hpr = hpr; }, lookAtTransform() {} },
  };
  const Cesium = {
    Cartesian3: { fromDegrees: (...values) => values }, Cartesian2: class { constructor(x, y) { this.x = x; this.y = y; } },
    Color: { fromCssColorString: value => ({ value, withAlpha: alpha => ({ value, alpha }) }), WHITE: 'white' },
    ArcType: { NONE: 0 }, Math: { toRadians: degrees => degrees * Math.PI / 180 },
    HeadingPitchRange: class { constructor(heading, pitch, range) { Object.assign(this, { heading, pitch, range }); } },
    Matrix4: { IDENTITY: {} },
  };
  syncCesiumScene(viewer, Cesium, project, { rays, selectedRayId: 'path-1' });
  assert.equal(entities.length, 3);
  assert.deepEqual(entities[0].polygon.hierarchy[0], [126.9778, 37.5664]);
  assert.equal(entities[0].polygon.extrudedHeight, 24);
  assert.deepEqual(entities[1].position, [126.9779, 37.5665, project.sites[0].heightM]);
  assert.deepEqual(entities[2].polyline.positions[0], [126.9778, 37.5664, 24]);
  setCesiumCamera(viewer, Cesium, project.map, { yaw: 35, pitch: 48, zoom: 1 });
  assert.deepEqual(viewer.camera.target, [project.map.longitude, project.map.latitude]);
  assert.ok(viewer.camera.hpr.range > project.map.radiusMeters);
});

test('city explorer renders an honest demo and generated buildings stay out of the project scene', () => {
  const project = defaultProject();
  const html = sceneView(project, { panel: (_title, caption, body) => caption + body, badge: value => value }, { cityPreset: 'seoul' });
  assert.match(html, /Explore a city/);
  assert.match(html, /generated examples, not OpenStreetMap data/);
  assert.match(html, /data-city-connect/);
  const entities = [];
  const viewer = { entities: { removeAll: () => { entities.length = 0; }, add: entity => entities.push(entity) }, scene: { requestRender() {} } };
  const Cesium = { Cartesian3: { fromDegrees: (...coordinates) => coordinates }, Color: { fromCssColorString: value => value } };
  const count = syncDemoCity(viewer, Cesium, 'seoul');
  assert.ok(count > 150);
  assert.equal(entities.length, count);
  assert.match(entities[0].description, /not OSM data or an RF simulation input/);
  assert.ok(Math.abs(entities[0].polygon.hierarchy[0][0] - CITY_PRESETS.seoul.longitude) < .02);
  assert.throws(() => syncDemoCity(viewer, Cesium, 'unknown'), /Unknown city preset/);
  assert.equal(project.map.scene, null);
});

test('online Cesium viewer requests world terrain and imagery only for live city mode', () => {
  const terrain = {}, options = [];
  const Cesium = {
    Viewer: class { constructor(_container, setup) {
      options.push(setup);
      this.scene = { backgroundColor: null, globe: {}, skyBox: { show: true }, skyAtmosphere: { show: true }, sun: { show: true }, moon: { show: true } };
    } },
    Terrain: { fromWorldTerrain: () => terrain },
    EllipsoidTerrainProvider: class {},
    Color: { fromCssColorString: value => value },
  };
  const container = { replaceChildren() {} };
  createCesiumViewer(container, Cesium);
  createCesiumViewer(container, Cesium, { online: true });
  assert.equal(options[0].baseLayer, false);
  assert.ok(options[0].terrainProvider instanceof Cesium.EllipsoidTerrainProvider);
  assert.equal(options[1].terrain, terrain);
  assert.equal(options[1].baseLayer, undefined);
});
