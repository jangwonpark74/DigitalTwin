import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { rescheduleTask } from '../../../tasks.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

type EditableProject = { tasks: { id: string; dueDate: string; dependsOn: string[]; title: string;
  category: string; priority: string; status: string; execution: string }[] };

export function applyScheduleDate(controller: AppController, projectId: string, taskId: string,
  dueDate: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Schedule project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const tasks = record.project.tasks as EditableProject['tasks'];
  const current = tasks.find(task => task.id === taskId);
  if (!current) return null;
  if (current.dueDate === dueDate) return null;
  const nextTasks = rescheduleTask(tasks, taskId, dueDate);
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    project.tasks = nextTasks;
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Task date changed', detail: `${taskId} → ${dueDate}` }) as WorkspaceSnapshot));
}
