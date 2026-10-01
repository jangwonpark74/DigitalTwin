import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { validateUseCases } from '../../../usecases.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export type DataField = 'task' | 'sampleBudget' | 'sceneVariants' | 'seeds'
  | 'split.train' | 'split.validation' | 'split.test';
const fields: DataField[] = ['task', 'sampleBudget', 'sceneVariants', 'seeds', 'split.train', 'split.validation', 'split.test'];
type DataConfig = { task: string; sampleBudget: number; sceneVariants: number; seeds: number[];
  split: { train: number; validation: number; test: number } };
type EditableProject = { useCases: { data: DataConfig } };

export function applyDataField(controller: AppController, projectId: string, field: DataField | string,
  value: string): Promise<void> | null {
  const state = controller.getSnapshot().workspace;
  if (!state) return null;
  if (state.activeProjectId !== projectId) throw new Error('Dataset project changed; select the active project before retrying.');
  if (!fields.includes(field as DataField)) return null;
  const record = state.projects.find(item => item.id === projectId);
  if (!record) return null;
  const key = field as DataField;
  const project = record.project as { useCases: { drive: object; ab: object; data: DataConfig } };
  const nextData = structuredClone(project.useCases.data);
  if (key === 'seeds') {
    const tokens = value.trim().split(',').map(seed => seed.trim());
    if (!tokens.every(seed => /^\d+$/.test(seed))) throw new Error('Seeds must be comma-separated nonnegative integers');
    nextData.seeds = tokens.map(Number);
  } else if (key === 'task') nextData.task = value.trim();
  else if (key.startsWith('split.')) {
    const splitKey = key.slice('split.'.length) as keyof DataConfig['split'];
    nextData.split[splitKey] = Number(value);
    if (splitKey === 'test') nextData.split.train = 100 - nextData.split.validation - nextData.split.test;
    else nextData.split.test = 100 - nextData.split.train - nextData.split.validation;
  } else if (key === 'sampleBudget' || key === 'sceneVariants') nextData[key] = Number(value);

  const errors = validateUseCases({ ...project.useCases, data: nextData });
  if (errors.length) throw new Error(errors.find(message => message.startsWith('Unknown AI-RAN')
    || message.startsWith('Data seeds') || message.startsWith('Scene variants')
    || message.startsWith('Sample budget') || message.startsWith('Train/validation/test')) ?? errors[0]);
  if (key === 'seeds' && nextData.seeds.length === project.useCases.data.seeds.length
    && nextData.seeds.every((item, index) => item === project.useCases.data.seeds[index])) return null;
  if (key.startsWith('split.') && nextData.split.train === project.useCases.data.split.train
    && nextData.split.validation === project.useCases.data.split.validation
    && nextData.split.test === project.useCases.data.split.test) return null;
  if ((key === 'task' && nextData.task === project.useCases.data.task)
    || (key === 'sampleBudget' && nextData.sampleBudget === project.useCases.data.sampleBudget)
    || (key === 'sceneVariants' && nextData.sceneVariants === project.useCases.data.sceneVariants)) return null;

  const save = controller.dispatch(workspace => updateWorkspaceProject(workspace, projectId, (editable: EditableProject) => {
    editable.useCases.data = nextData;
  }) as WorkspaceSnapshot);
  return save.then(() => controller.dispatch(workspace => appendWorkspaceLog(workspace, projectId,
    { title: 'Use-case setting changed', detail: `data.${key}` }) as WorkspaceSnapshot));
}
