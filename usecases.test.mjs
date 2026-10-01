import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultUseCases, validateUseCases, drivePlan, abPlan, datasetPlan, buildUseCasePlanSpec } from './usecases.mjs';
import { defaultProject, createManifest, validateProject } from './model.mjs';
import { USE_CASE_CARD_ITEMS, useCaseCards } from './usecase-ui.mjs';

test('mission-control workflow entry cards share their exact legacy labels and navigation IDs', () => {
  const entries = [
    ['drive', '⌁', 'Virtual drive test', 'Replay a planned software-UE route through the city scene.'],
    ['ab', '⇄', 'Package A/B test', 'Pair RAN software packages under the same scene, traces, and seeds.'],
    ['data', '▥', 'AI-RAN data generation', 'Specify EM or EM+RAN training data with provenance and leak-safe splits.'],
  ];
  assert.deepEqual(USE_CASE_CARD_ITEMS, entries);
  assert.equal(useCaseCards(), `<div class="uc-cards">${entries.map(([id, icon, title, description]) =>
    `<button class="uc-card" data-go="${id}"><span>${icon}</span><strong>${title}</strong><small>${description}</small><em>Open workspace →</em></button>`).join('')}</div>`);
});

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

test('downloadable use-case plans retain the original planning-only schema and project scope', () => {
  const project = defaultProject();
  const original = structuredClone(project);
  for (const [type, build] of [['drive', drivePlan], ['ab', abPlan], ['data', datasetPlan]]) {
    const spec = buildUseCasePlanSpec(project, type);
    assert.deepEqual(spec, {
      schemaVersion: 1, mode: 'PLANNING_ONLY', useCase: type, city: project.map.city,
      cluster: project.map.cluster, config: project.useCases[type], plan: build(project),
      note: 'Not executed. No RF measurements, A/B verdict or training samples were generated.',
    });
  }
  assert.equal(buildUseCasePlanSpec(project, 'ab').plan.verdict, null);
  assert.deepEqual(project, original);
  assert.throws(() => buildUseCasePlanSpec(project, 'unknown'), /Unknown use-case plan/);
});
