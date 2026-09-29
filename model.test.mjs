import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, simulatePreview, applyScenario, addSite, createManifest,
  upgradeProject, mapPercentToGeo, geoToMapPercent } from './model.mjs';

test('default project encodes physical/virtual RAN boundaries and GH200 roles', () => {
  const p = defaultProject();
  assert.equal(p.architecture.vCore.kind, 'physical');
  assert.equal(p.architecture.vDU.kind, 'physical');
  assert.equal(p.architecture.ru.kind, 'virtual');
  assert.equal(p.architecture.ue.kind, 'virtual-cpu');
  assert.equal(p.runtime.host, 'GH200');
  assert.equal(p.runtime.gpu, 'H200');
  assert.equal(p.runtime.cpu, 'Grace CPU');
  assert.equal(p.channel.engine, 'Sionna-RT');
  assert.equal(p.map.source, 'OpenStreetMap');
  assert.equal(p.integration.connected, false);
  assert.equal(validateProject(p).length, 0);
});

test('validates map coordinates, radio limits, and site-cell identifiers', () => {
  const p = defaultProject();
  p.map.latitude = 95;
  p.sites[0].cells[1].id = p.sites[0].cells[0].id;
  p.sites[0].cells[0].txPowerDbm = 200;
  const errors = validateProject(p);
  assert.ok(errors.some(x => x.includes('latitude')));
  assert.ok(errors.some(x => x.includes('Duplicate cell')));
  assert.ok(errors.some(x => x.includes('Tx power')));
});

test('reports malformed site and cell records without throwing', () => {
  const missingSite = defaultProject();
  missingSite.sites[0] = null;
  assert.ok(validateProject(missingSite).includes('Invalid site record'));

  const missingCell = defaultProject();
  missingCell.sites[0].cells[0] = null;
  assert.ok(validateProject(missingCell).includes('Invalid cell record for SITE-01'));
});

test('illustrative preview responds to blockage, UE density, and antenna tuning', () => {
  const p = defaultProject();
  const baseline = simulatePreview(p);
  const blocked = simulatePreview(applyScenario(p, 'blockage'));
  const crowded = simulatePreview(applyScenario(p, 'ue-surge'));
  const tuned = defaultProject(); tuned.sites[0].cells[0].txPowerDbm += 6;
  assert.equal(baseline.method, 'ILLUSTRATIVE_ONLY_NOT_RAY_TRACING');
  assert.ok(blocked.coveragePercent < baseline.coveragePercent);
  assert.ok(crowded.estimatedUes > baseline.estimatedUes);
  assert.ok(crowded.capacityPressure > baseline.capacityPressure);
  assert.ok(simulatePreview(tuned).coveragePercent > baseline.coveragePercent);
});

test('adding a site creates three unique cells and honors location', () => {
  const p = addSite(defaultProject(), { name: 'River site', x: 71, y: 52 });
  assert.equal(p.sites.length, 4);
  assert.equal(p.sites[3].cells.length, 3);
  assert.equal(new Set(p.sites.flatMap(s => s.cells.map(c => c.id))).size, 12);
  assert.equal(p.sites[3].x, 71);
  assert.equal(p.sites[3].y, 52);
  assert.throws(() => addSite(p, { name: '', x: 10, y: 20 }), /name/);
});

test('radio locations default to editable Samsung targets and new sites receive the same planning schema', () => {
  const p = defaultProject();
  assert.equal(p.sites[0].radio.manufacturer, 'Samsung');
  assert.equal(p.sites[0].radio.technology, '5G NR');
  assert.deepEqual(p.sites[0].radioLocation, { latitude: null, longitude: null, source: 'unassigned' });
  const added = addSite(p, { name: 'North site', x: 42, y: 63 });
  assert.equal(added.sites.at(-1).radio.manufacturer, 'Samsung');
  assert.equal(added.sites.at(-1).radioLocation.source, 'unassigned');
});

test('upgrades older site records without losing their current map or front-end settings', () => {
  const legacy = defaultProject();
  delete legacy.sites[0].radio;
  delete legacy.sites[0].radioLocation;
  legacy.sites[0].x = 29;
  legacy.sites[0].frontEnd = 'MMU';
  const upgraded = upgradeProject(legacy);
  assert.equal(upgraded.sites[0].x, 29);
  assert.equal(upgraded.sites[0].frontEnd, 'MMU');
  assert.equal(upgraded.sites[0].radio.manufacturer, 'Samsung');
  assert.equal(upgraded.sites[0].radioLocation.source, 'unassigned');
});

test('validates Samsung radio modes, optional MMU parameters and geographic coordinates', () => {
  const p = defaultProject();
  p.sites[0].radio.technology = '3G';
  p.sites[0].radio.mmuElements = 0;
  p.sites[0].radioLocation.latitude = 91;
  const errors = validateProject(p);
  assert.ok(errors.some(error => error.includes('technology')));
  assert.ok(errors.some(error => error.includes('MMU')));
  assert.ok(errors.some(error => error.includes('radio latitude')));
});

test('schematic map placement converts to a local geographic estimate and round-trips', () => {
  const map = { latitude: 37.5665, longitude: 126.978, radiusMeters: 1200 };
  const center = mapPercentToGeo(map, 50, 50);
  assert.equal(center.latitude, map.latitude);
  assert.equal(center.longitude, map.longitude);
  const northeast = mapPercentToGeo(map, 100, 0);
  const position = geoToMapPercent(map, northeast.latitude, northeast.longitude);
  assert.ok(Math.abs(position.x - 100) < 1e-8);
  assert.ok(Math.abs(position.y) < 1e-8);
  const antimeridian = { latitude: 0, longitude: 179.999, radiusMeters: 1000 };
  const acrossAntimeridian = mapPercentToGeo(antimeridian, 75, 50);
  assert.ok(acrossAntimeridian.longitude < -179.99);
  const antimeridianPosition = geoToMapPercent(antimeridian, acrossAntimeridian.latitude, acrossAntimeridian.longitude);
  assert.ok(Math.abs(antimeridianPosition.x - 75) < 1e-8);
  assert.throws(() => geoToMapPercent(map, 37.59, 126.978), /outside.*map radius/i);
  assert.throws(() => mapPercentToGeo({ ...map, latitude: 90 }, 80, 50), /poles/i);
});

test('mockup never claims external readiness from user-supplied flags', () => {
  const p = defaultProject();
  p.map.geometryValidated = true; p.map.coordinateAligned = true; p.map.materialAssigned = true;
  p.runtime.status = 'verified'; p.integration.connected = true;
  const manifest = JSON.parse(createManifest(p));
  assert.equal(manifest.readiness.readyForRayTracing, false);
  assert.equal(manifest.readiness.checks.filter(x => x.done).length, 1);
  assert.equal(manifest.integration.connected, false);
  assert.equal(manifest.runtime.status, 'not-connected');
});

test('rejects malformed asset identifiers before they can reach markup', () => {
  const p = defaultProject();
  p.sites[0].id = 'SITE-01" onmouseover="alert(1)';
  assert.ok(validateProject(p).some(x => x.includes('invalid site')));
});

test('manifest is explicit about missing integration and synthetic preview', () => {
  const manifest = JSON.parse(createManifest(defaultProject()));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.integration.connected, false);
  assert.equal(manifest.channel.execution, 'planned-not-executed');
  assert.equal(manifest.preview.method, 'ILLUSTRATIVE_ONLY_NOT_RAY_TRACING');
  assert.equal(manifest.sites.length, 3);
  assert.equal(manifest.readiness.readyForRayTracing, false);
});

test('manifest preserves per-location Samsung RU, MMU and geographic planning inputs', () => {
  const project = defaultProject();
  Object.assign(project.sites[1].radio, { technology: '4G LTE + 5G NR', ruModel: 'RU reference', band: 'B3+n78', mmuModel: 'MMU reference', mmuElements: 64 });
  project.sites[1].frontEnd = 'MMU';
  project.sites[1].radioLocation = { latitude: 37.5665, longitude: 126.978, source: 'manual' };
  const exported = JSON.parse(createManifest(project)).sites[1];
  assert.equal(exported.radio.technology, '4G LTE + 5G NR');
  assert.equal(exported.radio.ruModel, 'RU reference');
  assert.equal(exported.radio.mmuModel, 'MMU reference');
  assert.equal(exported.radio.mmuElements, 64);
  assert.deepEqual(exported.radioLocation, project.sites[1].radioLocation);
});
