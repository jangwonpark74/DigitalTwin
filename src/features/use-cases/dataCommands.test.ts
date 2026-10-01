import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyDataField } from './dataCommands';

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

describe('project-scoped dataset planning commands', () => {
  it('saves task and complementary split edits without creating samples', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();

    await applyDataField(controller, firstId, 'task', 'handover-prediction');
    await applyDataField(controller, firstId, 'split.train', '60');
    const project = controller.getSnapshot().workspace!.projects[0].project as { useCases: { data: {
      task: string; split: { train: number; validation: number; test: number };
    } } };
    expect(project.useCases.data).toMatchObject({ task: 'handover-prediction', split: { train: 60, validation: 15, test: 25 } });
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].detail).toBe('data.split.train');
  });

  it('rejects duplicate seeds, invalid splits, unsupported fields and stale-project writes', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyDataField(controller, firstId, 'seeds', '11, 11')).toThrow('Data seeds must be unique bounded integers');
    expect(() => applyDataField(controller, firstId, 'split.train', '95')).toThrow('Train/validation/test splits');
    expect(applyDataField(controller, firstId, '__proto__', 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyDataField(controller, firstId, 'task', 'channel-prediction')).toThrow('Dataset project changed');
  });
});
