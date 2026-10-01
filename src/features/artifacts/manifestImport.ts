import { sanitizeProject, upgradeProject, validateProject } from '../../../model.mjs';
import { addWorkspaceProject } from '../../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';

type Manifest = Record<string, unknown>;

export async function importManifestAsProject(controller: AppController, source: unknown, fileName: string) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('Manifest must be a JSON object.');
  const data = source as Manifest;
  const imported = upgradeProject({
    ...data,
    map: data.map,
    runtime: data.runtime,
    integration: data.integration,
    architecture: data.architecture,
    channel: data.channel,
    ue: data.ue,
    sites: data.sites,
    useCases: data.useCaseConfig,
    tasks: data.tasks,
    management: data.management,
    name: data.project,
    scenario: 'baseline',
  });
  const safe = sanitizeProject(imported);
  const errors = validateProject(safe);
  if (errors.length) throw new Error(errors[0]);

  const current = controller.getSnapshot().workspace;
  if (!current) throw new Error('Connect to the local database before importing a manifest.');
  const next = addWorkspaceProject(current, safe, { uniqueName: true });
  const newRecord = next.projects.find((record: { id: string }) => record.id === next.activeProjectId);
  if (!newRecord) throw new Error('Imported project could not be selected.');
  await controller.dispatch(() => next as WorkspaceSnapshot);
  return { id: newRecord.id, name: newRecord.name, project: newRecord.project, fileName };
}
