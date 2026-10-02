import { geoToMapPercent, mapPercentToGeo } from '../../../model.mjs';
import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

const configFields = ['technology', 'ruModel', 'band', 'mmuModel', 'mmuElements', 'beamformingProfile'] as const;
export type RadioConfigField = typeof configFields[number];
export type RadioField = { kind: 'config'; siteId: string; prop: RadioConfigField }
  | { kind: 'location'; siteId: string; prop: 'latitude' | 'longitude' }
  | { kind: 'frontEnd'; siteId: string };
type Radio = { technology: string; ruModel: string; band: string; mmuModel: string;
  mmuElements: number | null; beamformingProfile: string };
type Site = { id: string; frontEnd: string; radio: Radio;
  radioLocation: { latitude: number | null; longitude: number | null; source: string }; x: number; y: number };
type EditableProject = { map: { latitude: number; longitude: number; radiusMeters: number }; sites: Site[] };

/** Scoped radio form intents; the domain validator and AppController remain the save authority. */
export function applyRadioField(controller: AppController, projectId: string,
  field: RadioField, value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Radio project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const sites = record.project.sites as Site[];
  if (!sites.some(site => site.id === field.siteId)) return null;
  if (field.kind === 'config' && !configFields.includes(field.prop)) return null;
  if (field.kind === 'location' && field.prop !== 'latitude' && field.prop !== 'longitude') return null;
  if (field.kind !== 'config' && field.kind !== 'location' && field.kind !== 'frontEnd') return null;
  const title = field.kind === 'config' ? 'Radio configuration changed'
    : field.kind === 'location' ? 'Radio coordinates changed' : 'Radio front end changed';
  const detail = `${field.siteId} · ${field.kind === 'frontEnd' ? value : field.prop}`;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    const site = project.sites.find(item => item.id === field.siteId)!;
    if (field.kind === 'config') {
      if (field.prop === 'mmuElements') site.radio.mmuElements = value === '' ? null : Number(value);
      else site.radio[field.prop] = value.trim();
    } else if (field.kind === 'frontEnd') site.frontEnd = value;
    else {
      site.radioLocation[field.prop] = value === '' ? null : Number(value);
      const location = site.radioLocation;
      location.source = location.latitude === null && location.longitude === null ? 'unassigned' : 'manual';
      if (Number.isFinite(location.latitude) && Number.isFinite(location.longitude))
        Object.assign(site, geoToMapPercent(project.map, location.latitude, location.longitude));
    }
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title, detail }) as WorkspaceSnapshot));
}

/** Persist a schematic-map placement while retaining its estimated-coordinate provenance. */
export function placeRadioOnMap(controller: AppController, projectId: string, siteId: string,
  position: { x: number; y: number }): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Radio project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const project = record.project as EditableProject;
  if (!project.sites.some(site => site.id === siteId)) return null;
  const coordinates = mapPercentToGeo(project.map, position.x, position.y);
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (draft: EditableProject) => {
    const site = draft.sites.find(item => item.id === siteId);
    if (!site) throw new Error('Radio site no longer exists');
    site.x = position.x;
    site.y = position.y;
    site.radioLocation = { ...coordinates, source: 'map-estimate' };
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Radio location placed on map',
      detail: `${siteId} · ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)}` }) as WorkspaceSnapshot));
}

/** A click on the geographic basemap supplies WGS84 coordinates directly. */
export function placeRadioAtCoordinates(controller: AppController, projectId: string, siteId: string,
  coordinates: { latitude: number; longitude: number }): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Radio project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record || !(record.project.sites as Site[]).some(site => site.id === siteId)) return null;
  if (!Number.isFinite(coordinates.latitude) || !Number.isFinite(coordinates.longitude) ||
    Math.abs(coordinates.latitude) > 85.051129 || Math.abs(coordinates.longitude) > 180) throw new Error('Enter valid WGS84 map coordinates.');
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (draft: EditableProject) => {
    const site = draft.sites.find(item => item.id === siteId)!;
    Object.assign(site, geoToMapPercent(draft.map, coordinates.latitude, coordinates.longitude));
    site.radioLocation = { ...coordinates, source: 'manual' };
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Radio location placed on map', detail: `${siteId} · ${coordinates.latitude.toFixed(6)}, ${coordinates.longitude.toFixed(6)} · WGS84 map selection` }) as WorkspaceSnapshot));
}
