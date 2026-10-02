// The production React shell and the development preview share this route registry.
export const previewRoutes = {
  overview: { label: 'Mission control' },
  projects: { label: 'Projects' },
  activity: { label: 'Activity' },
  artifacts: { label: 'Project artifacts' },
  stack: { label: 'RAN topology' },
  ues: { label: 'Virtual UE fleet' },
  map: { label: 'City map' },
  planner: { label: 'Sites and Cells' },
  radio: { label: 'Radio planner' },
  ray: { label: 'Ray tracing lab' },
  drive: { label: 'Virtual drive test' },
  ab: { label: 'Package A/B test' },
  data: { label: 'AI-RAN data generation' },
  hardware: { label: 'Hardware inventory' },
  software: { label: 'Software management' },
  monitoring: { label: 'Monitoring' },
  schedule: { label: 'Schedule' },
  tasks: { label: 'Task board' },
  study: { label: 'Study definition' },
  scenarios: { label: 'Baselines & candidates' },
  runs: { label: 'Jobs & runs' },
  measurements: { label: 'Measurement datasets' },
} as const;

export type PreviewRouteId = keyof typeof previewRoutes;

export function isPreviewRoute(value: string): value is PreviewRouteId {
  return Object.prototype.hasOwnProperty.call(previewRoutes, value);
}

const workflowAliases: Record<string, PreviewRouteId> = {
  'study-overview': 'overview', 'spatial-workbench': 'map', 'sites-and-cells': 'planner',
  propagation: 'ray', 'drive-analysis': 'drive', 'network-topology': 'stack',
  'runtime-resources': 'hardware', 'software-packages': 'software',
  'reports-and-artifacts': 'artifacts', 'work-plan': 'tasks',
  'study-setup': 'study', 'baseline-candidates': 'scenarios',
  'jobs-and-runs': 'runs',
  'measurement-datasets': 'measurements',
};

export function routeFromSearch(search: string): PreviewRouteId | null {
  const value = new URLSearchParams(search).get('workspace');
  if (!value) return null;
  return isPreviewRoute(value) ? value : Object.prototype.hasOwnProperty.call(workflowAliases, value) ? workflowAliases[value] : null;
}
