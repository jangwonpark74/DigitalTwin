import { createManifest, sanitizeProject, validateProject } from './model.mjs';
import { parseRayPaths } from './scene.mjs';

const editableJsonIds = new Set(['project-config', 'use-case-config', 'management-config', 'ray-paths']);
export const isEditableJsonArtifact = id => editableJsonIds.has(id);

export function applyArtifactJson(project, id, source) {
  if (!isEditableJsonArtifact(id)) throw new Error('This report is generated from the project and cannot be edited here.');
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 3_000_000) {
    throw new Error('JSON file must be smaller than 3 MB.');
  }
  let value;
  try { value = JSON.parse(source); }
  catch (error) { throw new Error(`Invalid JSON: ${error.message}`); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('JSON file must contain an object.');
  }
  let next = structuredClone(project);
  if (id === 'project-config') {
    if (value.name !== project.name) throw new Error('Rename the project from Manage projects before editing project.json.');
    if (Object.keys(project).some(key => !Object.hasOwn(value, key)) ||
        !value.integration || typeof value.integration !== 'object' ||
        typeof value.integration.vCoreEndpoint !== 'string' || typeof value.integration.vDUEndpoint !== 'string' ||
        !['baseline', 'blockage', 'ue-surge', 'clear-line', 'custom'].includes(value.scenario)) {
      throw new Error('project.json is missing required project fields.');
    }
    const errors = validateProject(value);
    if (errors.length) throw new Error(errors[0]);
    next = sanitizeProject(value);
  } else if (id === 'use-case-config') next.useCases = value;
  else if (id === 'management-config') next.management = value;
  else next.rayResults = parseRayPaths(value, { fileName: 'ray-paths.json' });
  const errors = validateProject(next);
  if (errors.length) throw new Error(errors[0]);
  return next;
}

const jsonFile = (id, name, value, description) => ({
  id, name, type: 'file', mimeType: 'application/json', description,
  content: JSON.stringify(value, null, 2),
});
const textFile = (id, name, content, description, mimeType = 'text/markdown') => ({ id, name, type: 'file', mimeType, description, content });
const folder = (id, name, children, description) => ({ id, name, type: 'directory', children, description });

export function buildArtifactTree(project, activity = []) {
  const rays = project.rayResults;
  const rayBoundary = rays?.provenance === 'sionna-rt-local'
    ? 'A local Sionna-RT path job completed; geometry and materials are uncalibrated.'
    : rays ? 'A ray-path file is present, but its source is unverified.'
      : 'No ray-path result has been recorded.';
  const logContent = activity.slice().sort((a, b) => Date.parse(a.when) - Date.parse(b.when)).map(entry => JSON.stringify({
    timestamp: entry.when,
    event: entry.title,
    detail: entry.detail,
  })).join('\n');

  return folder('artifact-root', project.name, [
    textFile('project-readme', 'README.md', `# ${project.name}\n\nTwin Workspace planning project for **${project.map.city} · ${project.map.cluster}**.\n\nThis local project contains configuration and planning artifacts. ${rayBoundary} No RAN, UE, or hardware test has been executed.`, 'Project scope and execution boundary.'),
    folder('configuration', 'configuration', [
      jsonFile('project-config', 'project.json', project, 'Complete sanitized project planning configuration.'),
      jsonFile('use-case-config', 'use-cases.json', project.useCases, 'Drive test, package comparison, and AI-RAN dataset planning inputs.'),
      jsonFile('management-config', 'twin-management.json', project.management, 'Hardware, software, topology, and monitoring targets.'),
    ], 'Versionable project and Twin Management configuration.'),
    folder('test-results', 'test-results', rays ? [
      jsonFile('ray-paths', 'ray-paths.json', rays, 'Single-link ray-path result with solver, job settings, and provenance.'),
      textFile('test-results-readme', 'README.md', `# Test results\n\n${rayBoundary} This path result is not a calibrated RAN KPI, UE result, or hardware test.`, 'Result scope and calibration boundary.'),
    ] : [
      textFile('test-results-readme', 'README.md', '# Test results\n\nNo project test results have been recorded. A local Sionna-RT path job can add a bounded single-link result here. RAN jobs, hardware probes, and UE workloads are not executed by this mockup.', 'Explicit empty state; no test outcome is implied.'),
    ], 'Execution and test evidence; a local ray job can add an uncalibrated path result.'),
    folder('logs', 'logs', activity.length ? [
      textFile('activity-log', 'activity.jsonl', logContent, 'Chronological project activity stored in SQLite. Newest activity is at the bottom.', 'application/x-ndjson'),
    ] : [
      textFile('logs-readme', 'README.md', '# Activity logs\n\nNo project activity has been recorded yet.', 'Explicit empty state for project activity logs.'),
    ], 'Project-scoped activity and audit records.'),
    folder('reports', 'reports', [
      textFile('planning-manifest', 'planning-manifest.json', createManifest(project), 'Exportable planning manifest. Readiness, discovery, telemetry, and execution claims are sanitized.', 'application/json'),
    ], 'Planning summaries and handoff artifacts.'),
  ], 'Locally generated, project-scoped artifact tree.');
}

export function findArtifact(tree, id) {
  if (!tree || typeof id !== 'string') return null;
  if (tree.id === id) return tree;
  for (const child of tree.children || []) {
    const found = findArtifact(child, id);
    if (found) return found;
  }
  return null;
}

export function listArtifactFiles(tree) {
  if (!tree) return [];
  if (tree.type === 'file') return [tree];
  return (tree.children || []).flatMap(listArtifactFiles);
}

export function workspaceArtifactIndex(state) {
  return Object.fromEntries(state.projects.map(record => {
    const tree = buildArtifactTree(record.project, record.activity || []);
    const files = [];
    const visit = (node, parents = []) => {
      const path = [...parents, node.name];
      if (node.type === 'file') files.push({
        id: node.id, path: path.join('/'), name: node.name,
        mimeType: node.mimeType, description: node.description, content: node.content,
      });
      else for (const child of node.children) visit(child, path);
    };
    visit(tree);
    return [record.id, files];
  }));
}

export function artifactTreeFromRecords(projectName, records) {
  if (!Array.isArray(records)) throw new Error('Database artifact list is invalid');
  const root = folder('artifact-root', projectName, [], 'Saved project artifacts');
  const sections = ['README.md', 'configuration', 'test-results', 'logs', 'reports'];
  const sorted = records.slice().sort((a, b) => {
    const section = record => record?.path?.slice(projectName.length + 1).split('/')[0];
    return sections.indexOf(section(a)) - sections.indexOf(section(b)) || String(a?.path).localeCompare(String(b?.path));
  });
  for (const record of sorted) {
    if (typeof record?.path !== 'string' || typeof record?.content !== 'string' ||
        typeof record?.id !== 'string' || typeof record?.name !== 'string') {
      throw new Error('Database artifact record is incomplete');
    }
    const prefix = `${projectName}/`;
    if (!record.path.startsWith(prefix)) throw new Error('Artifact belongs to a different project');
    const segments = record.path.slice(prefix.length).split('/');
    if (segments.at(-1) !== record.name || segments.some(segment => !segment || segment === '.' || segment === '..')) {
      throw new Error('Invalid database artifact path');
    }
    let parent = root;
    for (const name of segments.slice(0, -1)) {
      let child = parent.children.find(item => item.type === 'directory' && item.name === name);
      if (!child) {
        child = folder(`${parent.id}/${name}`, name, [], 'Saved project folder');
        parent.children.push(child);
      }
      parent = child;
    }
    parent.children.push({ id: record.id, name: record.name, type: 'file',
      mimeType: record.mimeType, description: record.description, content: record.content });
  }
  return root;
}
