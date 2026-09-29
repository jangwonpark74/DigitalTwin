import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import {
  createWorkspaceState, restoreWorkspaceState, workspaceProject,
  addWorkspaceProject, renameWorkspaceProject, duplicateWorkspaceProject,
  activateWorkspaceProject, archiveWorkspaceProject, restoreArchivedWorkspaceProject,
  deleteArchivedWorkspaceProject, updateWorkspaceProject, validateWorkspaceState,
  appendWorkspaceLog,
} from './workspaces.mjs';

const clock = () => '2026-09-29T00:00:00.000Z';
const ids = (...values) => { let index = 0; return () => values[index++]; };

function project(name) {
  const value = defaultProject();
  value.name = name;
  return value;
}

test('workspace registry seeds a project and validates every project boundary', () => {
  const state = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  assert.equal(state.schemaVersion, 1);
  assert.equal(state.activeProjectId, 'p-1');
  assert.equal(state.projects[0].name, 'Seoul Pilot');
  assert.equal(state.projects[0].status, 'active');
  assert.deepEqual(validateWorkspaceState(state), []);
});

test('legacy single-project state migrates without losing planning edits and strips readiness claims', () => {
  const legacy = project('Busan Pilot');
  legacy.map.city = 'Busan';
  legacy.sites[0].name = 'Harbor site';
  legacy.runtime.status = 'verified';
  const state = restoreWorkspaceState(null, legacy, { createId: ids('migrated-1'), now: clock });
  assert.equal(state.projects.length, 1);
  assert.equal(workspaceProject(state).name, 'Busan Pilot');
  assert.equal(workspaceProject(state).map.city, 'Busan');
  assert.equal(workspaceProject(state).sites[0].name, 'Harbor site');
  assert.equal(workspaceProject(state).runtime.status, 'not-connected');
});

test('adding and switching projects keeps their configurations isolated', () => {
  const first = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  const secondProject = project('Busan Pilot');
  secondProject.map.city = 'Busan';
  const withSecond = addWorkspaceProject(first, secondProject, { id: 'p-2', now: clock() });
  assert.equal(withSecond.activeProjectId, 'p-2');
  assert.equal(workspaceProject(withSecond).map.city, 'Busan');
  const changed = updateWorkspaceProject(withSecond, 'p-2', p => { p.ue.count = 2500; }, { now: clock() });
  const back = activateWorkspaceProject(changed, 'p-1');
  assert.equal(workspaceProject(back).ue.count, 1200);
  const forward = activateWorkspaceProject(back, 'p-2');
  assert.equal(workspaceProject(forward).ue.count, 2500);
  assert.equal(workspaceProject(forward).map.city, 'Busan');
});

test('project names are bounded, trimmed, and unique across active and archived records', () => {
  const state = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  assert.throws(() => addWorkspaceProject(state, project('seoul pilot'), { id: 'p-2', now: clock() }), /already exists/i);
  assert.throws(() => renameWorkspaceProject(state, 'p-1', '   ', { now: clock() }), /name/i);
  assert.throws(() => renameWorkspaceProject(state, 'p-1', 'x'.repeat(81), { now: clock() }), /80/);
  const renamed = renameWorkspaceProject(state, 'p-1', '  Seoul Core  ', { now: clock() });
  assert.equal(renamed.projects[0].name, 'Seoul Core');
  assert.equal(workspaceProject(renamed).name, 'Seoul Core');
});

test('duplicate creates an independent active project with a unique copy name', () => {
  const state = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  const copied = duplicateWorkspaceProject(state, 'p-1', { newId: 'p-2', now: clock() });
  assert.equal(copied.activeProjectId, 'p-2');
  assert.equal(workspaceProject(copied).name, 'Seoul Pilot (copy)');
  const changed = updateWorkspaceProject(copied, 'p-2', p => { p.sites[0].name = 'Copied site'; }, { now: clock() });
  assert.equal(workspaceProject(activateWorkspaceProject(changed, 'p-1')).sites[0].name, 'Civic Square');
});

test('archiving current project switches safely, restore retains it, and permanent delete is archive-only', () => {
  const first = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  const second = addWorkspaceProject(first, project('Busan Pilot'), { id: 'p-2', now: clock() });
  const archived = archiveWorkspaceProject(second, 'p-2', { now: clock() });
  assert.equal(archived.projects.find(x => x.id === 'p-2').status, 'archived');
  assert.equal(archived.activeProjectId, 'p-1');
  assert.throws(() => deleteArchivedWorkspaceProject(archived, 'p-1'), /archived/i);
  const restored = restoreArchivedWorkspaceProject(archived, 'p-2', { now: clock() });
  assert.equal(restored.projects.find(x => x.id === 'p-2').status, 'active');
  const rearchived = archiveWorkspaceProject(restored, 'p-2', { now: clock() });
  const deleted = deleteArchivedWorkspaceProject(rearchived, 'p-2');
  assert.deepEqual(deleted.projects.map(x => x.id), ['p-1']);
});

test('cannot archive the last active project or delete the last remaining project', () => {
  const state = createWorkspaceState(project('Only project'), { id: 'p-1', now: clock() });
  assert.throws(() => archiveWorkspaceProject(state, 'p-1', { now: clock() }), /last active/i);
  const archivedState = { ...state, projects: [{ ...state.projects[0], status: 'archived' }] };
  assert.throws(() => deleteArchivedWorkspaceProject(archivedState, 'p-1'), /last project/i);
});

test('restore keeps valid registry entries and falls back to the legacy project when needed', () => {
  const seed = createWorkspaceState(project('Seed'), { id: 'p-1', now: clock() });
  const restored = restoreWorkspaceState(seed, project('Legacy'), { now: clock });
  assert.equal(restored.projects[0].name, 'Seed');
  const fallback = restoreWorkspaceState({ schemaVersion: 99, projects: [] }, project('Legacy'), { createId: ids('fallback'), now: clock });
  assert.equal(fallback.projects[0].name, 'Legacy');
  assert.deepEqual(validateWorkspaceState(fallback), []);
});

test('project activity is persisted, bounded, and isolated to the selected project record', () => {
  const first = createWorkspaceState(project('Seoul Pilot'), { id: 'p-1', now: clock() });
  const second = addWorkspaceProject(first, project('Busan Pilot'), { id: 'p-2', now: clock() });
  const logged = appendWorkspaceLog(second, 'p-2', { title: 'Site updated', detail: 'SITE-01 coordinates' }, { now: clock() });
  assert.equal(logged.projects.find(record => record.id === 'p-1').activity.length, 0);
  assert.deepEqual(logged.projects.find(record => record.id === 'p-2').activity[0], {
    when: clock(), title: 'Site updated', detail: 'SITE-01 coordinates',
  });
  assert.throws(() => appendWorkspaceLog(logged, 'p-2', { title: '', detail: 'invalid' }, { now: clock() }), /title/i);
  const restored = restoreWorkspaceState(logged, null, { now: clock });
  assert.deepEqual(restored.projects.find(record => record.id === 'p-2').activity, logged.projects.find(record => record.id === 'p-2').activity);
});
