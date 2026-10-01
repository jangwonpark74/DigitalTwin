import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { validateUseCases } from '../../../usecases.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export type AbField = 'packageA' | 'packageB' | 'seeds' | 'guardrailDropPct' | 'minSinrGainDb';
const fields: AbField[] = ['packageA', 'packageB', 'seeds', 'guardrailDropPct', 'minSinrGainDb'];
type EditableProject = { useCases: { ab: Record<AbField, string | number | number[]> } };

export function applyAbField(controller: AppController, projectId: string, field: AbField | string,
  value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('A/B project changed; select the active project before retrying.');
  if (!fields.includes(field as AbField) || !state.projects.some(item => item.id === projectId)) return null;
  const key = field as AbField;
  const seeds = key === 'seeds' ? value.trim().split(',').map(seed => seed.trim()) : [];
  if (key === 'seeds' && !seeds.every(seed => /^\d+$/.test(seed)))
    throw new Error('Seeds must be comma-separated nonnegative integers');
  const record = state.projects.find(item => item.id === projectId)!;
  const project = record.project as { useCases: { drive: object; ab: Record<AbField, string | number | number[]>; data: object } };
  const nextAb = { ...project.useCases.ab };
  if (key === 'seeds') nextAb.seeds = seeds.map(Number);
  else if (key === 'packageA' || key === 'packageB') nextAb[key] = value.trim();
  else nextAb[key] = Number(value);
  const errors = validateUseCases({ ...project.useCases, ab: nextAb });
  if (errors.length) throw new Error(errors.find(message => message.startsWith('A/B')
    || message.startsWith('Package IDs') || message.startsWith('Guardrail') || message.startsWith('Minimum SINR')) ?? errors[0]);
  const currentValue = project.useCases.ab[key];
  const nextValue = nextAb[key];
  if (Array.isArray(currentValue) && Array.isArray(nextValue)
    ? currentValue.length === nextValue.length && currentValue.every((item, index) => item === nextValue[index])
    : currentValue === nextValue) return null;
  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (project: EditableProject) => {
    if (key === 'seeds') project.useCases.ab.seeds = seeds.map(Number);
    else if (key === 'packageA' || key === 'packageB') project.useCases.ab[key] = value.trim();
    else project.useCases.ab[key] = Number(value);
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Use-case setting changed', detail: `ab.${key}` }) as WorkspaceSnapshot));
}
