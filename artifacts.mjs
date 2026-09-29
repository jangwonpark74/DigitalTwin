import { createManifest } from './model.mjs';

const jsonFile = (id, name, value, description) => ({
  id, name, type: 'file', mimeType: 'application/json', description,
  content: JSON.stringify(value, null, 2),
});
const textFile = (id, name, content, description, mimeType = 'text/markdown') => ({ id, name, type: 'file', mimeType, description, content });
const folder = (id, name, children, description) => ({ id, name, type: 'directory', children, description });

export function buildArtifactTree(project, activity = []) {
  const projectInfo = {
    schemaVersion: 1,
    name: project.name,
    city: project.map.city,
    cluster: project.map.cluster,
    lifecycle: 'planning-only',
    sites: project.sites.length,
    cells: project.sites.reduce((total, site) => total + site.cells.length, 0),
    lastKnownBoundary: 'No network, GPU, ray-tracing, or test execution is connected.',
  };
  const logContent = activity.slice().sort((a, b) => Date.parse(a.when) - Date.parse(b.when)).map(entry => JSON.stringify({
    timestamp: entry.when,
    event: entry.title,
    detail: entry.detail,
  })).join('\n');

  return folder('artifact-root', project.name, [
    textFile('project-readme', 'README.md', `# ${project.name}\n\nTwin Workspace planning project for **${project.map.city} · ${project.map.cluster}**.\n\nThis local project contains configuration and planning artifacts only. No RAN, GPU, ray-tracing, or hardware test has been executed.`, 'Project scope and execution boundary.'),
    folder('configuration', 'configuration', [
      jsonFile('project-config', 'project.json', project, 'Complete sanitized project planning configuration.'),
      jsonFile('use-case-config', 'use-cases.json', project.useCases, 'Drive test, package comparison, and AI-RAN dataset planning inputs.'),
      jsonFile('management-config', 'twin-management.json', project.management, 'Hardware, software, topology, and monitoring targets.'),
    ], 'Versionable project and Twin Management configuration.'),
    folder('test-results', 'test-results', [
      textFile('test-results-readme', 'README.md', '# Test results\n\nNo project test results have been recorded. This preparation mockup does not execute Sionna-RT, RAN jobs, hardware probes, or UE workloads. Results will appear here only when a future execution service supplies evidence.', 'Explicit empty state; no test outcome is implied.'),
    ], 'Execution and test evidence; empty until a project run produces results.'),
    folder('logs', 'logs', activity.length ? [
      textFile('activity-log', 'activity.jsonl', logContent, 'Chronological browser-local project activity. Newest activity is at the bottom.', 'application/x-ndjson'),
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
