import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyHardwareField } from './hardwareCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Other hardware pilot';
second.project.name = second.name;
const workspace = { ...first, projects: [first.projects[0], second] };

type Management = { topology: { gh200Pools: { id: string; alias: string; plannedServers: number }[];
  vduServerCount: number | null; switchPortCount: number | null };
  hardware: { id: string; alias: string }[] };
const management = (controller: AppController, index = 0) =>
  controller.getSnapshot().workspace!.projects[index].project.management as Management;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

describe('selected-project hardware planning commands', () => {
  it('uses domain validation and the controller queue for aliases, pool targets and nullable physical capacities', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const assetId = management(controller).hardware[0].id;
    await applyHardwareField(controller, firstId, { kind: 'poolAlias', id: 'GH-POOL-02' }, '  Lab GPU pool  ');
    await applyHardwareField(controller, firstId, { kind: 'poolCount', id: 'GH-POOL-02' }, '3');
    await applyHardwareField(controller, firstId, { kind: 'hardwareAlias', id: assetId }, '  Target host  ');
    await applyHardwareField(controller, firstId, { kind: 'poolCount', id: 'GH-POOL-03' }, '0');
    await applyHardwareField(controller, firstId, { kind: 'vduCount' }, '');
    await applyHardwareField(controller, firstId, { kind: 'switchCount' }, '48');
    expect(management(controller).topology.gh200Pools[1]).toMatchObject({ alias: 'Lab GPU pool', plannedServers: 3 });
    expect(management(controller).hardware[0].alias).toBe('Target host');
    expect(management(controller).topology.gh200Pools[2].plannedServers).toBe(0);
    expect(management(controller).topology).toMatchObject({ vduServerCount: null, switchPortCount: 48 });
    expect(management(controller, 1).topology.gh200Pools[1].plannedServers).toBe(6);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Physical capacity target changed', detail: 'switch',
    });
    expect(api.write).toHaveBeenCalledTimes(12);
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  });

  it('rejects invalid values, unknown IDs and a stale project without writing or logging success', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyHardwareField(controller, firstId, { kind: 'poolCount', id: 'GH-POOL-02' }, '7'))
      .toThrow('GH200 pool GH-POOL-02 supports up to six planned servers');
    expect(() => applyHardwareField(controller, firstId, { kind: 'poolAlias', id: 'GH-POOL-01' }, '   '))
      .toThrow('Invalid GH200 pool alias for GH-POOL-01');
    expect(() => applyHardwareField(controller, firstId, { kind: 'vduCount' }, '0'))
      .toThrow('vDU planned server count must be 1–64 or TBD');
    expect(() => applyHardwareField(controller, firstId, { kind: 'switchCount' }, '513'))
      .toThrow('Ethernet switch target ports must be 1–512 or TBD');
    expect(applyHardwareField(controller, firstId, { kind: 'poolAlias', id: '__proto__' }, 'unsafe')).toBeNull();
    expect(applyHardwareField(controller, firstId, { kind: 'hardwareAlias', id: '__proto__' }, 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyHardwareField(controller, firstId, { kind: 'poolCount', id: 'GH-POOL-01' }, '2'))
      .toThrow('Hardware project changed');
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('does not append a success log when SQLite rejects the first save', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockRejectedValue(new Error('Revision conflict')) };
    const controller = new AppController(api);
    await controller.hydrate();
    await expect(applyHardwareField(controller, firstId, { kind: 'poolCount', id: 'GH-POOL-01' }, '2'))
      .rejects.toThrow('Revision conflict');
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
  });
});
