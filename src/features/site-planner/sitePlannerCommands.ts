import { addSite, mapPercentToGeo } from '../../../model.mjs';
import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

const siteFields = ['name', 'heightM', 'frontEnd', 'x', 'y'] as const;
const cellFields = ['azimuthDeg', 'downtiltDeg', 'txPowerDbm', 'bandwidthMhz'] as const;
export type SiteField = typeof siteFields[number];
export type CellField = typeof cellFields[number];
type Site = { id: string; name: string; heightM: number; frontEnd: string; x: number; y: number;
  radioLocation: { latitude: number | null; longitude: number | null; source: string } };
type Cell = { id: string; azimuthDeg: number; downtiltDeg: number; txPowerDbm: number; bandwidthMhz: number };
type EditableProject = { map: { latitude: number; longitude: number; radiusMeters: number }; sites: Array<Site & { cells: Cell[] }> };
type ProjectRecord = { id: string; project: EditableProject };

function activeRecord(controller: AppController, projectId: string) {
  const workspace = controller.getSnapshot().workspace;
  if (!workspace) return null;
  if (workspace.activeProjectId !== projectId)
    throw new Error('Site planner project changed; select the active project before retrying.');
  const record = workspace.projects.find(item => item.id === projectId);
  return record ? { id: record.id, project: record.project as EditableProject } satisfies ProjectRecord : null;
}

function saveAndLog(controller: AppController, projectId: string,
  change: (project: EditableProject) => void, title: string, detail: string): Promise<void> {
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, change) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title, detail }) as WorkspaceSnapshot));
}

/** Allowlisted site fields; x/y retain the legacy map-estimate projection behavior. */
export function applySiteField(controller: AppController, projectId: string, siteId: string,
  field: SiteField, value: string): Promise<void> | null {
  const record = activeRecord(controller, projectId);
  if (!record) return null;
  if (!siteFields.includes(field) || !record.project.sites.some(site => site.id === siteId)) return null;
  return saveAndLog(controller, projectId, project => {
    const site = project.sites.find(item => item.id === siteId)!;
    if (field === 'name') site.name = value.trim();
    else if (field === 'frontEnd') site.frontEnd = value;
    else {
      site[field] = Number(value);
      if (field === 'x' || field === 'y') {
        const coordinates = mapPercentToGeo(project.map, site.x, site.y);
        site.radioLocation = { ...coordinates, source: 'map-estimate' };
      }
    }
  }, 'Site setting changed', `${siteId} · ${field}`);
}

/** Allowlisted cell fields; `updateWorkspaceProject` applies the shared model validator. */
export function applyCellField(controller: AppController, projectId: string, cellId: string,
  field: CellField, value: string): Promise<void> | null {
  const record = activeRecord(controller, projectId);
  if (!record) return null;
  if (!cellFields.includes(field) || !record.project.sites.some(site => site.cells.some(cell => cell.id === cellId))) return null;
  return saveAndLog(controller, projectId, (project) => {
    const cell = project.sites.flatMap(site => site.cells).find(item => item.id === cellId)!;
    cell[field] = Number(value);
  }, 'Cell setting changed', `${cellId} · ${field}`);
}

/** Add a site through the existing domain planner and log only after its project save. */
export function addPlannedSite(controller: AppController, projectId: string,
  location: { name: string; x: number; y: number }): Promise<string> | null {
  const record = activeRecord(controller, projectId);
  if (!record) return null;
  const next = addSite(record.project, location);
  const created = next.sites[next.sites.length - 1];
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId,
    (project: EditableProject) => Object.assign(project, next)) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Site created', detail: created.name }) as WorkspaceSnapshot)).then(() => created.id);
}
