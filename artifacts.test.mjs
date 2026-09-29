import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { applyArtifactJson, artifactTreeFromRecords, buildArtifactTree, findArtifact, isEditableJsonArtifact, listArtifactFiles, workspaceArtifactIndex } from './artifacts.mjs';
import { parseRayPaths } from './scene.mjs';
import { addWorkspaceProject, createWorkspaceState, updateWorkspaceProject, workspaceProject } from './workspaces.mjs';

const walk = (node, parts = []) => [{ node, path: parts.concat(node.name).join('/') }, ...(node.children || []).flatMap(child => walk(child, parts.concat(node.name)))];

test('artifact tree organizes project configuration, results, logs and reports as project files', () => {
  const tree = buildArtifactTree(defaultProject());
  assert.equal(tree.type, 'directory');
  assert.deepEqual(tree.children.map(item => item.name), ['README.md', 'configuration', 'test-results', 'logs', 'reports']);
  assert.deepEqual(tree.children.find(item => item.name === 'configuration').children.map(item => item.name), ['project.json', 'use-cases.json', 'twin-management.json']);
  assert.ok(listArtifactFiles(tree).every(file => file.type === 'file' && typeof file.content === 'string'));
  assert.equal(findArtifact(tree, 'project-config').name, 'project.json');
});

test('configuration and planning manifest files represent the active project without external readiness claims', () => {
  const project = defaultProject(); project.name = 'Seoul Pilot'; project.map.city = 'Seoul';
  project.runtime.status = 'verified';
  const tree = buildArtifactTree(project);
  const config = JSON.parse(findArtifact(tree, 'project-config').content);
  const manifest = JSON.parse(findArtifact(tree, 'planning-manifest').content);
  assert.equal(config.name, 'Seoul Pilot');
  assert.equal(config.map.city, 'Seoul');
  assert.equal(manifest.project, 'Seoul Pilot');
  assert.equal(manifest.runtime.status, 'not-connected');
  assert.equal(manifest.readiness.readyForRayTracing, false);
});

test('test-results and empty logs explicitly show that no project run evidence exists', () => {
  const tree = buildArtifactTree(defaultProject());
  const results = findArtifact(tree, 'test-results-readme');
  const logs = findArtifact(tree, 'logs-readme');
  assert.match(results.content, /No project test results have been recorded/);
  assert.match(results.content, /local Sionna-RT path job can add/);
  assert.match(logs.content, /No project activity has been recorded/);
  assert.doesNotMatch(listArtifactFiles(tree).map(file => file.name).join(' '), /result-\d+\.json/);
});

test('local ray output appears as a scoped result artifact with provenance', () => {
  const project = defaultProject();
  project.rayResults = parseRayPaths({schemaVersion:1,kind:'ray-paths',coordinateSystem:'EPSG:4326',
    solver:'Sionna-RT test',paths:[{id:'path-1',pathLossDb:75,points:[
      {latitude:37.5665,longitude:126.978,heightM:20},
      {latitude:37.5666,longitude:126.9781,heightM:1.5},
    ]}]}, {provenance:'sionna-rt-local'});
  const tree = buildArtifactTree(project);
  const result = JSON.parse(findArtifact(tree, 'ray-paths').content);
  assert.equal(result.paths.length, 1);
  assert.equal(result.provenance, 'sionna-rt-local');
  assert.match(findArtifact(tree, 'test-results-readme').content, /uncalibrated/);
});

test('activity log is project scoped and emitted as JSON Lines in chronological order', () => {
  const activity = [
    { when: '2026-09-29T02:00:00.000Z', title: 'Project opened', detail: 'Local planning only' },
    { when: '2026-09-29T02:05:00.000Z', title: 'Site edited', detail: 'SITE-01' },
  ];
  const tree = buildArtifactTree(defaultProject(), activity);
  const log = findArtifact(tree, 'activity-log');
  const entries = log.content.split('\n').map(line => JSON.parse(line));
  assert.deepEqual(entries.map(entry => entry.event), ['Project opened', 'Site edited']);
  assert.equal(entries[1].detail, 'SITE-01');
  assert.equal(findArtifact(tree, 'logs-readme'), null);
});

test('artifact listing preserves full hierarchical paths for files and nested directories', () => {
  const paths = walk(buildArtifactTree(defaultProject())).map(item => item.path);
  assert.ok(paths.includes('RAN Twin · City Pilot/configuration/project.json'));
  assert.ok(paths.includes('RAN Twin · City Pilot/test-results/README.md'));
  assert.ok(paths.includes('RAN Twin · City Pilot/reports/planning-manifest.json'));
});

test('database artifact index contains each project file with a scoped path and content', () => {
  const state=createWorkspaceState(defaultProject(),{id:'pilot',now:'2026-09-30T00:00:00Z'});
  const index=workspaceArtifactIndex(state);
  assert.equal(Object.keys(index).length,1);
  assert.equal(index.pilot.find(file=>file.id==='project-config').path,'RAN Twin · City Pilot/configuration/project.json');
  assert.equal(JSON.parse(index.pilot.find(file=>file.id==='project-config').content).name,'RAN Twin · City Pilot');
  const restored=artifactTreeFromRecords('RAN Twin · City Pilot',index.pilot);
  assert.equal(findArtifact(restored,'project-config').content,index.pilot.find(file=>file.id==='project-config').content);
});

test('editable JSON files update the active project and regenerate its artifacts', () => {
  const first = defaultProject(); first.name = 'First';
  const second = defaultProject(); second.name = 'Second';
  let state = createWorkspaceState(first, { id: 'first', now: '2026-09-30T00:00:00Z' });
  state = addWorkspaceProject(state, second, { id: 'second', now: '2026-09-30T00:00:00Z' });
  const useCases = structuredClone(workspaceProject(state).useCases);
  useCases.drive.samples = 64;
  const updated = applyArtifactJson(workspaceProject(state), 'use-case-config', JSON.stringify(useCases));
  state = updateWorkspaceProject(state, 'second', project => Object.assign(project, updated));
  assert.equal(workspaceProject(state, 'first').useCases.drive.samples, 48);
  assert.equal(workspaceProject(state, 'second').useCases.drive.samples, 64);
  assert.equal(JSON.parse(findArtifact(buildArtifactTree(workspaceProject(state)), 'use-case-config').content).drive.samples, 64);
  assert.equal(JSON.parse(findArtifact(buildArtifactTree(workspaceProject(state)), 'planning-manifest').content).useCaseConfig.drive.samples, 64);
  assert.equal(workspaceProject(JSON.parse(JSON.stringify(state)), 'second').useCases.drive.samples, 64);
});

test('project JSON updates configuration, keeps its name and resets unverified claims', () => {
  const project = defaultProject();
  const edit = structuredClone(project);
  edit.map.city = 'Busan'; edit.ue.count = 2000; edit.runtime.status = 'verified';
  const saved = applyArtifactJson(project, 'project-config', JSON.stringify(edit));
  assert.equal(saved.map.city, 'Busan');
  assert.equal(saved.ue.count, 2000);
  assert.equal(saved.runtime.status, 'not-connected');
  edit.name = 'Different';
  assert.throws(() => applyArtifactJson(project, 'project-config', JSON.stringify(edit)), /Rename the project/);
});

test('JSON editing rejects invalid input without changing the project', () => {
  const project = defaultProject();
  assert.throws(() => applyArtifactJson(project, 'use-case-config', '{'), /Invalid JSON/);
  assert.throws(() => applyArtifactJson(project, 'use-case-config', '[]'), /contain an object/);
  assert.throws(() => applyArtifactJson(project, 'use-case-config', JSON.stringify({ drive: {} })), /configuration missing/);
  assert.throws(() => applyArtifactJson(project, 'project-config', JSON.stringify({ name: project.name })), /missing required project fields/);
  assert.equal(project.useCases.drive.samples, 48);
});

test('Twin Management JSON accepts valid targets and rejects invented discovery', () => {
  const project = defaultProject();
  const management = structuredClone(project.management);
  management.monitoring.thresholds.gpuUtilizationPct = 80;
  const saved = applyArtifactJson(project, 'management-config', JSON.stringify(management));
  assert.equal(saved.management.monitoring.thresholds.gpuUtilizationPct, 80);
  assert.equal(project.management.monitoring.thresholds.gpuUtilizationPct, 85);
  management.hardware[0].discovery = 'discovered';
  assert.throws(() => applyArtifactJson(project, 'management-config', JSON.stringify(management)), /cannot claim discovery/);
});

test('edited ray paths lose local solver provenance and generated reports stay read-only', () => {
  const project = defaultProject();
  project.rayResults = parseRayPaths({ schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326',
    paths: [{ id: 'ray-1', pathLossDb: 72, points: [
      { latitude: 37.5, longitude: 127, heightM: 20 },
      { latitude: 37.5001, longitude: 127.0001, heightM: 2 },
    ] }] }, { provenance: 'sionna-rt-local' });
  const input = JSON.parse(findArtifact(buildArtifactTree(project), 'ray-paths').content);
  input.paths[0].pathLossDb = 80;
  const saved = applyArtifactJson(project, 'ray-paths', JSON.stringify(input));
  assert.equal(saved.rayResults.paths[0].pathLossDb, 80);
  assert.equal(saved.rayResults.provenance, 'imported-unverified');
  assert.equal(isEditableJsonArtifact('planning-manifest'), false);
  assert.throws(() => applyArtifactJson(project, 'planning-manifest', '{}'), /generated/);
});
