import { beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { saveInventoryIdentity } from './inventoryIdentityCommands';
import { inventoryIdentityToken, type InventoryIdentityDraft, type InventoryIdentity } from './inventoryIdentityTypes';

const workspace = workspaceSchema.parse(createWorkspaceState());
const id = workspace.activeProjectId;
const draft: InventoryIdentityDraft = { technology: 'NR', mcc: '001', mnc: '01', cellId: '0xABC', pci: '0', arfcn: '', carrierName: 'Test carrier', sourceReference: '' };
type Sites = { id: string; cells: { id: string; inventoryIdentity?: InventoryIdentity }[] }[];
const cellAt = (controller: AppController, index = 0) => (controller.getSnapshot().workspace!.projects[0].project.sites as Sites)[0].cells[index];
beforeEach(() => { vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() }); });
async function setup(write = vi.fn().mockImplementation(async (_next: unknown, revision: number) => revision + 1)) {
  const controller = new AppController({ read: vi.fn().mockResolvedValue({ revision: 1, workspace: structuredClone(workspace) }), write });
  await controller.hydrate(); return { controller, write };
}

it('saves one declared identity atomically with its activity and leaves observations and other cells intact', async () => {
  const { controller, write } = await setup(), before = structuredClone(controller.getSnapshot().workspace);
  await saveInventoryIdentity(controller, id, 'SITE-01-C1', 'null', draft);
  expect(cellAt(controller).inventoryIdentity).toMatchObject({ mcc: '001', mnc: '01', cellId: '2748', pci: 0, arfcn: null, verification: 'unverified' });
  expect(write).toHaveBeenCalledTimes(1);
  expect(cellAt(controller, 1)).toEqual((before!.projects[0].project.sites as Sites)[0].cells[1]);
  expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toEqual(before!.projects[0].project.driveMeasurements);
  expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Cell identity declaration saved');
  await saveInventoryIdentity(controller, id, 'SITE-01-C1', inventoryIdentityToken(cellAt(controller).inventoryIdentity), null);
  expect(Object.hasOwn(cellAt(controller), 'inventoryIdentity')).toBe(false);
});

it('rejects stale, missing, duplicate, invalid and inactive-project writes without mutating or persisting', async () => {
  const { controller, write } = await setup();
  await saveInventoryIdentity(controller, id, 'SITE-01-C1', 'null', draft);
  const before = structuredClone(controller.getSnapshot().workspace), count = write.mock.calls.length;
  expect(() => saveInventoryIdentity(controller, id, 'SITE-01-C1', 'null', draft)).toThrow(/changed/);
  expect(() => saveInventoryIdentity(controller, id, 'SITE-01-C2', 'null', draft)).toThrow(/Duplicate/);
  expect(() => saveInventoryIdentity(controller, id, 'SITE-99-C1', 'null', draft)).toThrow(/uniquely/);
  expect(() => saveInventoryIdentity(controller, 'another-project', 'SITE-01-C1', 'null', draft)).toThrow(/project changed/);
  expect(() => saveInventoryIdentity(controller, id, 'SITE-01-C2', 'null', { ...draft, pci: '1008' })).toThrow(/range/);
  expect(controller.getSnapshot().workspace).toEqual(before); expect(write).toHaveBeenCalledTimes(count);
});

it('keeps a failed save as the controller draft and blocks further identity writes until recovery', async () => {
  const { controller, write } = await setup(vi.fn().mockRejectedValue(new Error('SQLite unavailable')));
  await expect(saveInventoryIdentity(controller, id, 'SITE-01-C1', 'null', draft)).rejects.toThrow('SQLite unavailable');
  expect(cellAt(controller).inventoryIdentity?.cellId).toBe('2748');
  expect(controller.getSnapshot()).toMatchObject({ status: 'error', dirty: true });
  expect(() => saveInventoryIdentity(controller, id, 'SITE-01-C2', 'null', draft)).toThrow(/database save/);
  expect(write).toHaveBeenCalledTimes(1);
});
