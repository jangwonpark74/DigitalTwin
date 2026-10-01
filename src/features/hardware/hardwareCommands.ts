import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

type HardwareField = { kind: 'poolAlias' | 'poolCount' | 'hardwareAlias'; id: string }
  | { kind: 'vduCount' | 'switchCount' };
type EditableProject = { management: { hardware: { id: string; alias: string }[];
  topology: { gh200Pools: { id: string; alias: string; plannedServers: number }[];
    vduServerCount: number | null; switchPortCount: number | null } } };

/** Explicit hardware form intents enter the single workspace save queue, never transient selection state. */
export function applyHardwareField(controller: AppController, projectId: string,
  field: HardwareField, value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Hardware project changed; select the active project before retrying.');
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const management = record.project.management as EditableProject['management'];
  const id = 'id' in field ? field.id : null;
  const pool = id && management.topology.gh200Pools.some(item => item.id === id) ? id : null;
  const asset = id && management.hardware.some(item => item.id === id) ? id : null;
  if ((field.kind === 'poolAlias' || field.kind === 'poolCount') && !pool) return null;
  if (field.kind === 'hardwareAlias' && !asset) return null;
  if (!['poolAlias', 'poolCount', 'hardwareAlias', 'vduCount', 'switchCount'].includes(field.kind)) return null;
  const title = field.kind === 'poolAlias' ? 'GH200 pool renamed'
    : field.kind === 'poolCount' ? 'GH200 pool capacity planned'
      : field.kind === 'hardwareAlias' ? 'Hardware target renamed' : 'Physical capacity target changed';
  const detail = id ?? (field.kind === 'vduCount' ? 'vdu' : 'switch');
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    const topology = project.management.topology;
    if (field.kind === 'poolAlias') topology.gh200Pools.find(item => item.id === pool)!.alias = value.trim();
    else if (field.kind === 'poolCount') topology.gh200Pools.find(item => item.id === pool)!.plannedServers = Number(value);
    else if (field.kind === 'hardwareAlias') project.management.hardware.find(item => item.id === asset)!.alias = value.trim();
    else if (field.kind === 'vduCount') topology.vduServerCount = value === '' ? null : Number(value);
    else if (field.kind === 'switchCount') topology.switchPortCount = value === '' ? null : Number(value);
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title, detail }) as WorkspaceSnapshot));
}
