import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { verifyStudyDigests, stableJson } from '../../../study.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';

export async function mutateStudy(controller: AppController, projectId: string,
  change: (project: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>, title: string) {
  const snapshot = controller.getSnapshot();
  const record = snapshot.workspace?.projects.find(item => item.id === projectId);
  if (!record || snapshot.workspace?.activeProjectId !== projectId) throw new Error('Study project changed. Reopen the active study.');
  if (snapshot.dirty || snapshot.status !== 'ready') throw new Error('Confirm the database save before changing study history.');
  const original = stableJson(record.project);
  const next = await change(structuredClone(record.project));
  await verifyStudyDigests(next.study);
  await controller.dispatch(workspace => {
    const current = workspace.projects.find(item => item.id === projectId);
    if (workspace.activeProjectId !== projectId || !current || stableJson(current.project) !== original) throw new Error('Study inputs changed during preparation. Reopen the latest study and retry.');
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
      Object.assign(project, next);
    }), projectId, { title, detail: 'Versioned offline engineering study; no network operation executed.' }) as WorkspaceSnapshot;
  });
}
