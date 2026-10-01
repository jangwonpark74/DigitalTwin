import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState } from '../../workspaces.mjs';
import { AppController } from '../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../api/schemas';
import { WorkspaceConflictError } from '../api/workspaceApi';
import { addLegacyTask, applyLegacyField } from './legacyEventAdapter';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Other project';
second.project.name = second.name;
const workspace = { ...first, projects: [...first.projects, second] };

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

describe('single-owner legacy field command adapter', () => {
  it('serializes domain edits and activity through the controller for the selected project', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyLegacyField(controller, 'software.sionna-rt', ' 2.1.0 ');
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    const firstSoftware = (controller.getSnapshot().workspace?.projects[0].project.management as {
      software: { id: string; targetVersion: string; installation: string }[];
    }).software;
    expect(firstSoftware.find(item => item.id === 'sionna-rt')).toMatchObject({ targetVersion: '2.1.0', installation: 'not-verified' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Software target version changed');
    await applyLegacyField(controller, 'monitoring.gpuUtilizationPct', '92');
    await applyLegacyField(controller, 'integration.vCoreEndpoint', 'lab-core');
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
    const project = controller.getSnapshot().workspace?.projects[0].project;
    expect((project?.management as { monitoring: { connected: boolean; thresholds: { gpuUtilizationPct: number } } }).monitoring)
      .toMatchObject({ connected: false, thresholds: { gpuUtilizationPct: 92 } });
    expect((project?.integration as { connected: boolean; vCoreEndpoint: string })).toMatchObject({ connected: false, vCoreEndpoint: 'lab-core' });
    expect(controller.getSnapshot().workspace?.projects[1].activity).toHaveLength(0);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    await applyLegacyField(controller, 'software.sionna-rt', '3.0.0');
    expect((controller.getSnapshot().workspace?.projects[0].project.management as { software: { targetVersion: string }[] }).software[0].targetVersion).toBe('2.1.0');
    expect((controller.getSnapshot().workspace?.projects[1].project.management as { software: { targetVersion: string }[] }).software[0].targetVersion).toBe('3.0.0');
  });

  it('rejects invalid domain input before any write and ignores unknown or forged paths', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn() };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyLegacyField(controller, 'software.sionna-rt', 'bad version!')).toThrow('Invalid target version for sionna-rt');
    expect(() => applyLegacyField(controller, 'monitoring.fronthaulLatencyMs', '501')).toThrow('Invalid monitoring threshold fronthaulLatencyMs');
    for (const path of ['software.__proto__', 'monitoring.__proto__', 'integration.connected', 'tasks.T-01']) {
      expect(applyLegacyField(controller, path, 'injected')).toBeNull();
    }
    expect(api.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ revision: 2, dirty: false });
  });

  it('reschedules only a selected project planned task and rejects dependency violations', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const tasks = controller.getSnapshot().workspace?.projects[0].project.tasks as { id: string; dueDate: string; execution: string }[];
    const newDate = tasks.find(task => task.id === 'T-02')!.dueDate;
    const originalDate = tasks.find(task => task.id === 'T-01')!.dueDate;
    await applyLegacyField(controller, 'schedule.T-01', newDate);
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    expect((controller.getSnapshot().workspace?.projects[0].project.tasks as typeof tasks)[0]).toMatchObject({ dueDate: newDate, execution: 'not-executed' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Task date changed', detail: `T-01 → ${newDate}` });
    expect(() => applyLegacyField(controller, 'schedule.T-02', '2000-01-01')).toThrow('Task T-02 scheduled before dependency T-01');
    expect(applyLegacyField(controller, 'schedule.T-999', newDate)).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(2);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect((controller.getSnapshot().workspace?.projects[1].project.tasks as typeof tasks)[0].dueDate).toBe(originalDate);
  });

  it('adds a planned task with dependency validation and never dispatches execution', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const tasks = controller.getSnapshot().workspace?.projects[0].project.tasks as { id: string; dueDate: string }[];
    const dueDate = tasks.find(task => task.id === 'T-02')!.dueDate;
    await addLegacyTask(controller, { title: ' Validate antenna patterns ', dueDate, priority: 'high', dependency: 'T-01' });
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    const added = (controller.getSnapshot().workspace?.projects[0].project.tasks as {
      id: string; title: string; dueDate: string; dependsOn: string[]; status: string; execution: string;
    }[]).at(-1);
    expect(added).toMatchObject({ id: 'T-08', title: 'Validate antenna patterns', dueDate, dependsOn: ['T-01'], status: 'planned', execution: 'not-executed' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Task added to plan', detail: 'Validate antenna patterns' });
    expect(() => addLegacyTask(controller, { title: 'Too early', dueDate: '2000-01-01', priority: 'normal', dependency: 'T-01' }))
      .toThrow('Task T-09 scheduled before dependency T-01');
    expect(() => addLegacyTask(controller, { title: 'Bad dependency', dueDate, priority: 'normal', dependency: 'T-99' }))
      .toThrow('Unknown dependency T-99 for T-09');
    expect(api.write).toHaveBeenCalledTimes(2);
    expect((controller.getSnapshot().workspace?.projects[1].project.tasks as typeof tasks)).toHaveLength(7);
  });

  it('saves UE planning fields through one controller with selected-project isolation', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyLegacyField(controller, 'ue.count', '2400');
    await applyLegacyField(controller, 'ue.mobility', 'Vehicular cluster');
    await applyLegacyField(controller, 'ue.seed', '71');
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
    expect(controller.getSnapshot().workspace?.projects[0].project.ue).toMatchObject({
      count: 2400, mobility: 'Vehicular cluster', seed: 71,
    });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({
      title: 'Project setting changed', detail: 'ue.seed: 71',
    });
    expect(controller.getSnapshot().workspace?.projects[1].project.ue).toMatchObject({ count: 1200 });
    expect(() => applyLegacyField(controller, 'ue.count', '50001')).toThrow('Invalid UE count');
    expect(applyLegacyField(controller, 'ue.__proto__', 'injected')).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(6);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(controller.getSnapshot().workspace?.projects[1].project.ue).toMatchObject({ count: 1200 });
  });

  it('validates paired A/B inputs and writes only the selected project through the revision queue', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyLegacyField(controller, 'ab.packageB', 'RAN-BUILD-3');
    await applyLegacyField(controller, 'ab.seeds', '7, 8');
    await applyLegacyField(controller, 'ab.guardrailDropPct', '6.5');
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
    const ab = (controller.getSnapshot().workspace?.projects[0].project.useCases as {
      ab: { packageB: string; seeds: number[]; guardrailDropPct: number };
    }).ab;
    expect(ab).toMatchObject({ packageB: 'RAN-BUILD-3', seeds: [7, 8], guardrailDropPct: 6.5 });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({
      title: 'Use-case setting changed', detail: 'ab.guardrailDropPct',
    });
    expect(() => applyLegacyField(controller, 'ab.packageA', 'RAN-BUILD-3')).toThrow('A/B package IDs must be distinct');
    expect(() => applyLegacyField(controller, 'ab.seeds', '7, 7')).toThrow('A/B seeds must be unique bounded integers');
    expect(() => applyLegacyField(controller, 'ab.seeds', '7, not-a-seed')).toThrow('Seeds must be comma-separated nonnegative integers');
    expect(() => applyLegacyField(controller, 'ab.minSinrGainDb', '21')).toThrow('Minimum SINR gain must be -20–20 dB');
    expect(applyLegacyField(controller, 'ab.__proto__', 'unsafe')).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(6);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect((controller.getSnapshot().workspace?.projects[1].project.useCases as { ab: { seeds: number[] } }).ab.seeds).toEqual([42, 43, 44]);
  });

  it('derives dataset split complements and preserves zero generated rows across scoped edits', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyLegacyField(controller, 'data.task', 'handover-prediction');
    await applyLegacyField(controller, 'data.seeds', '11, 22');
    await applyLegacyField(controller, 'data.split.train', '60');
    const data = (controller.getSnapshot().workspace?.projects[0].project.useCases as {
      data: { task: string; seeds: number[]; split: { train: number; validation: number; test: number } };
    }).data;
    expect(data).toMatchObject({ task: 'handover-prediction', seeds: [11, 22], split: { train: 60, validation: 15, test: 25 } });
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Use-case setting changed', detail: 'data.split.train' });
    expect(() => applyLegacyField(controller, 'data.seeds', '11, 11')).toThrow('Data seeds must be unique bounded integers');
    expect(() => applyLegacyField(controller, 'data.seeds', '11, invalid')).toThrow('Seeds must be comma-separated nonnegative integers');
    expect(() => applyLegacyField(controller, 'data.split.validation', '95')).toThrow('Train/validation/test splits must each be 5–90 and sum to 100');
    expect(applyLegacyField(controller, 'data.split.__proto__', 'unsafe')).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(6);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect((controller.getSnapshot().workspace?.projects[1].project.useCases as { data: { task: string } }).data.task).toBe('channel-prediction');
  });

  it('validates drive route, sample budget and speed only for the selected project', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyLegacyField(controller, 'drive.route', 'river-corridor');
    await applyLegacyField(controller, 'drive.samples', '32');
    await applyLegacyField(controller, 'drive.speedKph', '45');
    const drive = (controller.getSnapshot().workspace?.projects[0].project.useCases as {
      drive: { route: string; samples: number; speedKph: number };
    }).drive;
    expect(drive).toMatchObject({ route: 'river-corridor', samples: 32, speedKph: 45 });
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3, 4, 5, 6, 7]);
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Use-case setting changed', detail: 'drive.speedKph' });
    expect(() => applyLegacyField(controller, 'drive.route', 'unknown')).toThrow('Unknown virtual drive route');
    expect(() => applyLegacyField(controller, 'drive.samples', '501')).toThrow('Drive sample count must be 8–500');
    expect(() => applyLegacyField(controller, 'drive.speedKph', '0')).toThrow('Drive speed must be 1–130 km/h');
    expect(applyLegacyField(controller, 'drive.__proto__', 'unsafe')).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(6);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect((controller.getSnapshot().workspace?.projects[1].project.useCases as { drive: { route: string } }).drive.route).toBe('downtown-loop');
  });

  it('does not append a success log or issue a second write when the first save conflicts', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockRejectedValue(new WorkspaceConflictError('Changed in another tab')) };
    const controller = new AppController(api);
    await controller.hydrate();
    await expect(applyLegacyField(controller, 'software.sionna-rt', '2.1.0')).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ revision: 2, status: 'conflict', dirty: true });
    expect(controller.getSnapshot().workspace?.projects[0].activity).toHaveLength(0);
  });
});
