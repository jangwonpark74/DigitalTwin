import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultProject } from './model.mjs';
import { parseGeoJsonScene, parseRayPaths } from './scene.mjs';
import { captureBaseline, createCandidate, reviseCandidate, saveStudyDefinition } from './study.mjs';
import { prepareStudyRun, resolveRunInputs, candidateRunProblems, runInputStatus } from './study-run.mjs';
import { parseRunCaptureHeader } from './run-capture.mjs';

const receiver = { latitude: 37.5666, longitude: 126.9781, heightM: 1.5 };
export function runProject() {
  const project = defaultProject();
  Object.assign(project.sites[0].radioLocation, { latitude: project.map.latitude, longitude: project.map.longitude, source: 'manual' });
  project.map.scene = parseGeoJsonScene({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { height: 12 },
    geometry: { type: 'Polygon', coordinates: [[[126.9782, 37.5665], [126.9784, 37.5665], [126.9784, 37.5667], [126.9782, 37.5665]]] } }] }, { fileName: 'scene.geojson' });
  return saveStudyDefinition(project, { objective: 'Evaluate antenna-height path sensitivity', operator: 'Unverified declaration', rat: 'NR', carrierMhz: 3500 });
}
async function candidate() {
  const baseline = await captureBaseline(runProject(), 'Baseline', { id: 'baseline-1' });
  const project = await createCandidate(baseline, 'baseline-1', 'Candidate', '', { id: 'candidate-1' });
  return reviseCandidate(project, 'candidate-1', 1, [{ siteId: 'SITE-01', field: 'heightM', after: 35 }]);
}
test('baseline and candidate runs freeze actual selected inputs, source identities, options and solver assumptions', async () => {
  const project = await candidate();
  project.sites[0].heightM = 90;
  const base = await prepareStudyRun(project, { kind: 'baseline', baselineId: 'baseline-1' }, 'SITE-01', receiver);
  const changed = await prepareStudyRun(project, { kind: 'candidate', candidateId: 'candidate-1', version: 2 }, 'SITE-01', receiver, { maxDepth: 3 });
  assert.equal(base.transmitter.heightM, 28);
  assert.equal(changed.transmitter.heightM, 35);
  assert.equal(changed.maxDepth, 3);
  assert.equal(changed.runCapture.reference.version, 2);
  assert.equal(changed.runCapture.definitionVersion, 1);
  assert.equal(changed.runCapture.solverProfile.seed, 42);
  assert.equal(changed.runCapture.jobSha256, createHash('sha256').update(changed.runCapture.jobJson).digest('hex'));
  assert.equal(changed.runCapture.networkInputSha256, createHash('sha256').update(changed.runCapture.networkInputJson).digest('hex'));
  assert.equal(JSON.parse(changed.runCapture.networkInputJson).sites[0].heightM, 35);
  assert.equal(project.sites[0].heightM, 90);
});
test('unsupported sector or other-transmitter changes block a candidate run instead of being silently ignored', async () => {
  const height = await candidate();
  const tilt = await reviseCandidate(height, 'candidate-1', 2, [{ siteId: 'SITE-01', cellId: 'SITE-01-C1', field: 'downtiltDeg', after: 8 }]);
  assert.match(candidateRunProblems(tilt, { kind: 'candidate', candidateId: 'candidate-1', version: 3 }, 'SITE-01')[0], /downtiltDeg/);
  await assert.rejects(prepareStudyRun(tilt, { kind: 'candidate', candidateId: 'candidate-1', version: 3 }, 'SITE-01', receiver), /isotropic/i);
  await assert.rejects(prepareStudyRun(height, { kind: 'candidate', candidateId: 'candidate-1', version: 2 }, 'SITE-02', receiver), /SITE-01/);
  assert.throws(() => resolveRunInputs(height, { kind: 'candidate', candidateId: 'candidate-1', version: 99 }), /revision/i);
});
test('working runs become stale after engineering input changes while retained snapshots remain current to their versions', async () => {
  const project = await candidate();
  const working = await prepareStudyRun(project, { kind: 'working' }, 'SITE-01', receiver);
  const frozen = await prepareStudyRun(project, { kind: 'candidate', candidateId: 'candidate-1', version: 2 }, 'SITE-01', receiver);
  assert.equal((await runInputStatus(project, working.runCapture)).kind, 'current');
  project.sites[0].cells[0].txPowerDbm = 40;
  assert.equal((await runInputStatus(project, working.runCapture)).kind, 'stale');
  assert.equal((await runInputStatus(project, frozen.runCapture)).kind, 'current');
  const latest = await reviseCandidate(project, 'candidate-1', 2, []);
  assert.equal((await runInputStatus(latest, frozen.runCapture)).kind, 'historical');
  assert.equal((await runInputStatus(project, null)).kind, 'unknown');
});
test('result metadata retains a bounded capture identity while imported provenance stays unverified', async () => {
  const job = await prepareStudyRun(runProject(), { kind: 'working' }, 'SITE-01', receiver);
  const { networkInputJson, jobJson, ...header } = job.runCapture;
  const paths = { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runCapture: header,
    paths: [{ id: 'path-1', pathLossDb: 100, points: [job.transmitter, receiver] }] };
  const parsed = parseRayPaths(paths);
  assert.equal(parsed.provenance, 'imported-unverified');
  assert.deepEqual(parsed.runCapture, header);
  assert.equal(parsed.runCapture.networkInputJson, undefined);
  assert.throws(() => parseRayPaths({ ...paths, runCapture: { ...header, jobSha256: 'bad' } }), /capture/i);
});
test('capture metadata rejects unknown fields and non-ISO preparation times instead of retaining arbitrary reference content', async () => {
  const { runCapture } = await prepareStudyRun(runProject(), { kind: 'working' }, 'SITE-01', receiver);
  for (const changed of [
    { ...runCapture, reference: { kind: 'working', extra: { arbitrary: 'payload' } } },
    { ...runCapture, extra: 'unbounded extension' },
    { ...runCapture, preparedAt: 'Oct 2, 2026' },
    { ...runCapture, preparedAt: '2026-10-02T12:00:00' },
  ]) assert.throws(() => parseRunCaptureHeader(changed), /capture/i);
});
