import { describe, expect, it } from 'vitest';
import { applyScenario, readiness, simulatePreview } from '../../../model.mjs';
import { schedulePlan } from '../../../tasks.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { buildMissionControlModel } from './missionControlModel';

const workspace = () => workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));

describe('Mission Control domain-backed view model', () => {
  it('distinguishes loading and unavailable data from a ready project', () => {
    expect(buildMissionControlModel(null, { loading: true })).toEqual({ kind: 'loading' });
    expect(buildMissionControlModel(null)).toEqual({ kind: 'empty' });
    const invalid = structuredClone(workspace().projects[0]);
    (invalid.project.ue as { count: number }).count = 0;
    expect(buildMissionControlModel(invalid)).toMatchObject({ kind: 'invalid', reason: 'Invalid UE count' });
  });

  it('matches the legacy readiness, illustrative metrics and dependency-ordered next action without mutating state', () => {
    const record = workspace().projects[0];
    const before = structuredClone(record);
    const model = buildMissionControlModel(record);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    const project = record.project as Parameters<typeof simulatePreview>[0];
    const preview = simulatePreview(project);
    const gates = readiness(project);
    const first = schedulePlan(project.tasks)[0];
    expect(model.metrics).toEqual({
      sites: preview.siteCount, cells: preview.cells, virtualUes: preview.estimatedUes,
      coveragePercent: preview.coveragePercent, capacityPressure: preview.capacityPressure,
      method: 'ILLUSTRATIVE_ONLY_NOT_RAY_TRACING',
    });
    expect(model.readiness.checks).toEqual(gates.checks);
    expect(model.readiness).toMatchObject({ configured: gates.checks.filter(check => check.done).length,
      total: gates.checks.length, readyForRayTracing: false });
    expect(model.tasks).toEqual({ count: project.tasks.length,
      next: { id: first.id, title: first.title, dueDate: first.dueDate } });
    expect(model.scenario).toEqual({ projectId: record.id, preset: 'baseline', blockage: 12,
      virtualUes: 1200, maxDepth: project.channel.maxDepth });
    expect(model.activity).toEqual([]);
    expect(record).toEqual(before);
  });

  it('uses only the selected project and keeps empty tasks/activity and unverified gates honest', () => {
    const record = structuredClone(workspace().projects[0]);
    record.name = 'Second project';
    record.project.name = record.name;
    record.activity = [{ when: '2026-01-02T00:00:00Z', title: 'Edited', detail: 'Second only' }];
    record.project.tasks = [];
    (record.project.ue as { count: number }).count = 3400;
    // Imported flags must not promote a gate without validation evidence.
    record.project.integration = { ...record.project.integration as object, connected: true };
    const model = buildMissionControlModel(record);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    expect(model.projectName).toBe('Second project');
    expect(model.metrics.virtualUes).toBe(3400);
    expect(model.scenario.projectId).toBe(record.id);
    expect(model.tasks).toEqual({ count: 0, next: null });
    expect(model.activity).toEqual(record.activity);
    expect(model.readiness.checks.filter(check => check.done).map(check => check.id)).toEqual(['map']);
    expect(model.readiness.readyForRayTracing).toBe(false);
  });

  it('reflects domain scenario changes and limits the recent activity summary without editing the project', () => {
    const record = structuredClone(workspace().projects[0]);
    record.project = applyScenario(record.project, 'ue-surge');
    record.activity = Array.from({ length: 7 }, (_, index) => ({
      when: '2026-01-02T00:00:00Z', title: `Action ${index}`, detail: `Detail ${index}`,
    }));
    const before = structuredClone(record);
    const model = buildMissionControlModel(record);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    expect(model.metrics).toMatchObject({
      virtualUes: (record.project.ue as { count: number }).count,
      coveragePercent: simulatePreview(record.project).coveragePercent,
      capacityPressure: simulatePreview(record.project).capacityPressure,
    });
    expect(model.scenario).toMatchObject({ preset: 'ue-surge', blockage: 12, virtualUes: 3400 });
    expect(model.activity.map(event => event.title)).toEqual(record.activity.slice(0, 5).map(event => event.title));
    expect(record).toEqual(before);
  });
});
