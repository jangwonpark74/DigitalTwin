import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import { fitMapToScene, importGeoJsonScene, loadDemoScene, updateMapField } from './cityMapCommands';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));
const sceneInput = JSON.stringify({ type: 'FeatureCollection', features: [{
  type: 'Feature', id: 'Building A', properties: { height: 30 }, geometry: { type: 'Polygon', coordinates: [[
    [126.97, 37.55], [126.98, 37.55], [126.98, 37.56], [126.97, 37.56], [126.97, 37.55],
  ]] },
}] });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

function controllerFor(fetcher = vi.fn()) {
  const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
    write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
  const controller = new AppController(api);
  return { controller, api, fetcher };
}

describe('city map project commands', () => {
  it('updates validated map scope fields through the active project and records activity', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    await updateMapField(controller, projectId, 'latitude', '37.51');
    await updateMapField(controller, projectId, 'longitude', '127.02');
    await updateMapField(controller, projectId, 'city', 'Seoul Central');
    const record = controller.getSnapshot().workspace!.projects[0];
    expect(record.project.map).toMatchObject({ latitude: 37.51, longitude: 127.02, city: 'Seoul Central' });
    expect(record.activity[0]).toMatchObject({ title: 'Map setting changed', detail: 'map.city' });
    const writes = api.write.mock.calls.length;
    expect(() => updateMapField(controller, projectId, 'radiusMeters', '20001')).toThrow(/map radius/i);
    expect(api.write).toHaveBeenCalledTimes(writes);
  });

  it('imports bounded GeoJSON, fits the existing map scope, clears stale ray output and logs the file', async () => {
    const { controller } = controllerFor();
    await controller.hydrate();
    const result = await importGeoJsonScene(controller, projectId, sceneInput, 'tower.geojson');
    if (!result) throw new Error('The active map project should be available');
    const record = controller.getSnapshot().workspace!.projects[0];
    const project = record.project as { map: { sceneFile: string; source: string; latitude: number; longitude: number;
      geometryValidated: boolean; coordinateAligned: boolean; materialAssigned: boolean;
      scene: { footprints: Array<{ id: string }> } }; rayResults: unknown };
    expect(result.footprintCount).toBe(1);
    expect(project.map).toMatchObject({ sceneFile: 'tower.geojson', source: 'GeoJSON',
      latitude: 37.555, longitude: 126.975, geometryValidated: false, coordinateAligned: false, materialAssigned: false });
    expect(project.map.scene.footprints[0].id).toBe('Building A');
    expect(project.rayResults).toBeNull();
    expect(record.activity[0]).toMatchObject({ title: 'GeoJSON footprints loaded', detail: 'tower.geojson · 1 footprints' });
  });

  it('rejects oversized or invalid scenes without changing the active project', async () => {
    const { controller, api } = controllerFor();
    await controller.hydrate();
    const before = structuredClone(controller.getSnapshot().workspace!.projects[0].project);
    await expect(importGeoJsonScene(controller, projectId, ' '.repeat(2_000_001), 'huge.geojson')).rejects.toThrow(/2 MB/i);
    await expect(importGeoJsonScene(controller, projectId, '{broken', 'bad.geojson')).rejects.toThrow();
    expect(controller.getSnapshot().workspace!.projects[0].project).toEqual(before);
    expect(api.write).toHaveBeenCalledTimes(0);
  });

  it('fits an imported scene on demand and loads the shared demo GeoJSON', async () => {
    const { controller } = controllerFor();
    await controller.hydrate();
    await importGeoJsonScene(controller, projectId, sceneInput, 'tower.geojson');
    await fitMapToScene(controller, projectId);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({ title: 'Map fitted to geometry' });

    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => sceneInput });
    const loaded = await loadDemoScene(controller, projectId, fetcher);
    if (!loaded) throw new Error('The active map project should be available');
    expect(fetcher).toHaveBeenCalledWith('/examples/demo-buildings.geojson', { cache: 'no-store' });
    expect(loaded.fileName).toBe('demo-buildings.geojson');
  });
});
