import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { defaultProject, validateProject, createManifest, upgradeProject } from './model.mjs';
import { createWorkspaceState, updateWorkspaceProject } from './workspaces.mjs';
import { applyArtifactJson } from './artifacts.mjs';
import { saveStudyDefinition, captureBaseline, createCandidate, reviseCandidate, candidateInputs,
  validateStudy, verifyStudyDigests, assertStudyTransition, engineeringInputs } from './study.mjs';

const definition = { objective: 'Reduce weak street segments', operator: 'SKT (source declaration)', rat: 'NR', carrierMhz: 3500,
  windowStart: null, windowEnd: null };
const options = id => ({ id, now: () => '2026-10-02T01:00:00.000Z' });
async function baseline() {
  return captureBaseline(saveStudyDefinition(defaultProject(), definition, options('unused')), 'Gangnam baseline', options('baseline-1'));
}

test('legacy projects do not acquire an invented study; definition versions are retained', () => {
  assert.equal(upgradeProject(defaultProject()).study, undefined);
  const one = saveStudyDefinition(defaultProject(), definition, options('one'));
  const two = saveStudyDefinition(one, { ...definition, objective: 'Review interference' }, options('two'));
  assert.equal(one.study.definitions.length, 1);
  assert.deepEqual(two.study.definitions[0], one.study.definitions[0]);
  assert.equal(two.study.definitions[1].version, 2);
  assert.throws(() => saveStudyDefinition(two, { ...definition, carrierMhz: 0 }), /carrier/i);
  assert.throws(() => saveStudyDefinition(two, { ...definition, windowStart: '2026-02-30', windowEnd: '2026-03-01' }), /window/i);
});

test('baseline freezes engineering inputs and definition, independent of later edits and view status', async () => {
  const source = saveStudyDefinition(defaultProject(), definition);
  const frozen = await captureBaseline(source, 'Gangnam baseline', options('baseline-1'));
  source.sites[0].cells[0].txPowerDbm = 20;
  const capture = frozen.study.baselines[0], payload = JSON.parse(capture.inputJson);
  assert.equal(payload.inputs.sites[0].cells[0].txPowerDbm, 43);
  assert.equal(payload.definition.version, 1);
  assert.equal(capture.sha256, createHash('sha256').update(capture.inputJson).digest('hex'));
  assert.equal(payload.inputs.runtime, undefined);
  assert.equal(payload.inputs.rayResults, undefined);
  assert.equal(payload.inputs.study, undefined);
  assert.deepEqual(validateProject(frozen), []);
  await verifyStudyDigests(frozen.study);
  assert.deepEqual(JSON.parse(createManifest(frozen)).study, frozen.study);
});

test('candidate exact changes preserve baseline and earlier revisions; reverting creates a retained version', async () => {
  const frozen = await baseline(), before = structuredClone(frozen.study.baselines);
  const created = await createCandidate(frozen, 'baseline-1', 'Downtilt study', 'Weak segment 12', options('candidate-1'));
  const changed = await reviseCandidate(created, 'candidate-1', 1,
    [{ siteId: 'SITE-01', cellId: 'SITE-01-C1', field: 'downtiltDeg', after: 8 }], options('unused'));
  const candidate = changed.study.candidates[0];
  assert.deepEqual(JSON.parse(candidate.versions[1].inputJson).changes,
    [{ siteId: 'SITE-01', cellId: 'SITE-01-C1', field: 'downtiltDeg', before: 6, after: 8 }]);
  assert.equal(candidateInputs(changed.study, 'candidate-1', 2).sites[0].cells[0].downtiltDeg, 8);
  assert.equal(changed.sites[0].cells[0].downtiltDeg, 6);
  assert.deepEqual(changed.study.baselines, before);
  const reverted = await reviseCandidate(changed, 'candidate-1', 2, [], options('unused'));
  assert.equal(reverted.study.candidates[0].versions.length, 3);
  assert.equal(candidateInputs(reverted.study, 'candidate-1', 3).sites[0].cells[0].downtiltDeg, 6);
  assert.deepEqual(reverted.study.candidates[0].versions[1], candidate.versions[1]);
  assert.throws(() => assertStudyTransition(changed.study, created.study), /immutable/i);
});

test('candidate validation rejects arbitrary fields, mismatched identities, invalid units and stale revisions', async () => {
  const project = await createCandidate(await baseline(), 'baseline-1', 'Candidate', '', options('candidate-1'));
  for (const change of [
    { siteId: 'SITE-01', cellId: 'SITE-01-C1', field: '__proto__', after: 1 },
    { siteId: 'SITE-01', cellId: 'SITE-02-C1', field: 'txPowerDbm', after: 30 },
    { siteId: 'SITE-01', cellId: 'SITE-01-C1', field: 'txPowerDbm', after: 61 },
    { siteId: 'SITE-01', field: 'heightM', after: 0 },
  ]) await assert.rejects(reviseCandidate(project, 'candidate-1', 1, [change]), /change|field|cell|range/i);
  await assert.rejects(reviseCandidate(project, 'candidate-1', 2, []), /revision/i);
  await assert.rejects(createCandidate(project, 'missing', 'Other', ''), /baseline/i);
});

test('workspace and artifact edits cannot rewrite snapshots or remove their history; modified payload fails digest', async () => {
  const project = await baseline();
  const state = createWorkspaceState(project, { id: 'project-a' });
  assert.throws(() => updateWorkspaceProject(state, 'project-a', value => { value.study.baselines[0].name = 'Rewritten'; }), /immutable/i);
  assert.throws(() => updateWorkspaceProject(state, 'project-a', value => { delete value.study; }), /immutable/i);
  const rewritten = structuredClone(project); rewritten.study.baselines[0].name = 'Rewritten';
  assert.throws(() => applyArtifactJson(project, 'project-config', JSON.stringify(rewritten)), /immutable/i);
  const modified = structuredClone(project.study);
  modified.baselines[0].inputJson = modified.baselines[0].inputJson.replace('"heightM":28', '"heightM":29');
  await assert.rejects(verifyStudyDigests(modified), /digest/i);
  assert.ok(validateStudy({ ...project.study, schemaVersion: 9 }).length);
  assert.deepEqual(engineeringInputs(project), JSON.parse(project.study.baselines[0].inputJson).inputs);
});
