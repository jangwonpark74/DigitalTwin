import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { addPlannedTask as addPlannedTaskModel } from '../../../tasks.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export type PlannedTaskSpec = { title: string; dueDate: string; priority: string; dependency: string };
type EditableProject = { tasks: { id: string; title: string; category: string; priority: string;
  dueDate: string; dependsOn: string[]; status: string; execution: string }[] };

export function addPlannedTask(controller: AppController, projectId: string, spec: PlannedTaskSpec): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Tasks project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const tasks = addPlannedTaskModel(record.project.tasks as EditableProject['tasks'], {
    title: spec.title, dueDate: spec.dueDate, priority: spec.priority,
    dependsOn: spec.dependency ? [spec.dependency] : [],
  });
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    project.tasks = tasks;
  }) as WorkspaceSnapshot);
  const title = spec.title.trim();
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Task added to plan', detail: title }) as WorkspaceSnapshot));
}
