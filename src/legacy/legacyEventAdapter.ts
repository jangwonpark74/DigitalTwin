import { appendWorkspaceLog, updateWorkspaceProject } from '../../workspaces.mjs';
import type { AppController } from '../app/AppController';
import type { WorkspaceSnapshot } from '../api/schemas';
import { applyStackEndpoint } from '../features/stack/stackCommands';
import { applyUeField, type UeField } from '../features/ues/uesCommands';
import { applyAbField } from '../features/use-cases/abCommands';
import { applyDataField } from '../features/use-cases/dataCommands';
import { applyScheduleDate } from '../features/tasks/scheduleCommands';
import { applySoftwareVersion } from '../features/software/softwareCommands';
import { applyMonitoringThreshold } from '../features/monitoring/monitoringCommands';
import { addPlannedTask as addProjectTask } from '../features/tasks/taskCommands';

type EditableProject = {
  tasks: { id: string; dueDate: string }[];
  ue: { count: number; mobility: string; seed: number };
  useCases: { ab: { packageA: string; packageB: string; seeds: number[];
    guardrailDropPct: number; minSinrGainDb: number };
    data: { task: string; sampleBudget: number; sceneVariants: number; seeds: number[];
      split: { train: number; validation: number; test: number } };
    drive: { route: string; samples: number; speedKph: number } };
  integration: { vCoreEndpoint: string; vDUEndpoint: string; connected: boolean };
};

// Scoped legacy intents enter one controller queue; unrecognized attributes never mutate a project.
// Domain validation can throw synchronously so the caller can restore the rejected DOM input.
export function applyLegacyField(controller: AppController, path: string, value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  const id = state.activeProjectId;
  if (path.startsWith('ab.')) return applyAbField(controller, id, path.slice('ab.'.length), value);
  if (path.startsWith('data.')) return applyDataField(controller, id, path.slice('data.'.length), value);
  if (path.startsWith('schedule.')) return applyScheduleDate(controller, id, path.slice('schedule.'.length), value);
  const endpoint = path === 'integration.vCoreEndpoint' ? 'vCoreEndpoint'
    : path === 'integration.vDUEndpoint' ? 'vDUEndpoint' : null;
  if (endpoint) return applyStackEndpoint(controller, id, endpoint, value);
  const ueField = path === 'ue.count' ? 'count' : path === 'ue.mobility' ? 'mobility'
    : path === 'ue.seed' ? 'seed' : null;
  if (ueField) return applyUeField(controller, id, ueField as UeField, value);
  const candidate = path.startsWith('monitoring.') ? path.slice('monitoring.'.length) : '';
  if (candidate) return applyMonitoringThreshold(controller, id, candidate, value);
  const softwareCandidate = path.startsWith('software.') ? path.slice('software.'.length) : '';
  if (softwareCandidate) return applySoftwareVersion(controller, id, softwareCandidate, value);
  const driveKey = path === 'drive.route' ? 'route' : path === 'drive.samples' ? 'samples'
    : path === 'drive.speedKph' ? 'speedKph' : null;
  if (!driveKey) return null;

  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, id, (project: EditableProject) => {
    if (driveKey === 'route') project.useCases.drive.route = value.trim();
    else if (driveKey) project.useCases.drive[driveKey] = Number(value);
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, id,
    { title: 'Use-case setting changed', detail: path }) as WorkspaceSnapshot));
}

export function addLegacyTask(controller: AppController, spec: {
  title: string; dueDate: string; priority: string; dependency: string;
}): Promise<void> | null {
  const id = controller.getSnapshot().workspace?.activeProjectId;
  if (!id) return null;
  return addProjectTask(controller, id, spec);
}
