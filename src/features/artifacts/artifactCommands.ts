import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { applyArtifactJson, isEditableJsonArtifact } from '../../../artifacts.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';

export async function saveArtifactJson(controller: AppController, projectId: string, artifactId: string,
  original: string, source: string) {
  if (!isEditableJsonArtifact(artifactId)) throw new Error('This report is generated from the project and cannot be edited here.');
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Artifact project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const current = controller.getSnapshot().artifacts.data?.find(file => file.id === artifactId);
  if (!current || current.content !== original) throw new Error('This file changed while you were editing it. Refresh and reopen it to use the latest version.');
  const next = applyArtifactJson(record.project, artifactId, source);
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
    for (const key of Object.keys(project)) delete project[key];
    Object.assign(project, structuredClone(next));
  }) as WorkspaceSnapshot);
  await save;
  await controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'JSON artifact saved', detail: artifactId }) as WorkspaceSnapshot);
  await controller.refreshArtifacts();
  return true;
}
