import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyAbField } from './abCommands';

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

describe('project-scoped A/B planning commands', () => {
  it('saves allowlisted settings and logs them without creating a verdict', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(applyAbField(controller, firstId, 'packageA', 'RAN-BASELINE-A')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();

    await applyAbField(controller, firstId, 'packageB', 'candidate-2');
    await applyAbField(controller, firstId, 'seeds', '71, 72');
    const project = controller.getSnapshot().workspace!.projects[0].project as { useCases: { ab: { packageB: string; seeds: number[] } } };
    expect(project.useCases.ab).toMatchObject({ packageB: 'candidate-2', seeds: [71, 72] });
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Use-case setting changed', detail: 'ab.seeds',
    });
  });

  it('rejects malformed seeds, unsupported fields and stale-project writes', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyAbField(controller, firstId, 'seeds', '1, nope')).toThrow('Seeds must be comma-separated nonnegative integers');
    expect(() => applyAbField(controller, firstId, 'seeds', '7, 7')).toThrow('A/B seeds must be unique bounded integers');
    expect(applyAbField(controller, firstId, '__proto__', 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyAbField(controller, firstId, 'packageA', 'baseline-2')).toThrow('A/B project changed');
  });
});
