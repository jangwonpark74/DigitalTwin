import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, simulatePreview, applyScenario, addSite, createManifest } from './model.mjs';

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
