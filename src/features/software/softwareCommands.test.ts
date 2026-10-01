import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applySoftwareVersion } from './softwareCommands';

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
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('project-scoped software targets', () => {
  it('saves only a valid version target and records the planning change', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applySoftwareVersion(controller, firstId, 'sionna-rt', ' 2.1.0 ');
    const software = (controller.getSnapshot().workspace!.projects[0].project.management as {
      software: { id: string; targetVersion: string; installation: string }[];
    }).software;
    expect(software.find(item => item.id === 'sionna-rt')).toMatchObject({ targetVersion: '2.1.0', installation: 'not-verified' });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({ title: 'Software target version changed', detail: 'sionna-rt' });
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
  });

  it('rejects invalid versions and stale project edits before writing', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn() };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applySoftwareVersion(controller, firstId, 'sionna-rt', 'bad version!')).toThrow('Invalid target version for sionna-rt');
    expect(applySoftwareVersion(controller, firstId, '__proto__', '3.0')).toBeNull();
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applySoftwareVersion(controller, firstId, 'sionna-rt', '3.0')).toThrow('Software project changed');
    expect(api.write).toHaveBeenCalledTimes(1); // project switch only; the stale edit adds no write
  });
});
