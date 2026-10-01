import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyStackEndpoint } from './stackCommands';

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

describe('project-scoped stack planning commands', () => {
  it('saves endpoint labels without asserting a live connection', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();

    await applyStackEndpoint(controller, firstId, 'vCoreEndpoint', 'core-lab');
    await applyStackEndpoint(controller, firstId, 'vDUEndpoint', 'du-lab');
    expect((controller.getSnapshot().workspace!.projects[0].project as { integration: object }).integration)
      .toMatchObject({ vCoreEndpoint: 'core-lab', vDUEndpoint: 'du-lab', connected: false });
    expect((controller.getSnapshot().workspace!.projects[1].project as { integration: { vCoreEndpoint: string } }).integration.vCoreEndpoint).toBe('');
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Project setting changed', detail: 'integration.vDUEndpoint: du-lab',
    });
  });

  it('rejects unsupported fields and stale project writes', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(applyStackEndpoint(controller, firstId, '__proto__', 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyStackEndpoint(controller, firstId, 'vCoreEndpoint', 'core-lab')).toThrow('Stack project changed');
  });
});
