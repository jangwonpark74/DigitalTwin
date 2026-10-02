import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { useState, useSyncExternalStore } from 'react';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import CellInventoryEditor from './CellInventoryEditor';
import type { InventoryIdentity } from './inventoryIdentityTypes';
import { saveInventoryIdentity } from './inventoryIdentityCommands';

const workspace = workspaceSchema.parse(createWorkspaceState());
type Site = { id: string; radio: { technology: string }; cells: { id: string; inventoryIdentity?: InventoryIdentity }[] };
beforeEach(() => vi.stubGlobal('localStorage', { getItem: () => null, setItem: vi.fn() }));
async function setup() {
  const write = vi.fn().mockImplementation(async (_next: unknown, revision: number) => revision + 1);
  const controller = new AppController({ read: vi.fn().mockResolvedValue({ revision: 1, workspace: structuredClone(workspace) }), write });
  await controller.hydrate();
  function Harness() {
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot), [index, setIndex] = useState(0), [hidden, setHidden] = useState(false);
    const record = state.workspace!.projects[0], site = (record.project.sites as Site[])[0];
    return <><button onClick={() => setIndex(value => 1 - value)}>Switch sector</button><button onClick={() => setHidden(value => !value)}>Switch inspector tab</button>
      <CellInventoryEditor controller={controller} projectId={record.id} site={site} cell={site.cells[index]} hidden={hidden} /></>;
  }
  render(<Harness />); fireEvent.click(screen.getByText('Cell identity and carrier'));
  return { controller, write };
}
const fill = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

it('requires explicit save, preserves PLMN zeros, and saves unavailable values as null', async () => {
  const { write } = await setup();
  fill('Cell RAT', 'NR'); fill('MCC', '001'); fill('MNC', '01'); fill('Local cell ID (NCI / ECI)', '0xABC'); fill('PCI', '0');
  fireEvent.blur(screen.getByLabelText('MNC')); expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Save cell declaration' }));
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('SITE-01-C1 declaration saved'));
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0][0].projects[0].project.sites[0].cells[0].inventoryIdentity).toMatchObject({ mcc: '001', mnc: '01', pci: 0, arfcn: null });
});

it('retains drafts across sector and tab changes and rejects a partial PLMN without saving', async () => {
  const { write } = await setup(); fill('Cell RAT', 'NR'); fill('MCC', '001');
  fireEvent.click(screen.getByRole('button', { name: 'Switch sector' })); expect((screen.getByLabelText('MCC') as HTMLInputElement).value).toBe('');
  fill('MCC', '999'); fireEvent.click(screen.getByRole('button', { name: 'Switch sector' })); expect((screen.getByLabelText('MCC') as HTMLInputElement).value).toBe('001');
  fireEvent.click(screen.getByRole('button', { name: 'Switch inspector tab' })); fireEvent.click(screen.getByRole('button', { name: 'Switch inspector tab' }));
  expect((screen.getByLabelText('MCC') as HTMLInputElement).value).toBe('001'); fireEvent.click(screen.getByRole('button', { name: 'Save cell declaration' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('MNC needs 2 or 3 digits')); expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Reset declaration draft' })); expect((screen.getByLabelText('MCC') as HTMLInputElement).value).toBe('');
});

it('keeps rejected database edits visible and requires recovery before another save', async () => {
  const { write } = await setup(); write.mockRejectedValueOnce(new Error('Database offline'));
  fill('Cell RAT', 'NR'); fill('Carrier label', 'Draft carrier'); fireEvent.click(screen.getByRole('button', { name: 'Save cell declaration' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Database offline'));
  expect((screen.getByLabelText('Carrier label') as HTMLInputElement).value).toBe('Draft carrier');
  expect((screen.getByRole('button', { name: 'Save cell declaration' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText(/declaration saved/)).toBeNull();
});

it('exposes stale declarations without overwriting a draft and resets explicitly to current inventory', async () => {
  const { controller } = await setup(); fill('Cell RAT', 'NR'); fill('Carrier label', 'Unsaved personal draft');
  expect(screen.getByText('Unsaved cell declaration')).toBeTruthy();
  await saveInventoryIdentity(controller, workspace.activeProjectId, 'SITE-01-C1', 'null', {
    technology: 'NR', mcc: '', mnc: '', cellId: '', pci: '', arfcn: '', carrierName: 'External declaration', sourceReference: '',
  });
  await waitFor(() => expect(screen.getByText(/current declaration changed/)).toBeTruthy());
  expect((screen.getByLabelText('Carrier label') as HTMLInputElement).value).toBe('Unsaved personal draft');
  expect((screen.getByRole('button', { name: 'Save cell declaration' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Reset declaration draft' }));
  expect((screen.getByLabelText('Carrier label') as HTMLInputElement).value).toBe('External declaration');
  expect(screen.queryByText('Unsaved cell declaration')).toBeNull();
});
