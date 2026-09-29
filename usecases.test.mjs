import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUseCases, validateUseCases, drivePlan, abPlan, datasetPlan } from './usecases.mjs';
import { defaultProject, createManifest, validateProject } from './model.mjs';

test('drive test plans a reproducible route without fabricating radio KPIs', () => {
  const project = defaultProject();
  const plan = drivePlan(project);
  assert.equal(plan.status, 'not-executed');
  assert.equal(plan.samples.length, project.useCases.drive.samples);
  assert.deepEqual(plan.samples[0], plan.route.points[0]);
  assert.deepEqual(plan.samples.at(-1), plan.route.points.at(-1));
  assert.ok(plan.requestedMetrics.includes('RSRP'));
  assert.equal(plan.measurements, null);
});

test('paired package A/B has identical seeds, site and traffic for both arms', () => {
  const plan = abPlan(defaultProject());
  assert.equal(plan.status, 'not-executed');
  assert.ok(plan.pairs.length > 0);
  for (const pair of plan.pairs) {
    assert.equal(pair.a.seed, pair.b.seed);
    assert.equal(pair.a.siteId, pair.b.siteId);
    assert.equal(pair.a.trafficProfile, pair.b.trafficProfile);
    assert.notEqual(pair.a.packageId, pair.b.packageId);
  }
  assert.equal(plan.verdict, null);
});

test('dataset plan separates EM channel labels from RAN-dependent labels and never creates rows', () => {
  const project = defaultProject();
  const em = datasetPlan(project);
  assert.equal(em.requiredMode, 'EM');
  assert.ok(em.labels.includes('channel_cir'));
  assert.equal(em.generatedRows, 0);
  assert.equal(Object.values(em.plannedSplitRows).reduce((a,b) => a+b, 0), project.useCases.data.sampleBudget);
  project.useCases.data.task = 'handover-prediction';
  const ran = datasetPlan(project);
  assert.equal(ran.requiredMode, 'EM+RAN');
  assert.ok(ran.labels.includes('handover_success'));
  assert.ok(!ran.labels.includes('channel_cir'));
});

test('invalid experiment inputs are rejected before export', () => {
  const p = defaultProject();
  p.useCases.ab.packageB = p.useCases.ab.packageA;
  p.useCases.data.split.test = 99;
  p.useCases.drive.route = 'unknown';
  assert.ok(validateUseCases(p.useCases).some(x => x.includes('distinct')));
  assert.ok(validateUseCases(p.useCases).some(x => x.includes('sum to 100')));
  assert.ok(validateProject(p).some(x => x.includes('route')));
  assert.throws(() => createManifest(p), /route/);
});

test('manifest includes bounded planning specs, not experiment results or generated data', () => {
  const manifest = JSON.parse(createManifest(defaultProject()));
  assert.equal(manifest.useCases.drive.status, 'not-executed');
  assert.equal(manifest.useCases.ab.verdict, null);
  assert.equal(manifest.useCases.data.generatedRows, 0);
  assert.equal(manifest.useCases.data.status, 'not-executed');
});
