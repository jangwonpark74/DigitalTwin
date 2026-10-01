import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyScheduleDate } from './scheduleCommands';

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

describe('project-scoped schedule commands', () => {
  it('reschedules a planned task and logs its date without dispatching work', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const tasks = controller.getSnapshot().workspace!.projects[0].project.tasks as { id: string; dueDate: string }[];
    const dueDate = tasks.find(task => task.id === 'T-02')!.dueDate;
    await applyScheduleDate(controller, firstId, 'T-01', dueDate);
    expect((controller.getSnapshot().workspace!.projects[0].project.tasks as typeof tasks)
      .find(task => task.id === 'T-01')!.dueDate).toBe(dueDate);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Task date changed', detail: `T-01 → ${dueDate}`,
    });
  });

  it('rejects dates before dependencies, unknown tasks and stale-project writes', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyScheduleDate(controller, firstId, 'T-02', '2000-01-01'))
      .toThrow('Task T-02 scheduled before dependency T-01');
    expect(applyScheduleDate(controller, firstId, 'unknown', '2026-06-01')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyScheduleDate(controller, firstId, 'T-01', '2026-07-01')).toThrow('Schedule project changed');
  });
});
