import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geoToMapPercent, mapPercentToGeo } from '../../../model.mjs';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { applyRadioField, placeRadioAtCoordinates, placeRadioOnMap } from './radioCommands';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Other radio pilot';
second.project.name = second.name;
const workspace = { ...first, projects: [first.projects[0], second] };
type Site = { id: string; frontEnd: string; radio: { technology: string; ruModel: string; mmuElements: number | null };
  radioLocation: { latitude: number | null; longitude: number | null; source: string }; x: number; y: number };
const site = (controller: AppController, index = 0) =>
  (controller.getSnapshot().workspace!.projects[index].project.sites as Site[])[0];

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

describe('radio-planner controller intents (legacy domain remains authoritative)', () => {
  it('persists geographic map picks at their exact coordinates while protecting project scope', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    const map = controller.getSnapshot().workspace!.projects[0].project.map as { latitude: number; longitude: number; radiusMeters: number };
    const coordinates = mapPercentToGeo(map, 65, 30);
    await placeRadioAtCoordinates(controller, firstId, 'SITE-01', coordinates);
    expect(site(controller).radioLocation).toEqual({ ...coordinates, source: 'manual' });
    expect(controller.getSnapshot().workspace!.projects[1]).toEqual(workspace.projects[1]);
    const saved = structuredClone(controller.getSnapshot().workspace);
    expect(() => placeRadioAtCoordinates(controller, firstId, 'SITE-01', { latitude: 0, longitude: 0 })).toThrow('outside the current map radius');
    expect(controller.getSnapshot().workspace).toEqual(saved);
    expect(api.write).toHaveBeenCalledTimes(2);
  });
  it('validates selected-site technology, front end and nullable MMU inputs without touching another project', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    await applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'technology' }, '4G LTE + 5G NR');
    await applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'ruModel' }, '  RU-01  ');
    await applyRadioField(controller, firstId, { kind: 'frontEnd', siteId: 'SITE-01' }, 'MMU');
    await applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'mmuElements' }, '64');
    expect(site(controller)).toMatchObject({ frontEnd: 'MMU', radio: {
      technology: '4G LTE + 5G NR', ruModel: 'RU-01', mmuElements: 64,
    } });
    expect(site(controller, 1)).toMatchObject({ frontEnd: 'Antenna', radio: { mmuElements: null, ruModel: '' } });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Radio configuration changed', detail: 'SITE-01 · mmuElements',
    });
    await applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'mmuElements' }, '');
    expect(site(controller).radio.mmuElements).toBeNull();
    expect(api.write).toHaveBeenCalledTimes(10);
    expect(() => applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'mmuElements' }, '1025'))
      .toThrow('Invalid MMU element count for SITE-01');
    expect(() => applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: 'technology' }, '6G'))
      .toThrow('Invalid radio technology for SITE-01');
    expect(api.write).toHaveBeenCalledTimes(10);
  });

  it('marks manually entered coordinates, projects only a complete pair, and restores unassigned on clear', async () => {
    const { controller } = controllerFor();
    await controller.hydrate();
    const initial = { x: site(controller).x, y: site(controller).y };
    const map = controller.getSnapshot().workspace!.projects[0].project.map as {
      latitude: number; longitude: number; radiusMeters: number;
    };
    await applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'latitude' }, String(map.latitude));
    expect(site(controller).radioLocation).toMatchObject({ latitude: map.latitude, longitude: null, source: 'manual' });
    expect(site(controller)).toMatchObject(initial);
    await applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'longitude' }, String(map.longitude));
    expect(site(controller).radioLocation).toMatchObject({ longitude: map.longitude, source: 'manual' });
    expect(site(controller)).toMatchObject(geoToMapPercent(map, map.latitude, map.longitude));
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Radio coordinates changed', detail: 'SITE-01 · longitude',
    });
    const located = structuredClone(site(controller));
    expect(() => applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'longitude' }, '0'))
      .toThrow('Radio coordinates are outside the current map radius');
    expect(site(controller)).toEqual(located);
    await applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'latitude' }, '');
    expect(site(controller).radioLocation).toMatchObject({ latitude: null, source: 'manual' });
    await applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'longitude' }, '');
    expect(site(controller).radioLocation).toMatchObject({ longitude: null, source: 'unassigned' });
    expect(site(controller)).toMatchObject(geoToMapPercent(map, map.latitude, map.longitude));
    expect(site(controller, 1).radioLocation.source).toBe('unassigned');
  });

  it('rejects invalid and stale paths without writing or fabricating a success log', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    expect(() => applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: 'latitude' }, '91'))
      .toThrow('Invalid radio latitude for SITE-01');
    expect(() => applyRadioField(controller, firstId, { kind: 'frontEnd', siteId: 'SITE-01' }, 'Unknown'))
      .toThrow('Invalid front end for SITE-01');
    expect(applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-99', prop: 'ruModel' }, 'unsafe')).toBeNull();
    expect(applyRadioField(controller, firstId, { kind: 'config', siteId: 'SITE-01', prop: '__proto__' as never }, 'unsafe')).toBeNull();
    expect(applyRadioField(controller, firstId, { kind: 'location', siteId: 'SITE-01', prop: '__proto__' as never }, 'unsafe')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => applyRadioField(controller, firstId, { kind: 'frontEnd', siteId: 'SITE-01' }, 'MMU'))
      .toThrow('Radio project changed');
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
  });

  it('logs only after the first save succeeds', async () => {
    const { controller, api } = controllerFor(vi.fn().mockRejectedValue(new Error('Revision conflict')));
    await controller.hydrate();
    await expect(applyRadioField(controller, firstId, { kind: 'frontEnd', siteId: 'SITE-01' }, 'MMU'))
      .rejects.toThrow('Revision conflict');
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
  });

  it('places the selected site as a schematic map estimate and records coordinates after a confirmed save', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    const map = controller.getSnapshot().workspace!.projects[0].project.map as {
      latitude: number; longitude: number; radiusMeters: number;
    };
    const point = { x: 65, y: 30 };
    const coordinates = mapPercentToGeo(map, point.x, point.y);

    await placeRadioOnMap(controller, firstId, 'SITE-01', point);

    expect(site(controller)).toMatchObject({ ...point, radioLocation: { ...coordinates, source: 'map-estimate' } });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Radio location placed on map',
      detail: `SITE-01 · ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}`,
    });
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid map positions and stale projects without writing or logging success', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    expect(() => placeRadioOnMap(controller, firstId, 'SITE-01', { x: 101, y: 50 }))
      .toThrow('Radio map position must be between 0 and 100');
    expect(placeRadioOnMap(controller, firstId, 'SITE-99', { x: 50, y: 50 })).toBeNull();
    expect(api.write).not.toHaveBeenCalled();

    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(() => placeRadioOnMap(controller, firstId, 'SITE-01', { x: 50, y: 50 }))
      .toThrow('Radio project changed');
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
  });

  it('does not add placement activity when the workspace save fails', async () => {
    const { controller, api } = controllerFor(vi.fn().mockRejectedValue(new Error('Revision conflict')));
    await controller.hydrate();
    await expect(placeRadioOnMap(controller, firstId, 'SITE-01', { x: 50, y: 50 }))
      .rejects.toThrow('Revision conflict');
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
  });
});
