import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { addPlannedTask } from './taskCommands';

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

describe('project-scoped planned task commands', () => {
  it('adds validated, unexecuted work to only the active project', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await addPlannedTask(controller, firstId, { title: ' Validate antenna patterns ', dueDate: '2026-12-01', priority: 'high', dependency: 'T-07' });
    const tasks = controller.getSnapshot().workspace!.projects[0].project.tasks as { id: string; title: string; status: string; execution: string }[];
    expect(tasks.at(-1)).toMatchObject({ id: 'T-08', title: 'Validate antenna patterns', status: 'planned', execution: 'not-executed' });
    expect(controller.getSnapshot().workspace!.projects[1].project.tasks).toHaveLength(7);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({ title: 'Task added to plan', detail: 'Validate antenna patterns' });
  });

  it('rejects prerequisite date violations and stale project writes', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => addPlannedTask(controller, firstId, { title: 'Too early', dueDate: '2000-01-01', priority: 'normal', dependency: 'T-01' }))
      .toThrow('Task T-08 scheduled before dependency T-01');
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => addPlannedTask(controller, firstId, { title: 'Stale', dueDate: '2026-06-01', priority: 'normal', dependency: '' }))
      .toThrow('Tasks project changed');
  });
});
