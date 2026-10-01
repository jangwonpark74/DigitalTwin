import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export type UeField = 'count' | 'mobility' | 'seed';
const fields: UeField[] = ['count', 'mobility', 'seed'];
const mobilityProfiles = ['Urban pedestrian', 'Static hotspots', 'Vehicular cluster'];
type EditableProject = { ue: { count: number; mobility: string; seed: number } };

export function applyUeField(controller: AppController, projectId: string, field: UeField | string,
  value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('UE project changed; select the active project before retrying.');
  if (!fields.includes(field as UeField)) return null;
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  if (field === 'count' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 50000))
    throw new Error('Invalid UE count');
  if (field === 'seed' && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 999999))
    throw new Error('Invalid UE seed');
  if (field === 'mobility' && !mobilityProfiles.includes(value)) throw new Error('Invalid UE mobility profile');
  const ueField = field as UeField;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    if (ueField === 'mobility') project.ue.mobility = value;
    else project.ue[ueField] = Number(value);
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Project setting changed', detail: `ue.${field}: ${value}` }) as WorkspaceSnapshot));
}
