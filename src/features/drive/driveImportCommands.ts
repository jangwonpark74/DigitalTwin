import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import type { DriveImportPreview } from './driveImport';
import { measurementInputIdentity, retainMeasurementDataset, selectMeasurementDataset } from '../../../measurement-library.mjs';
import { prepareCellIdentity } from '../../../cell-identity.mjs';
import type { CellIdentityBinding } from './cellIdentityTypes';

export async function commitDriveImport(controller: AppController, projectId: string, measurements: Pick<DriveImportPreview['measurements'], 'fileName' | 'samples'> & { evidence?: { origin: string } }) {
  const snapshot = controller.getSnapshot(), record = snapshot.workspace?.projects.find(item => item.id === projectId);
  if (!record || snapshot.workspace?.activeProjectId !== projectId) throw new Error('Project changed during import review. Reopen the file in the active project.');
  if (snapshot.status !== 'ready' || snapshot.dirty) throw new Error('Confirm the database save before changing measurement datasets.');
  const original = measurementInputIdentity(record.project), next = await retainMeasurementDataset(record.project, measurements);
  await controller.dispatch(workspace => {
    if (workspace.activeProjectId !== projectId) throw new Error('Project changed during import review. Reopen the file in the active project.');
    const current = workspace.projects.find(item => item.id === projectId);
    if (!current || measurementInputIdentity(current.project) !== original) throw new Error('Measurement inputs changed during import preparation. Reopen the latest dataset and retry.');
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId,
      (project: Record<string, unknown>) => { project.driveMeasurements = next.driveMeasurements; project.measurementLibrary = next.measurementLibrary; }), projectId,
    { title: 'DM trace imported', detail: `${measurements.fileName} · ${measurements.samples.length} GPS rows · ${measurements.evidence?.origin ?? 'unknown'} · unverified` }) as WorkspaceSnapshot;
  });
}

export async function selectWorkingMeasurement(controller: AppController, projectId: string, id: string | null) {
  const snapshot = controller.getSnapshot();
  if (snapshot.status !== 'ready' || snapshot.dirty) throw new Error('Confirm the database save before changing measurement datasets.');
  await controller.dispatch(workspace => {
    const current = workspace.projects.find(item => item.id === projectId);
    if (workspace.activeProjectId !== projectId || !current) throw new Error('Measurement project changed. Reopen the active project.');
    const next = selectMeasurementDataset(current.project, id);
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
      project.driveMeasurements = next.driveMeasurements; project.measurementLibrary = next.measurementLibrary;
    }), projectId, { title: id ? 'Working measurement dataset selected' : 'Working measurement selection cleared', detail: id ?? 'Retained history and frozen baselines are unchanged.' }) as WorkspaceSnapshot;
  });
}

export async function retainCurrentMeasurement(controller: AppController, projectId: string) {
  const snapshot = controller.getSnapshot(), record = snapshot.workspace?.projects.find(item => item.id === projectId);
  if (!record?.project.driveMeasurements) throw new Error('No working GPS dataset is available to retain.');
  const original = measurementInputIdentity(record.project), next = await retainMeasurementDataset(record.project, record.project.driveMeasurements);
  if (snapshot.status !== 'ready' || snapshot.dirty) throw new Error('Confirm the database save before changing measurement datasets.');
  await controller.dispatch(workspace => {
    const current = workspace.projects.find(item => item.id === projectId);
    if (workspace.activeProjectId !== projectId || !current || measurementInputIdentity(current.project) !== original) throw new Error('Measurement inputs changed during preparation. Reopen the active project.');
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
      project.driveMeasurements = next.driveMeasurements; project.measurementLibrary = next.measurementLibrary;
    }), projectId, { title: 'Current measurement dataset retained', detail: 'Existing schema and provenance preserved without fabricating a raw source.' }) as WorkspaceSnapshot;
  });
}

export async function saveCellIdentity(controller: AppController, projectId: string, datasetId: string, bindings: CellIdentityBinding[]) {
  const snapshot = controller.getSnapshot(), record = snapshot.workspace?.projects.find(item => item.id === projectId);
  const library = record?.project.measurementLibrary as { activeId: string | null } | undefined;
  if (snapshot.status !== 'ready' || snapshot.dirty) throw new Error('Confirm the database save before reviewing cell identities.');
  if (!record || snapshot.workspace?.activeProjectId !== projectId || library?.activeId !== datasetId)
    throw new Error('Working dataset changed. Reopen cell identity review.');
  const original = measurementInputIdentity(record.project);
  const measurements = prepareCellIdentity(record.project.driveMeasurements, record.project.sites, bindings);
  const next = await retainMeasurementDataset(record.project, measurements);
  await controller.dispatch(workspace => {
    const current = workspace.projects.find(item => item.id === projectId);
    if (workspace.activeProjectId !== projectId || !current || measurementInputIdentity(current.project) !== original)
      throw new Error('Working dataset changed during identity preparation. Reopen the latest dataset.');
    // Revalidate against the latest inventory while preserving unrelated RF edits.
    prepareCellIdentity(current.project.driveMeasurements, current.project.sites, bindings);
    return appendWorkspaceLog(updateWorkspaceProject(workspace, projectId, (project: Record<string, unknown>) => {
      project.driveMeasurements = next.driveMeasurements; project.measurementLibrary = next.measurementLibrary;
    }), projectId, { title: 'Measurement cell identities reviewed', detail: `${bindings.filter(item => item.targetCellId !== null).length} manual associations · source identifiers preserved · unverified` }) as WorkspaceSnapshot;
  });
}
