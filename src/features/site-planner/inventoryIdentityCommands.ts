import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import { normalizeInventoryIdentity } from '../../../network-cell-identity.mjs';
import { inventoryIdentityToken, type InventoryIdentity, type InventoryIdentityDraft } from './inventoryIdentityTypes';

export function saveInventoryIdentity(controller: AppController, projectId: string, cellId: string, expected: string, draft: InventoryIdentityDraft | null): Promise<void> {
  const state = controller.getSnapshot();
  if (state.status !== 'ready' || state.dirty) throw new Error('Confirm the database save before editing cell identities.');
  if (state.workspace?.activeProjectId !== projectId) throw new Error('Site planner project changed. Reopen the active project.');
  const identity = draft === null ? null : normalizeInventoryIdentity(draft) as InventoryIdentity;
  return controller.dispatch(workspace => {
    if (workspace.activeProjectId !== projectId) throw new Error('Site planner project changed. Reopen the active project.');
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
      const sites = project.sites as { cells: { id: string; inventoryIdentity?: InventoryIdentity }[] }[];
      const matches = sites.flatMap(site => site.cells.filter(cell => cell.id === cellId));
      if (matches.length !== 1) throw new Error('Cell must resolve uniquely in the current project inventory.');
      const cell = matches[0];
      if (inventoryIdentityToken(cell.inventoryIdentity) !== expected) throw new Error('Cell identity changed. Reset to the current declaration before saving.');
      if (identity === null) delete cell.inventoryIdentity;
      else cell.inventoryIdentity = identity;
    }), projectId, { title: identity ? 'Cell identity declaration saved' : 'Cell identity declaration cleared',
      detail: `${cellId} · manual declaration · unverified` }) as WorkspaceSnapshot;
  });
}
