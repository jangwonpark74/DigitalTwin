import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyScenario, simulatePreview } from '../../../model.mjs';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { WorkspaceConflictError } from '../../api/workspaceApi';
import { setMissionControlAssumption, setMissionControlScenario } from './missionControlCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const original = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(original.projects[0]);
second.id = secondId;
second.name = 'Second plan';
second.project.name = second.name;
const workspace = { ...original, projects: [...original.projects, second] };

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

function setup(write = vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1)) {
  const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write };
  return { controller: new AppController(api), api };
}

describe('Mission Control scenario commands use one revisioned project store', () => {
  it('applies the existing preset semantics, saves before logging, and scopes changes to the active project', async () => {
    const { controller, api } = setup();
    await controller.hydrate();
    await setMissionControlScenario(controller, 'ue-surge');
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    const state = controller.getSnapshot().workspace!;
    expect(state.projects[0].project).toEqual(applyScenario(original.projects[0].project, 'ue-surge'));
    expect(state.projects[0].activity[0]).toMatchObject({ title: 'Scenario selected', detail: 'UE density surge' });
    expect(state.projects[1].project).toEqual(second.project);
    expect(simulatePreview(state.projects[0].project).capacityPressure)
      .toBeGreaterThan(simulatePreview(state.projects[1].project).capacityPressure);
    await controller.dispatch(next => activateWorkspaceProject(next, secondId) as WorkspaceSnapshot);
    await setMissionControlScenario(controller, 'clear-line');
    expect(controller.getSnapshot().workspace?.projects[0].project.scenario).toBe('ue-surge');
    expect(controller.getSnapshot().workspace?.projects[1].project.scenario).toBe('clear-line');
  });

  it('validates preset identifiers and numeric bounds before saving; allows only the three editable assumptions', async () => {
    const { controller, api } = setup();
    await controller.hydrate();
    const before = controller.getSnapshot().workspace;
    expect(() => setMissionControlScenario(controller, '__proto__')).toThrow('Unknown scenario');
    expect(setMissionControlAssumption(controller, 'channel.reflections', '1')).toBeNull();
    expect(() => setMissionControlAssumption(controller, 'channel.blockage', '81')).toThrow('Invalid blockage percentage');
    expect(() => setMissionControlAssumption(controller, 'ue.count', '1.5')).toThrow('Invalid UE count');
    expect(() => setMissionControlAssumption(controller, 'channel.maxDepth', '')).toThrow('Invalid Sionna-RT configuration');
    expect(api.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspace).toBe(before);
    await setMissionControlAssumption(controller, 'channel.blockage', '48');
    expect(controller.getSnapshot().workspace?.projects[0].project).toMatchObject({ scenario: 'custom', channel: { blockage: 48 } });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Blockage changed', detail: '48%' });
    await setMissionControlAssumption(controller, 'ue.count', '2400');
    await setMissionControlAssumption(controller, 'channel.maxDepth', '6');
    expect(controller.getSnapshot().workspace?.projects[0].activity.slice(0, 2)).toMatchObject([
      { title: 'Project setting changed', detail: 'channel.maxDepth: 6' },
      { title: 'Project setting changed', detail: 'ue.count: 2400' },
    ]);
    expect(api.write).toHaveBeenCalledTimes(6);
  });

  it('never logs success after a conflicting save, retaining a draft for explicit recovery', async () => {
    const { controller, api } = setup(vi.fn().mockRejectedValue(new WorkspaceConflictError('Changed in another tab')));
    await controller.hydrate();
    await expect(setMissionControlScenario(controller, 'blockage')).rejects.toThrow('Changed in another tab');
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ status: 'conflict', dirty: true, revision: 2 });
    expect(controller.getSnapshot().workspace?.projects[0].activity).toHaveLength(0);
  });
});
