import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import { parseDmCsv } from '../../../dm.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { prepareDriveImport } from './driveImport';
import { commitDriveImport, saveCellIdentity } from './driveImportCommands';
import { retainMeasurementDataset } from '../../../measurement-library.mjs';

const csv = 'time_s,technology,serving_cell,latitude,longitude,sinr_db\n0,NR,A,37.5,127,-2\n1,NR,A,37.501,127.001,';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
async function pausedImport() {
  const workspace = workspaceSchema.parse(createWorkspaceState());
  const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockImplementation(async (_: unknown, revision: number) => revision + 1) };
  const controller = new AppController(api); await controller.hydrate();
  const data = await prepareDriveImport({ name: 'incoming.csv', rawCsv: csv, origin: 'unknown', knownCellIds: [] });
  let release!: () => void;
  const hash = vi.fn().mockImplementationOnce((_: unknown, value: ArrayBuffer) => new Promise<ArrayBuffer>(resolve => { release = () => { void webcrypto.subtle.digest('SHA-256', value).then(resolve); }; }))
    .mockImplementation((_: unknown, value: ArrayBuffer) => webcrypto.subtle.digest('SHA-256', value));
  vi.stubGlobal('crypto', { subtle: { digest: hash } });
  const pending = commitDriveImport(controller, workspace.activeProjectId, data.measurements);
  await vi.waitFor(() => expect(hash).toHaveBeenCalled());
  return { controller, pending, release };
}

it('rejects a stale import prepared while another measurement is selected', async () => {
  const { controller, pending, release } = await pausedImport();
  await controller.dispatch(workspace => { workspace.projects[0].project.driveMeasurements = buildDriveMeasurements(parseDmCsv(csv), 'already-selected.csv'); return workspace; });
  release();
  await expect(pending).rejects.toThrow(/Measurement inputs changed/);
  expect(controller.getSnapshot().workspace!.projects[0].project.measurementLibrary).toBeUndefined();
  expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toMatchObject({ fileName: 'already-selected.csv' });
});

it('retains unrelated RF edits made during source hashing', async () => {
  const { controller, pending, release } = await pausedImport();
  await controller.dispatch(workspace => { (workspace.projects[0].project.sites as { heightM: number }[])[0].heightM = 31; return workspace; });
  release(); await pending;
  expect((controller.getSnapshot().workspace!.projects[0].project.sites as { heightM: number }[])[0].heightM).toBe(31);
  expect(controller.getSnapshot().workspace!.projects[0].project.measurementLibrary).toMatchObject({ records: [expect.objectContaining({ version: 1 })] });
});

async function pausedIdentity() {
  const workspace = workspaceSchema.parse(createWorkspaceState());
  workspace.projects[0].project = await retainMeasurementDataset(workspace.projects[0].project, buildDriveMeasurements(parseDmCsv(csv), 'retained.csv'));
  const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockImplementation(async (_: unknown, revision: number) => revision + 1) };
  const controller = new AppController(api); await controller.hydrate();
  let release!: () => void;
  const hash = vi.fn().mockImplementationOnce((_: unknown, value: ArrayBuffer) => new Promise<ArrayBuffer>(resolve => { release = () => { void webcrypto.subtle.digest('SHA-256', value).then(resolve); }; }))
    .mockImplementation((_: unknown, value: ArrayBuffer) => webcrypto.subtle.digest('SHA-256', value));
  vi.stubGlobal('crypto', { subtle: { digest: hash } });
  const id = (workspace.projects[0].project.measurementLibrary as { activeId: string }).activeId;
  const pending = saveCellIdentity(controller, workspace.activeProjectId, id, [{ technology: 'NR', sourceCell: 'A', targetCellId: 'SITE-01-C1' }]);
  await vi.waitFor(() => expect(hash).toHaveBeenCalled());
  return { controller, pending, release };
}

it('rejects an association when the target radio technology changes while hashing', async () => {
  const { controller, pending, release } = await pausedIdentity();
  await controller.dispatch(workspace => { (workspace.projects[0].project.sites as { radio: { technology: string } }[])[0].radio.technology = '4G LTE'; return workspace; });
  release(); await expect(pending).rejects.toThrow(/technology/);
  expect(controller.getSnapshot().workspace!.projects[0].project.measurementLibrary).toMatchObject({ records: [expect.objectContaining({ version: 1 })] });
});

it('keeps unrelated RF edits while saving an identity interpretation', async () => {
  const { controller, pending, release } = await pausedIdentity();
  await controller.dispatch(workspace => { (workspace.projects[0].project.sites as { heightM: number }[])[0].heightM = 31; return workspace; });
  release(); await pending;
  expect((controller.getSnapshot().workspace!.projects[0].project.sites as { heightM: number }[])[0].heightM).toBe(31);
  expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toMatchObject({ cellIdentity: { bindings: [{ targetCellId: 'SITE-01-C1' }] } });
});

it('rejects a stale identity review when the working dataset is cleared', async () => {
  const { controller, pending, release } = await pausedIdentity();
  await controller.dispatch(workspace => { (workspace.projects[0].project.measurementLibrary as { activeId: string | null }).activeId = null; workspace.projects[0].project.driveMeasurements = null; return workspace; });
  release(); await expect(pending).rejects.toThrow(/Working dataset changed/);
  expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toBeNull();
});
