import type { PreviewRouteId } from './routeRegistry';

export type WorkspacePreset = 'all' | 'rf' | 'operations' | 'platform';
type WorkflowSection = { id: string; label: string; routes: PreviewRouteId[]; utility?: boolean };

// Route IDs remain stable for bookmarks and existing command owners.
export const workflowSections: WorkflowSection[] = [
  { id: 'overview', label: 'Overview', routes: ['overview'] },
  { id: 'setup', label: 'Data and Twin Setup', routes: ['study', 'measurements', 'stack'] },
  { id: 'design', label: 'Network Design', routes: ['map', 'planner', 'radio', 'scenarios'] },
  { id: 'simulation', label: 'Simulation and Experiments', routes: ['ray', 'runs', 'ues', 'ab', 'data'] },
  { id: 'validation', label: 'Validation and Optimization', routes: ['drive'] },
  { id: 'operations', label: 'Operations and Reports', routes: ['monitoring', 'artifacts', 'tasks', 'schedule', 'activity'] },
  { id: 'platform', label: 'Platform settings', routes: ['hardware', 'software'], utility: true },
];

const presets: Record<WorkspacePreset, string[]> = {
  all: workflowSections.map(section => section.id),
  rf: ['overview', 'setup', 'design', 'simulation', 'validation', 'operations'],
  operations: ['overview', 'setup', 'operations'],
  platform: ['overview', 'platform', 'operations'],
};

export function sectionForRoute(route: PreviewRouteId) {
  return workflowSections.find(section => section.routes.includes(route));
}

export function visibleSections(preset: WorkspacePreset, route: PreviewRouteId) {
  return workflowSections.filter(section => presets[preset].includes(section.id) || section.routes.includes(route));
}
