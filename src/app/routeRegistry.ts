// The production React shell and the development preview share this route registry.
export const previewRoutes = {
  overview: { label: 'Mission control' },
  projects: { label: 'Projects' },
  activity: { label: 'Activity' },
  artifacts: { label: 'Project artifacts' },
  stack: { label: 'RAN topology' },
  ues: { label: 'Virtual UE fleet' },
  map: { label: 'City map' },
  planner: { label: 'Site & cell planner' },
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
} as const;

export type PreviewRouteId = keyof typeof previewRoutes;

export function isPreviewRoute(value: string): value is PreviewRouteId {
  return Object.prototype.hasOwnProperty.call(previewRoutes, value);
}
