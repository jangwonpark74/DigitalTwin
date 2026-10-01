import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export const thresholdIds = ['gpuUtilizationPct', 'gpuMemoryPct', 'cpuUtilizationPct', 'fronthaulLatencyMs'] as const;
export type ThresholdId = typeof thresholdIds[number];
type EditableProject = { management: { monitoring: { thresholds: Record<ThresholdId, number> } } };

/** Edit a planned alert threshold without connecting a telemetry collector. */
export function applyMonitoringThreshold(controller: AppController, projectId: string,
  field: ThresholdId | string, value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Monitoring project changed; select the active project before retrying.');
  if (!thresholdIds.includes(field as ThresholdId)) return null;
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const key = field as ThresholdId;
  const number = Number(value);
  const max = key === 'fronthaulLatencyMs' ? 500 : 100;
  if (!Number.isFinite(number) || number < 1 || number > max) throw new Error(`Invalid monitoring threshold ${key}`);
  const management = record.project.management as EditableProject['management'];
  if (management.monitoring.thresholds[key] === number) return null;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    project.management.monitoring.thresholds[key] = number;
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Monitoring threshold changed', detail: key }) as WorkspaceSnapshot));
}
