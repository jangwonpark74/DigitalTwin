import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mapPercentToGeo } from '../../../model.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { addPlannedSite, applyCellField, applySiteField } from './sitePlannerCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Other site planner';
second.project.name = second.name;
const workspace = { ...first, projects: [first.projects[0], second] };
type TestProject = { map: { latitude: number; longitude: number; radiusMeters: number };
  sites: Array<{ id: string; name: string; heightM: number; frontEnd: string; x: number; y: number;
    radioLocation: { latitude: number | null; longitude: number | null; source: string };
    cells: Array<{ id: string; azimuthDeg: number; downtiltDeg: number; txPowerDbm: number; bandwidthMhz: number }> }> };

const projectAt = (controller: AppController, index = 0) =>
  controller.getSnapshot().workspace!.projects[index].project as TestProject;

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

function controllerFor(apiWrite = vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1)) {
  const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: apiWrite };
  return { controller: new AppController(api), api };
}

describe('site and cell planner controller intents', () => {
  it('rejects blank required numbers without saving and accepts explicit zero where valid', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    const before = structuredClone(controller.getSnapshot().workspace);
    for (const field of ['heightM', 'x', 'y'] as const)
      for (const value of ['', '  ']) expect(() => applySiteField(controller, firstId, 'SITE-02', field, value)).toThrow(/requires a number/);
    for (const field of ['azimuthDeg', 'downtiltDeg', 'txPowerDbm', 'bandwidthMhz'] as const)
      for (const value of ['', '  ']) expect(() => applyCellField(controller, firstId, 'SITE-02-C2', field, value)).toThrow(/requires a number/);
    expect(controller.getSnapshot().workspace).toEqual(before);
    expect(api.write).not.toHaveBeenCalled();
    await applyCellField(controller, firstId, 'SITE-02-C2', 'azimuthDeg', '0');
    expect(projectAt(controller).sites[1].cells[1].azimuthDeg).toBe(0);
    expect(api.write).toHaveBeenCalledTimes(2);
  });
  it('saves allowlisted site fields and estimates geographic location from schematic x/y', async () => {
    const { controller } = controllerFor();
    await controller.hydrate();
    const map = projectAt(controller).map;

    await applySiteField(controller, firstId, 'SITE-02', 'name', '  South Annex  ');
    await applySiteField(controller, firstId, 'SITE-02', 'heightM', '42');
    await applySiteField(controller, firstId, 'SITE-02', 'frontEnd', 'Antenna');
    await applySiteField(controller, firstId, 'SITE-02', 'x', '40');
    await applySiteField(controller, firstId, 'SITE-02', 'y', '60');

    const savedWorkspace = controller.getSnapshot().workspace!;
    const site = projectAt(controller).sites[1];
    expect(site).toMatchObject({ id: 'SITE-02', name: 'South Annex', heightM: 42, frontEnd: 'Antenna', x: 40, y: 60,
      radioLocation: { ...mapPercentToGeo(map, 40, 60), source: 'map-estimate' } });
    expect(savedWorkspace.projects[0].activity[0]).toMatchObject({
      title: 'Site setting changed', detail: 'SITE-02 · y',
    });
    expect(projectAt(controller, 1).sites[1].name).toBe('River Bridge');
  });

  it('saves cell sector fields only inside the selected project and rejects invalid values', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    await applyCellField(controller, firstId, 'SITE-02-C2', 'azimuthDeg', '221');
    await applyCellField(controller, firstId, 'SITE-02-C2', 'downtiltDeg', '7');
    await applyCellField(controller, firstId, 'SITE-02-C2', 'txPowerDbm', '48');
    await applyCellField(controller, firstId, 'SITE-02-C2', 'bandwidthMhz', '80');
    expect(projectAt(controller).sites[1].cells[1])
      .toMatchObject({ azimuthDeg: 221, downtiltDeg: 7, txPowerDbm: 48, bandwidthMhz: 80 });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Cell setting changed', detail: 'SITE-02-C2 · bandwidthMhz',
    });
    const writes = api.write.mock.calls.length;
    expect(() => applyCellField(controller, firstId, 'SITE-02-C2', 'azimuthDeg', '360')).toThrow('Invalid azimuth for SITE-02-C2');
    expect(applyCellField(controller, firstId, 'SITE-99-C1', 'azimuthDeg', '90')).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(writes);
  });

  it('adds a default three-cell site through the existing domain planner and logs after save', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    const newSiteId = await addPlannedSite(controller, firstId, { name: ' North Tower ', x: 43, y: 49 });
    const project = projectAt(controller);
    const site = project.sites.at(-1)!;
    expect(newSiteId).toBe('SITE-04');
    expect(site).toMatchObject({ id: newSiteId, name: 'North Tower', x: 43, y: 49,
      frontEnd: 'Antenna', heightM: 30, radioLocation: { latitude: null, longitude: null, source: 'unassigned' } });
    expect(site.cells.map(cell => cell.id)).toEqual(['SITE-04-C1', 'SITE-04-C2', 'SITE-04-C3']);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({ title: 'Site created', detail: 'North Tower' });
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid add-site inputs, stale projects and failed saves without success activity', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    expect(() => addPlannedSite(controller, firstId, { name: '  ', x: 40, y: 50 })).toThrow('Site name required');
    expect(() => addPlannedSite(controller, firstId, { name: 'North', x: 101, y: 50 }))
      .toThrow('Site map position must be between 0 and 100');
    expect(() => applySiteField(controller, firstId, 'SITE-99', 'name', 'Unknown')).not.toThrow();
    expect(api.write).not.toHaveBeenCalled();

    const failing = controllerFor(vi.fn().mockRejectedValue(new Error('Revision conflict')));
    await failing.controller.hydrate();
    await expect(addPlannedSite(failing.controller, firstId, { name: 'North Tower', x: 43, y: 49 }))
      .rejects.toThrow('Revision conflict');
    expect(failing.controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
    expect(failing.api.write).toHaveBeenCalledTimes(1);
  });

  it('rejects site and cell edits after the active project changes', async () => {
    const { controller } = controllerFor();
    await controller.hydrate();
    await applySiteField(controller, firstId, 'SITE-01', 'x', '63');
    await applyCellField(controller, firstId, 'SITE-01-C1', 'txPowerDbm', '52');
    await expect(controller.dispatch(state => {
      state.activeProjectId = secondId;
      return state as WorkspaceSnapshot;
    })).resolves.toBeUndefined();
    expect(() => applySiteField(controller, firstId, 'SITE-01', 'heightM', '40')).toThrow('Site planner project changed');
    expect(() => applyCellField(controller, firstId, 'SITE-01-C1', 'azimuthDeg', '10')).toThrow('Site planner project changed');
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
  });
});
