import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyUeField } from './uesCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Second project';
second.project.name = second.name;
const workspace = { ...first, projects: [first.projects[0], second] };

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

describe('project-scoped UE planning commands', () => {
  it('saves bounded fleet settings through the single revisioned controller and logs them', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();

    await applyUeField(controller, firstId, 'count', '2400');
    await applyUeField(controller, firstId, 'mobility', 'Vehicular cluster');
    await applyUeField(controller, firstId, 'seed', '71');
    expect(controller.getSnapshot().workspace!.projects[0].project.ue).toMatchObject({
      count: 2400, mobility: 'Vehicular cluster', seed: 71,
    });
    expect(controller.getSnapshot().workspace!.projects[1].project.ue).toMatchObject({ count: 1200, seed: 42 });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Project setting changed', detail: 'ue.seed: 71',
    });
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
  });

  it('rejects invalid or unknown fields and stale project writes without mutation', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();

    expect(() => applyUeField(controller, firstId, 'count', '50001')).toThrow('Invalid UE count');
    expect(() => applyUeField(controller, firstId, 'seed', '-1')).toThrow();
    expect(() => applyUeField(controller, firstId, 'mobility', 'unspecified')).toThrow();
    expect(applyUeField(controller, firstId, '__proto__', 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyUeField(controller, firstId, 'count', '2400')).toThrow('UE project changed');
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
  });
});
