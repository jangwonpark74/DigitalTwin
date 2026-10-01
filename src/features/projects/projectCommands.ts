import { defaultProject } from '../../../model.mjs';
import { activateWorkspaceProject, addWorkspaceProject, appendWorkspaceLog, archiveWorkspaceProject,
  deleteArchivedWorkspaceProject, duplicateWorkspaceProject, renameWorkspaceProject,
  restoreArchivedWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

type ProjectSpec = { name: string; city: string; cluster: string };

export function createProject(controller: AppController, spec: ProjectSpec): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  const name = spec.name.trim(), city = spec.city.trim(), cluster = spec.cluster.trim();
  if (!city) throw new Error('City / location is required');
  if (!cluster) throw new Error('Cluster is required');
  const project = defaultProject() as { name: string; map: { city: string; cluster: string } };
  project.name = name;
  project.map.city = city;
  project.map.cluster = cluster;
  return controller.dispatch(workspace => {
    const next = addWorkspaceProject(workspace, project, { activate: true }) as WorkspaceSnapshot;
    return appendWorkspaceLog(next, next.activeProjectId, { title: 'Project created', detail: `${city} · ${cluster}` }) as WorkspaceSnapshot;
  });
}

export function openProject(controller: AppController, projectId: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  return controller.dispatch(workspace => {
    const next = activateWorkspaceProject(workspace, projectId) as WorkspaceSnapshot;
    const project = next.projects.find(item => item.id === projectId)!;
    return appendWorkspaceLog(next, projectId, { title: 'Project opened', detail: project.name }) as WorkspaceSnapshot;
  });
}

export function renameProject(controller: AppController, projectId: string, name: string): Promise<void> | null {
  if (!controller.getSnapshot().workspace) return null;
  return controller.dispatch(workspace => {
    const next = renameWorkspaceProject(workspace, projectId, name) as WorkspaceSnapshot;
    return appendWorkspaceLog(next, projectId, { title: 'Project renamed', detail: next.projects.find(item => item.id === projectId)!.name }) as WorkspaceSnapshot;
  });
}

export function duplicateProject(controller: AppController, projectId: string): Promise<void> | null {
  if (!controller.getSnapshot().workspace) return null;
  return controller.dispatch(workspace => {
    const next = duplicateWorkspaceProject(workspace, projectId) as WorkspaceSnapshot;
    const project = next.projects.find(item => item.id === next.activeProjectId)!;
    return appendWorkspaceLog(next, project.id, { title: 'Project duplicated', detail: `${project.name} · independent local copy` }) as WorkspaceSnapshot;
  });
}

export function archiveProject(controller: AppController, projectId: string): Promise<void> | null {
  if (!controller.getSnapshot().workspace) return null;
  return controller.dispatch(workspace => {
    const name = workspace.projects.find(item => item.id === projectId)?.name ?? projectId;
    const next = archiveWorkspaceProject(workspace, projectId) as WorkspaceSnapshot;
    return appendWorkspaceLog(next, projectId, { title: 'Project archived', detail: name }) as WorkspaceSnapshot;
  });
}

export function restoreProject(controller: AppController, projectId: string): Promise<void> | null {
  if (!controller.getSnapshot().workspace) return null;
  return controller.dispatch(workspace => {
    const next = restoreArchivedWorkspaceProject(workspace, projectId) as WorkspaceSnapshot;
    return appendWorkspaceLog(next, projectId, { title: 'Project restored', detail: next.projects.find(item => item.id === projectId)!.name }) as WorkspaceSnapshot;
  });
}

export function deleteProject(controller: AppController, projectId: string): Promise<void> | null {
  if (!controller.getSnapshot().workspace) return null;
  return controller.dispatch(workspace => deleteArchivedWorkspaceProject(workspace, projectId) as WorkspaceSnapshot);
}
