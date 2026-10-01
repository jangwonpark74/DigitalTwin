import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { archiveProject, createProject, deleteProject, duplicateProject, renameProject, restoreProject } from './projectCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('project lifecycle commands', () => {
  it('creates and duplicates independent projects through the controller', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await createProject(controller, { name: ' Downtown pilot ', city: ' Seoul ', cluster: ' Central ' });
    let state = controller.getSnapshot().workspace!;
    const created = state.projects.find(item => item.name === 'Downtown pilot')!;
    expect(created.project.map).toMatchObject({ city: 'Seoul', cluster: 'Central' });
    expect(created.activity[0]).toMatchObject({ title: 'Project created', detail: 'Seoul · Central' });
    await duplicateProject(controller, created.id);
    state = controller.getSnapshot().workspace!;
    expect(state.projects).toHaveLength(3);
    expect(state.projects.find(item => item.id === state.activeProjectId)?.name).toBe('Downtown pilot (copy)');
    expect(state.projects.find(item => item.id === created.id)?.project).toEqual(created.project);
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
  });

  it('renames, archives, restores and deletes archived projects using registry rules', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await createProject(controller, { name: 'Second project', city: 'Busan', cluster: 'Harbor' });
    const secondId = controller.getSnapshot().workspace!.activeProjectId;
    await renameProject(controller, secondId, 'Harbor pilot');
    expect(controller.getSnapshot().workspace!.projects.find(item => item.id === secondId)?.name).toBe('Harbor pilot');
    await archiveProject(controller, secondId);
    expect(controller.getSnapshot().workspace!.activeProjectId).toBe(firstId);
    await restoreProject(controller, secondId);
    expect(controller.getSnapshot().workspace!.projects.find(item => item.id === secondId)?.status).toBe('active');
    await archiveProject(controller, secondId);
    await deleteProject(controller, secondId);
    expect(controller.getSnapshot().workspace!.projects.map(item => item.id)).toEqual([firstId]);
  });

  it('validates project details before saving', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn() };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => createProject(controller, { name: ' ', city: 'Seoul', cluster: 'Central' }))
      .toThrow('Project name must contain 1–80 characters');
    expect(() => createProject(controller, { name: 'Okay', city: '', cluster: 'Central' }))
      .toThrow('City / location is required');
    expect(api.write).not.toHaveBeenCalled();
  });
});
