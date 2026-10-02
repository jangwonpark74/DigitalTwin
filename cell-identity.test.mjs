import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, createManifest } from './model.mjs';
import { parseDmCsv, buildDmAnalysisReport } from './dm.mjs';
import { buildDriveMeasurements, validateDriveMeasurements } from './drive-measurements.mjs';
import { captureBaseline, saveStudyDefinition } from './study.mjs';
import { retainMeasurementDataset } from './measurement-library.mjs';
import { cellIdentityKey, cellIdentityRows, resolveMeasurementCell, prepareCellIdentity } from './cell-identity.mjs';

const trace = () => buildDriveMeasurements(parseDmCsv('time_s,technology,serving_cell,latitude,longitude\n0,NR,vendor:42,37.5,127.0\n1,LTE,vendor:42,37.5001,127.0\n2,NR,vendor:43,37.5002,127.0'), 'identities.csv');
const binding = { technology: 'NR', sourceCell: 'vendor:42', targetCellId: 'SITE-01-C1' };

test('identity associations are scoped to RAT and preserve source samples and provenance', () => {
  const project = defaultProject(), original = trace();
  project.sites[0].radio.technology = '5G NR';
  const linked = prepareCellIdentity(original, project.sites, [binding]);
  assert.deepEqual(original.cellIdentity, undefined);
  assert.deepEqual(linked.samples, original.samples);
  assert.equal(validateDriveMeasurements(linked).length, 0);
  assert.equal(resolveMeasurementCell(linked, project.sites, linked.samples[0]).status, 'reviewed');
  assert.equal(resolveMeasurementCell(linked, project.sites, linked.samples[0]).cellId, binding.targetCellId);
  assert.equal(resolveMeasurementCell(linked, project.sites, linked.samples[1]).status, 'unresolved');
  assert.notEqual(cellIdentityKey('NR', 'vendor:42'), cellIdentityKey('LTE', 'vendor:42'));
  assert.equal(cellIdentityRows(linked, project.sites).length, 3);
});

test('resolution never substitutes missing, ambiguous or incompatible inventory targets', () => {
  const project = defaultProject(), linked = prepareCellIdentity(trace(), project.sites, [binding]);
  const removed = structuredClone(project.sites); removed[0].cells = removed[0].cells.slice(1);
  assert.equal(resolveMeasurementCell(linked, removed, linked.samples[0]).status, 'missing-cell');
  assert.equal(resolveMeasurementCell(linked, [...project.sites, project.sites[0]], linked.samples[0]).status, 'ambiguous');
  const incompatible = structuredClone(project.sites); incompatible[0].radio.technology = '4G LTE';
  assert.equal(resolveMeasurementCell(linked, incompatible, linked.samples[0]).status, 'technology-mismatch');
  assert.throws(() => prepareCellIdentity(trace(), incompatible, [binding]), /technology/);
  assert.throws(() => prepareCellIdentity(trace(), project.sites, [{ ...binding, targetCellId: 'SITE-99-C1' }]), /inventory/);
});

test('exact internal IDs remain distinct from reviewed associations and may be explicitly unresolved', () => {
  const project = defaultProject(), original = trace(); original.samples[0].servingCell = 'SITE-01-C1';
  assert.equal(resolveMeasurementCell(original, project.sites, original.samples[0]).status, 'exact-id');
  const linked = prepareCellIdentity(original, project.sites, [{ ...binding, sourceCell: 'SITE-01-C1', targetCellId: null }]);
  assert.equal(resolveMeasurementCell(linked, project.sites, linked.samples[0]).status, 'unresolved');
});

test('identity schema rejects duplicate, unobserved, malformed or verification-claiming associations', () => {
  const project = defaultProject(), linked = prepareCellIdentity(trace(), project.sites, [binding]);
  for (const mutate of [
    value => value.cellIdentity.bindings.push(binding),
    value => value.cellIdentity.bindings[0].sourceCell = 'unknown',
    value => value.cellIdentity.bindings[0].technology = 'WIFI',
    value => value.cellIdentity.bindings[0].targetCellId = 'PCI-42',
    value => value.cellIdentity.verification = 'verified',
    value => value.cellIdentity.schemaVersion = true,
    value => value.cellIdentity = null,
  ]) {
    const bad = structuredClone(linked); mutate(bad);
    assert.ok(validateDriveMeasurements(bad).length);
  }
});

test('identity edits retain a new dataset version and frozen baselines keep the previous interpretation', async () => {
  let project = defaultProject(); project.driveMeasurements = trace();
  project = await retainMeasurementDataset(project, project.driveMeasurements);
  project = saveStudyDefinition(project, { objective: 'Identity review', operator: 'Declared SKT', rat: 'ALL' });
  project = await captureBaseline(project, 'Before reconciliation');
  const baseline = project.study.baselines[0].inputJson, old = project.measurementLibrary.records[0];
  const linked = prepareCellIdentity(project.driveMeasurements, project.sites, [binding]);
  project = await retainMeasurementDataset(project, linked);
  assert.equal(project.measurementLibrary.records.length, 2);
  assert.deepEqual(project.measurementLibrary.records[0], old);
  assert.equal(project.study.baselines[0].inputJson, baseline);
  assert.equal(JSON.parse(baseline).inputs.driveMeasurements.cellIdentity, undefined);
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(JSON.parse(createManifest(project)).driveMeasurements.cellIdentity, linked.cellIdentity);
});

test('analysis exports retain the reviewed interpretation and original source event identities', () => {
  const project = defaultProject(), original = trace(); original.samples[0].event = 'handover';
  const linked = prepareCellIdentity(original, project.sites, [binding]);
  const report = buildDmAnalysisReport(linked, { filename: linked.fileName });
  assert.deepEqual(report.cellIdentity, linked.cellIdentity);
  assert.equal(report.events[0].servingCell, 'vendor:42');
  report.cellIdentity.bindings[0].targetCellId = null;
  assert.equal(linked.cellIdentity.bindings[0].targetCellId, binding.targetCellId);
});
