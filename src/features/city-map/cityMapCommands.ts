import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { parseGeoJsonScene, sceneFit } from '../../../scene.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';

type MapField = 'city' | 'cluster' | 'latitude' | 'longitude' | 'radiusMeters';
type MapProject = {
  map: {
    city: string; cluster: string; latitude: number; longitude: number; radiusMeters: number;
    scene?: ReturnType<typeof parseGeoJsonScene>; sceneFile?: string; source?: string;
    geometryValidated?: boolean; coordinateAligned?: boolean; materialAssigned?: boolean;
  };
  rayResults: unknown;
};

function activeRecord(controller: AppController, projectId: string) {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Map project changed; select the active project before retrying.');
  return state.projects.find(record => record.id === projectId) ?? null;
}

function saveAndLog(controller: AppController, projectId: string, change: (project: MapProject) => void,
  title: string, detail: string): Promise<void> {
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, change) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title, detail }) as WorkspaceSnapshot));
}

export function updateMapField(controller: AppController, projectId: string, field: MapField, value: string) {
  const fields: MapField[] = ['city', 'cluster', 'latitude', 'longitude', 'radiusMeters'];
  if (!fields.includes(field)) throw new Error(`Unsupported map field: ${field}`);
  if (!activeRecord(controller, projectId)) return null;
  return saveAndLog(controller, projectId, project => {
    if (field === 'city' || field === 'cluster') project.map[field] = value.trim();
    else project.map[field] = Number(value);
  }, 'Map setting changed', `map.${field}`);
}

export async function importGeoJsonScene(controller: AppController, projectId: string, text: string, fileName: string) {
  if (!activeRecord(controller, projectId)) return null;
  if (new TextEncoder().encode(text).byteLength > 2_000_000) throw new Error('GeoJSON must be smaller than 2 MB');
  const scene = parseGeoJsonScene(text, { fileName });
  await saveAndLog(controller, projectId, project => {
    project.map.scene = scene;
    project.map.sceneFile = fileName;
    project.map.source = 'GeoJSON';
    Object.assign(project.map, sceneFit(project.map, scene));
    project.rayResults = null;
    project.map.geometryValidated = false;
    project.map.coordinateAligned = false;
    project.map.materialAssigned = false;
  }, 'GeoJSON footprints loaded', `${fileName} · ${scene.footprints.length} footprints`);
  return { fileName, footprintCount: scene.footprints.length };
}

export async function fitMapToScene(controller: AppController, projectId: string) {
  if (!activeRecord(controller, projectId)) return null;
  return saveAndLog(controller, projectId, project => {
    if (!project.map.scene) throw new Error('Load geometry first');
    Object.assign(project.map, sceneFit(project.map, project.map.scene));
  }, 'Map fitted to geometry', projectId);
}

export async function loadDemoScene(controller: AppController, projectId: string,
  fetcher: typeof fetch = fetch) {
  if (!activeRecord(controller, projectId)) return null;
  const response = await fetcher('/examples/demo-buildings.geojson', { cache: 'no-store' });
  if (!response.ok) throw new Error(`Example file unavailable (${response.status})`);
  const text = await response.text();
  return importGeoJsonScene(controller, projectId, text, 'demo-buildings.geojson');
}
