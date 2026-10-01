import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

type SoftwareProject = { management: { software: { id: string; targetVersion: string }[] } };

/** Save an intended package version while keeping installation state unverified. */
export function applySoftwareVersion(controller: AppController, projectId: string,
  softwareId: string, value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Software project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const software = (record.project.management as SoftwareProject['management']).software;
  const target = software.find(item => item.id === softwareId);
  if (!target) return null;
  const version = value.trim();
  if (!/^[A-Za-z0-9._+-]{1,40}$/.test(version)) throw new Error(`Invalid target version for ${softwareId}`);
  if (version === target.targetVersion) return null;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: SoftwareProject) => {
    project.management.software.find(item => item.id === softwareId)!.targetVersion = version;
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Software target version changed', detail: softwareId }) as WorkspaceSnapshot));
}
