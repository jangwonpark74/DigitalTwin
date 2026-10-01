import { readiness, simulatePreview, validateProject } from '../../../model.mjs';
import { schedulePlan } from '../../../tasks.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type Gate = { id: string; label: string; done: boolean };
type MissionControlModel =
  | { kind: 'loading' }
  | { kind: 'empty' }
  | { kind: 'invalid'; reason: string }
  | {
    kind: 'ready'; projectName: string; city: string; cluster: string;
    metrics: {
      sites: number; cells: number; virtualUes: number; coveragePercent: number;
      capacityPressure: number; method: string;
    };
    readiness: { checks: Gate[]; configured: number; total: number; readyForRayTracing: boolean };
    scenario: { projectId: string; preset: string; blockage: number; virtualUes: number; maxDepth: number };
    tasks: { count: number; next: { id: string; title: string; dueDate: string } | null };
    activity: ProjectRecord['activity'];
  };

/** Project-scoped presentation data only; existing planners own all derived semantics. */
export function buildMissionControlModel(
  record: ProjectRecord | null, { loading = false }: { loading?: boolean } = {},
): MissionControlModel {
  if (!record) return loading ? { kind: 'loading' } : { kind: 'empty' };
  const errors: string[] = validateProject(record.project);
  if (errors.length) return { kind: 'invalid', reason: errors[0] };

  const project = record.project as {
    map: { city: string; cluster: string };
    scenario: string;
    channel: { blockage: number; maxDepth: number };
    ue: { count: number };
    tasks: { id: string; title: string; dueDate: string }[];
  };
  const preview = simulatePreview(record.project);
  const gates = readiness(record.project);
  const checks: Gate[] = gates.checks.map((gate: Gate) => ({ ...gate }));
  const first = schedulePlan(project.tasks)[0] as typeof project.tasks[number] | undefined;
  return {
    kind: 'ready', projectName: record.name, city: project.map.city, cluster: project.map.cluster,
    metrics: {
      sites: preview.siteCount, cells: preview.cells, virtualUes: preview.estimatedUes,
      coveragePercent: preview.coveragePercent, capacityPressure: preview.capacityPressure,
      method: preview.method,
    },
    readiness: { checks, configured: checks.filter(gate => gate.done).length,
      total: checks.length, readyForRayTracing: gates.readyForRayTracing },
    scenario: { projectId: record.id, preset: project.scenario, blockage: project.channel.blockage,
      virtualUes: project.ue.count, maxDepth: project.channel.maxDepth },
    tasks: { count: project.tasks.length,
      next: first ? { id: first.id, title: first.title, dueDate: first.dueDate } : null },
    activity: record.activity.slice(0, 5).map(event => ({ ...event })),
  };
}
