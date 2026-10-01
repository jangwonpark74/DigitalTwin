import { applyScenario } from '../../../model.mjs';
import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

const scenarioLabels = {
  baseline: 'Baseline', blockage: 'Urban blockage',
  'ue-surge': 'UE density surge', 'clear-line': 'Clear line-of-sight',
} as const;

type EditableProject = {
  scenario: string;
  channel: { blockage: number; maxDepth: number };
  ue: { count: number };
};

function saveAndLog(controller: AppController, id: string, change: (project: EditableProject) => void,
  title: string, detail: string): Promise<void> {
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, id, change) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, id,
    { title, detail }) as WorkspaceSnapshot));
}

/** The preset is a domain mutation, never an RT job or a second local workspace. */
export function setMissionControlScenario(controller: AppController, scenario: string): Promise<void> | null {
  if (!Object.prototype.hasOwnProperty.call(scenarioLabels, scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  const id = controller.getSnapshot().workspace?.activeProjectId;
  if (!id) return null;
  return saveAndLog(controller, id, project => {
    Object.assign(project, applyScenario(project, scenario));
  }, 'Scenario selected', scenarioLabels[scenario as keyof typeof scenarioLabels]);
}

/** Only the three controls present on legacy Mission Control are allowed to write. */
export function setMissionControlAssumption(controller: AppController, path: string, value: string): Promise<void> | null {
  if (path !== 'channel.blockage' && path !== 'ue.count' && path !== 'channel.maxDepth') return null;
  const id = controller.getSnapshot().workspace?.activeProjectId;
  if (!id) return null;
  return saveAndLog(controller, id, project => {
    if (path === 'channel.blockage') {
      project.channel.blockage = Number(value);
      project.scenario = 'custom';
    } else if (path === 'ue.count') project.ue.count = Number(value);
    else project.channel.maxDepth = Number(value);
  }, path === 'channel.blockage' ? 'Blockage changed' : 'Project setting changed',
  path === 'channel.blockage' ? `${value}%` : `${path}: ${Number(value)}`);
}
