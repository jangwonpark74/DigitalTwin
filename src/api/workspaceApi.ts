import { workspaceArtifactIndex, } from '../../artifacts.mjs';
import { validateWorkspaceState } from '../../workspaces.mjs';
import { verifyStudyDigests } from '../../study.mjs';
import { verifyProjectDriveEvidence } from '../../drive-measurements.mjs';
import { verifyMeasurementLibrary } from '../../measurement-library.mjs';
import { parseWorkspaceEnvelope, saveConfirmationSchema, type WorkspaceSnapshot } from './schemas';

export class WorkspaceConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceConflictError';
  }
}

async function jsonResponse(response: Response, fallback: string): Promise<unknown> {
  try { return await response.json() as unknown; }
  catch { throw new Error(fallback); }
}

function serverError(value: unknown, fallback: string): string {
  return value && typeof value === 'object' && 'error' in value && typeof value.error === 'string'
    ? value.error : fallback;
}

export async function readWorkspace(fetcher: typeof fetch = fetch) {
  const response = await fetcher('/api/workspace', { cache: 'no-store' });
  const data = await jsonResponse(response, 'The database API did not return JSON. Restart make run with the updated server.');
  if (!response.ok) throw new Error(serverError(data, `Database request failed (${response.status})`));
  const envelope = parseWorkspaceEnvelope(data);
  for (const record of envelope.workspace?.projects ?? []) { await verifyStudyDigests(record.project.study); await verifyProjectDriveEvidence(record.project); await verifyMeasurementLibrary(record.project); }
  return envelope;
}

export async function writeWorkspace(workspace: WorkspaceSnapshot, revision: number, fetcher: typeof fetch = fetch) {
  const errors = validateWorkspaceState(workspace as Parameters<typeof validateWorkspaceState>[0]);
  if (errors.length) throw new Error(errors[0]);
  for (const record of workspace.projects) { await verifyStudyDigests(record.project.study); await verifyProjectDriveEvidence(record.project); await verifyMeasurementLibrary(record.project); }
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error('Invalid workspace revision');
  const response = await fetcher('/api/workspace', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision, workspace, artifacts: workspaceArtifactIndex(workspace as Parameters<typeof workspaceArtifactIndex>[0]) }),
  });
  const data = await jsonResponse(response, 'The database did not confirm this save.');
  if (!response.ok) {
    const message = serverError(data, `Database save failed (${response.status})`);
    if (response.status === 409) throw new WorkspaceConflictError(message);
    throw new Error(message);
  }
  return saveConfirmationSchema.parse(data).revision;
}
