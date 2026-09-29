import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { buildArtifactTree, findArtifact, listArtifactFiles } from './artifacts.mjs';

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
  assert.match(results.content, /does not execute Sionna-RT/);
  assert.match(logs.content, /No project activity has been recorded/);
  assert.doesNotMatch(listArtifactFiles(tree).map(file => file.name).join(' '), /result-\d+\.json/);
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
