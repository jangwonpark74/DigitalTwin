import { defaultProject, upgradeProject, validateProject, sanitizeProject } from './model.mjs';
import { assertStudyTransition } from './study.mjs';
import { assertMeasurementTransition } from './measurement-library.mjs';
import { assertInventoryTransition } from './inventory-import.mjs';

const clone = value => structuredClone(value);
const clock = () => new Date().toISOString();
const generatedId = () => globalThis.crypto?.randomUUID?.() || `project-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const timestamp = now => typeof now === 'function' ? now() : now;
const normalizeName = value => typeof value === 'string' ? value.trim() : '';

function safeProject(value) {
  const project = sanitizeProject(upgradeProject(value));
  const errors = validateProject(project);
  if (errors.length) throw new Error(errors[0]);
  return project;
}

function assertValid(state) {
  const errors = validateWorkspaceState(state);
  if (errors.length) throw new Error(errors[0]);
}

function requireRecord(state, id) {
  const record = state.projects.find(item => item.id === id);
  if (!record) throw new Error('Project not found');
  return record;
}

function nameTaken(state, name, exceptId = null) {
  const normalized = name.toLocaleLowerCase();
  return state.projects.some(record => record.id !== exceptId && record.name.toLocaleLowerCase() === normalized);
}

function uniqueName(state, requested) {
  if (!nameTaken(state, requested)) return requested;
  for (let suffix = 2; suffix < 10000; suffix += 1) {
    const candidate = `${requested} (${suffix})`;
    if (candidate.length <= 80 && !nameTaken(state, candidate)) return candidate;
  }
  throw new Error('Could not create a unique project name');
}

function normalizedRecord(record, now) {
  const name = normalizeName(record.name || record.project?.name);
  if (!name || name.length > 80 || typeof record.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id)) return null;
  if (!['active', 'archived'].includes(record.status)) return null;
  try {
    const project = safeProject({ ...record.project, name });
    const activity = Array.isArray(record.activity) ? record.activity.slice(0, 200).filter(entry => entry && typeof entry.title === 'string' && typeof entry.detail === 'string')
      .map(entry => ({ when: typeof entry.when === 'string' && Number.isFinite(Date.parse(entry.when)) ? entry.when : now,
        title: entry.title.slice(0, 120), detail: entry.detail.slice(0, 500) })) : [];
    return { id: record.id, name, status: record.status, activity,
      createdAt: typeof record.createdAt === 'string' ? record.createdAt : now,
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : now,
      project };
  } catch {
    return null;
  }
}

export function createWorkspaceState(project = defaultProject(), { id = generatedId(), now = clock } = {}) {
  const safe = safeProject(project);
  const name = normalizeName(safe.name);
  if (!name || name.length > 80) throw new Error('Project name must contain 1–80 characters');
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id)) throw new Error('Invalid project ID');
  const createdAt = timestamp(now);
  const state = { schemaVersion: 1, activeProjectId: id,
    projects: [{ id, name, status: 'active', activity: [], createdAt, updatedAt: createdAt, project: { ...safe, name } }] };
  assertValid(state);
  return state;
}

export function restoreWorkspaceState(registry, legacyProject, { createId = generatedId, now = clock } = {}) {
  const currentTime = timestamp(now);
  if (registry?.schemaVersion === 1 && Array.isArray(registry.projects)) {
    const projects = registry.projects.slice(0, 100).map(record => normalizedRecord(record, currentTime)).filter(Boolean);
    const ids = new Set();
    const names = new Set();
    const unique = projects.filter(record => {
      const name = record.name.toLocaleLowerCase();
      if (ids.has(record.id) || names.has(name)) return false;
      ids.add(record.id); names.add(name);
      return true;
    });
    if (unique.length) {
      if (!unique.some(record => record.status === 'active')) unique[0].status = 'active';
      const activeProjectId = unique.some(record => record.id === registry.activeProjectId && record.status === 'active')
        ? registry.activeProjectId : unique.find(record => record.status === 'active').id;
      const state = { schemaVersion: 1, activeProjectId, projects: unique };
      if (!validateWorkspaceState(state).length) return state;
    }
  }

  if (legacyProject && typeof legacyProject === 'object') {
    try {
      return createWorkspaceState(legacyProject, { id: createId(), now: currentTime });
    } catch {
      // Fall through to a clean starter project if the legacy browser record is invalid.
    }
  }
  return createWorkspaceState(defaultProject(), { id: createId(), now: currentTime });
}

export function workspaceProject(state, id = state.activeProjectId) {
  return requireRecord(state, id).project;
}

export function validateWorkspaceState(state) {
  const errors = [];
  if (state?.schemaVersion !== 1) errors.push('Unsupported workspace registry version');
  if (!Array.isArray(state?.projects) || state.projects.length < 1 || state.projects.length > 100) errors.push('Workspace must contain 1–100 projects');
  const records = Array.isArray(state?.projects) ? state.projects : [];
  const ids = new Set(), names = new Set();
  for (const record of records) {
    if (typeof record?.id !== 'string' || !/^[\w-]{1,80}$/.test(record.id) || ids.has(record.id)) errors.push('Project IDs must be unique and valid');
    ids.add(record?.id);
    const name = normalizeName(record?.name);
    if (!name || name.length > 80 || names.has(name.toLocaleLowerCase())) errors.push('Project names must be unique and contain 1–80 characters');
    names.add(name.toLocaleLowerCase());
    if (!['active', 'archived'].includes(record?.status)) errors.push(`Invalid lifecycle status for ${name || 'project'}`);
    if (!record?.project || record.project.name !== name) errors.push(`Project configuration name does not match ${name || 'project'}`);
    else errors.push(...validateProject(record.project).map(error => `${name}: ${error}`));
  }
  const active = records.filter(record => record?.status === 'active');
  if (!active.length) errors.push('At least one active project is required');
  if (!active.some(record => record.id === state?.activeProjectId)) errors.push('The selected project must be active');
  return [...new Set(errors)];
}

export function addWorkspaceProject(state, project, { id = generatedId(), now = clock, name, activate = true, uniqueName: makeUnique = false } = {}) {
  assertValid(state);
  const next = clone(state);
  if (typeof id !== 'string' || !/^[\w-]{1,80}$/.test(id) || next.projects.some(record => record.id === id)) throw new Error('Project ID must be unique and valid');
  const safe = safeProject(project);
  let projectName = normalizeName(name ?? safe.name);
  if (!projectName || projectName.length > 80) throw new Error('Project name must contain 1–80 characters');
  if (nameTaken(next, projectName)) {
    if (!makeUnique) throw new Error(`A project named “${projectName}” already exists`);
    projectName = uniqueName(next, projectName);
  }
  const createdAt = timestamp(now);
  next.projects.push({ id, name: projectName, status: 'active', activity: [], createdAt, updatedAt: createdAt,
    project: { ...safe, name: projectName } });
  if (activate) next.activeProjectId = id;
  assertValid(next);
  return next;
}

export function renameWorkspaceProject(state, id, requestedName, { now = clock } = {}) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  const name = normalizeName(requestedName);
  if (!name || name.length > 80) throw new Error('Project name must contain 1–80 characters');
  if (nameTaken(next, name, id)) throw new Error(`A project named “${name}” already exists`);
  record.name = name;
  record.project.name = name;
  record.updatedAt = timestamp(now);
  assertValid(next);
  return next;
}

export function duplicateWorkspaceProject(state, id, { newId = generatedId(), now = clock } = {}) {
  const source = requireRecord(state, id);
  return addWorkspaceProject(state, source.project, { id: newId, now, name: `${source.name} (copy)`, activate: true, uniqueName: true });
}

export function activateWorkspaceProject(state, id) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  if (record.status !== 'active') throw new Error('Archived projects must be restored before opening');
  next.activeProjectId = id;
  assertValid(next);
  return next;
}

export function archiveWorkspaceProject(state, id, { now = clock } = {}) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  if (record.status === 'archived') return next;
  if (next.projects.filter(item => item.status === 'active').length <= 1) throw new Error('Cannot archive the last active project');
  record.status = 'archived';
  record.updatedAt = timestamp(now);
  if (next.activeProjectId === id) next.activeProjectId = next.projects.find(item => item.status === 'active').id;
  assertValid(next);
  return next;
}

export function restoreArchivedWorkspaceProject(state, id, { now = clock } = {}) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  if (record.status === 'active') return next;
  record.status = 'active';
  record.updatedAt = timestamp(now);
  assertValid(next);
  return next;
}

export function deleteArchivedWorkspaceProject(state, id) {
  if (Array.isArray(state?.projects) && state.projects.length <= 1) throw new Error('Cannot delete the last project');
  assertValid(state);
  const record = requireRecord(state, id);
  if (record.status !== 'archived') throw new Error('Only archived projects can be deleted');
  const next = clone(state);
  next.projects = next.projects.filter(item => item.id !== id);
  assertValid(next);
  return next;
}

export function updateWorkspaceProject(state, id, mutator, { now = clock } = {}) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  if (record.status !== 'active') throw new Error('Archived projects cannot be edited');
  mutator(record.project);
  assertStudyTransition(requireRecord(state, id).project.study, record.project.study);
  assertMeasurementTransition(requireRecord(state, id).project.measurementLibrary, record.project.measurementLibrary);
  assertInventoryTransition(requireRecord(state, id).project, record.project);
  record.project.name = record.name;
  const errors = validateProject(record.project);
  if (errors.length) throw new Error(errors[0]);
  record.updatedAt = timestamp(now);
  assertValid(next);
  return next;
}

export function appendWorkspaceLog(state, id, event, { now = clock } = {}) {
  assertValid(state);
  const next = clone(state), record = requireRecord(next, id);
  if (typeof event?.title !== 'string' || !event.title.trim() || typeof event?.detail !== 'string') throw new Error('Project log entry requires a title and detail');
  const entryTime = timestamp(now);
  record.activity = [{ when: entryTime, title: event.title.trim().slice(0, 120), detail: event.detail.trim().slice(0, 500) }, ...(record.activity || [])].slice(0, 200);
  record.updatedAt = entryTime;
  assertValid(next);
  return next;
}
