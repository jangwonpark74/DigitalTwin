import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { buildDriveMeasurements } from './drive-measurements.mjs';
import { parseDmCsv } from './dm.mjs';
import { defaultProject, upgradeProject, validateProject, createManifest } from './model.mjs';
import { createWorkspaceState, updateWorkspaceProject } from './workspaces.mjs';
import { applyArtifactJson, buildArtifactTree, findArtifact } from './artifacts.mjs';
import { captureBaseline, saveStudyDefinition } from './study.mjs';
import { retainMeasurementDataset, selectMeasurementDataset, validateMeasurementLibrary, verifyMeasurementLibrary, assertMeasurementTransition } from './measurement-library.mjs';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm\n0,NR,A,37.5,127,-120\n1,NR,A,37.501,127.001,';
const trace = name => buildDriveMeasurements(parseDmCsv(csv), name);
const now = () => '2026-10-02T02:00:00Z';

test('retains prior working evidence on first import and switches immutable versions without changing a baseline', async () => {
  let original = defaultProject(); original.driveMeasurements = trace('old.csv');
  assert.equal(upgradeProject(original).measurementLibrary, undefined);
  original = saveStudyDefinition(original, { objective: 'Weak streets', operator: 'Unknown', rat: 'NR' }, { now });
  original = await captureBaseline(original, 'Before replacement', { now, id: 'base-1' });
  const next = await retainMeasurementDataset(original, trace('new.csv'), { now });
  assert.equal(original.measurementLibrary, undefined);
  assert.equal(next.measurementLibrary.records.length, 2);
  const previous = next.measurementLibrary.records[0];
  const restored = selectMeasurementDataset(next, previous.id);
  assert.deepEqual(restored.driveMeasurements, original.driveMeasurements);
  assert.deepEqual(restored.study, original.study);
  assert.deepEqual(validateProject(next), []);
  assert.deepEqual(validateProject(restored), []);
  await verifyMeasurementLibrary(restored);
  assert.deepEqual(JSON.parse(createManifest(restored)).measurementLibrary, restored.measurementLibrary);
  assert.deepEqual(JSON.parse(createManifest(restored)).driveMeasurements, restored.driveMeasurements);
});

test('exact duplicate snapshots are reused, deselection keeps history, and unknown selection is rejected', async () => {
  const first = await retainMeasurementDataset(defaultProject(), trace('one.csv'), { now });
  const second = await retainMeasurementDataset(first, first.driveMeasurements, { now });
  assert.deepEqual(second.measurementLibrary, first.measurementLibrary);
  const cleared = selectMeasurementDataset(second, null);
  assert.equal(cleared.driveMeasurements, null);
  assert.deepEqual(cleared.measurementLibrary.records, second.measurementLibrary.records);
  assert.deepEqual(validateMeasurementLibrary(cleared), []);
  assert.throws(() => selectMeasurementDataset(second, 'unknown'), /not found/i);
});

test('history removal, rewrite and a mismatched working mirror reject on domain and artifact paths', async () => {
  const saved = await retainMeasurementDataset(defaultProject(), trace('one.csv'), { now });
  const rewritten = structuredClone(saved); rewritten.measurementLibrary.records[0].registeredAt = '2026-10-02T03:00:00Z';
  assert.throws(() => assertMeasurementTransition(saved.measurementLibrary, rewritten.measurementLibrary), /immutable/i);
  assert.throws(() => assertMeasurementTransition(saved.measurementLibrary, undefined), /immutable/i);
  const workspace = createWorkspaceState(saved, { id: 'pilot', now });
  assert.throws(() => updateWorkspaceProject(workspace, 'pilot', project => { project.measurementLibrary = rewritten.measurementLibrary; }), /immutable/i);
  assert.throws(() => applyArtifactJson(saved, 'project-config', JSON.stringify(rewritten)), /immutable/i);
  const inconsistent = structuredClone(saved); inconsistent.driveMeasurements.samples[0].rsrpDbm = -80;
  assert.match(validateProject(inconsistent).join(';'), /working dataset/i);
  const corrupt = structuredClone(saved); corrupt.measurementLibrary.records[0].sha256 = '0'.repeat(64); corrupt.measurementLibrary.records[0].id = `dataset-${'0'.repeat(64)}`; corrupt.measurementLibrary.activeId = corrupt.measurementLibrary.records[0].id;
  await assert.rejects(verifyMeasurementLibrary(corrupt), /digest/i);
});

test('library bounds reject an additional dataset rather than dropping retained evidence', async () => {
  let project = defaultProject();
  for (let i = 0; i < 20; i++) project = await retainMeasurementDataset(project, trace(`file-${i}.csv`), { now });
  await assert.rejects(retainMeasurementDataset(project, trace('overflow.csv'), { now }), /20/);
  assert.equal(project.measurementLibrary.records.length, 20);
  const large = trace('large.csv'); large.samples = Array.from({ length: 4500 }, (_, index) => ({ ...large.samples[0], index, timeS: index }));
  const first = await retainMeasurementDataset(defaultProject(), large, { now });
  await assert.rejects(retainMeasurementDataset(first, { ...large, fileName: 'large-2.csv' }, { now }), /2 MB/);
});

test('project artifacts retain each source CSV, recipe and normalized snapshot after switching the working dataset', () => {
  const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/measurement-library.mjs'], { encoding: 'utf8' }));
  const project = fixture.restored.projects[0].project, tree = buildArtifactTree(project);
  for (const record of project.measurementLibrary.records) {
    const payload = JSON.parse(record.inputJson);
    assert.equal(findArtifact(tree, `measurement-${record.version}-source`).content, payload.evidence.rawCsv);
    assert.deepEqual(JSON.parse(findArtifact(tree, `measurement-${record.version}-snapshot`).content), payload);
  }
  assert.deepEqual(JSON.parse(findArtifact(tree, 'measurement-library').content), project.measurementLibrary);
});
