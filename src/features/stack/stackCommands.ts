import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export type StackEndpoint = 'vCoreEndpoint' | 'vDUEndpoint';
const endpoints: StackEndpoint[] = ['vCoreEndpoint', 'vDUEndpoint'];
type EditableProject = { integration: { vCoreEndpoint: string; vDUEndpoint: string; connected: boolean } };

export function applyStackEndpoint(controller: AppController, projectId: string, endpoint: StackEndpoint | string,
  value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Stack project changed; select the active project before retrying.');
  if (!endpoints.includes(endpoint as StackEndpoint)) return null;
  if (!state.projects.some(item => item.id === projectId)) return null;
  const field = endpoint as StackEndpoint;
  const path = `integration.${field}`;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    project.integration[field] = value;
    project.integration.connected = false;
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Project setting changed', detail: `${path}: ${value}` }) as WorkspaceSnapshot));
}
