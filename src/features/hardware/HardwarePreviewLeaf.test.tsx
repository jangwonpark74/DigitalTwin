import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import HardwarePreviewLeaf from './HardwarePreviewLeaf';

const firstWorkspace = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));
const backupProject = structuredClone(firstWorkspace.projects[0]);
backupProject.id = '22222222-2222-4222-8222-222222222222';
backupProject.name = 'Second hardware pilot';
backupProject.project.name = backupProject.name;
const backupTopology = backupProject.project.management as unknown as { topology: { gh200Pools: { alias: string }[] } };
backupTopology.topology.gh200Pools[0].alias = '<script>alert(1)</script>';
const initialWorkspace = workspaceSchema.parse({ ...firstWorkspace, projects: [firstWorkspace.projects[0], backupProject] });

type Pool = { id: string; alias: string; plannedServers: number };
type HardwareProject = { management: {
  topology: { gh200Pools: Pool[]; links: { id: string; from: string; to: string }[];
    vduServerCount: number | null; switchPortCount: number | null };
  hardware: { id: string; name: string; role: string; alias: string }[];
} };
type HardwareRecord = { id: string; project: HardwareProject; activity: { title: string; detail: string }[] };
const recordsFor = (controller: AppController) =>
  controller.getSnapshot().workspace!.projects as unknown as HardwareRecord[];

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

async function setup() {
  const api = {
    read: vi.fn().mockResolvedValue({ revision: 2, workspace: initialWorkspace }),
    write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1),
  };
  const controller = new AppController(api);
  await controller.hydrate();
  const record = controller.getSnapshot().workspace!.projects[0];
  const onError = vi.fn();
  const view = render(<HardwarePreviewLeaf controller={controller} record={record} onError={onError} />);
  const unsubscribe = controller.subscribe(() => {
    const workspace = controller.getSnapshot().workspace;
    const active = workspace?.projects.find(item => item.id === workspace.activeProjectId);
    if (active) view.rerender(<HardwarePreviewLeaf controller={controller} record={active} onError={onError} />);
  });
  return { api, controller, onError, view, unsubscribe };
}

describe('HardwarePreviewLeaf', () => {
  it('renders transient topology, keeps roving keyboard tabs and makes racks inspectable', async () => {
    const { api } = await setup();
    expect(screen.getByText('No live hardware connected')).toBeTruthy();
    const firstTab = screen.getByRole('tab', { name: 'Fronthaul topology' });
    expect(screen.getByRole('region', { name: /Hardware topology diagram; scroll horizontally/ })).toBeTruthy();
    expect(screen.getByText('Scroll the topology diagram horizontally to inspect all planned links.')).toBeTruthy();
    firstTab.focus();
    fireEvent.keyDown(firstTab, { key: 'ArrowRight' });
    const racksTab = screen.getByRole('tab', { name: 'Rack & server bays' });
    expect(racksTab.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(racksTab);

    const bay = screen.getByRole('button', { name: /GH-POOL-02-S06/ });
    expect(screen.getByRole('region', { name: /Hardware rack elevations; scroll horizontally/ })).toBeTruthy();
    fireEvent.click(bay);
    expect(screen.getByText('SERVER BAY · NO DISCOVERY')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'GH-POOL-02-S06' })).toBeTruthy();
    expect(api.write).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Front elevation/ }));
    expect(screen.getByRole('button', { name: /Isometric view/ }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('tab', { name: 'Fronthaul topology' }));
    const link = screen.getByRole('button', { name: 'Inspect unverified ETH-VDU-FABRIC Ethernet path' });
    fireEvent.keyDown(link, { key: 'Enter' });
    expect(screen.getByText('UNVERIFIED · NOT WIRED')).toBeTruthy();
  });

  it('persists capacity and alias plans, retains focus, and rejects counts above pool limits', async () => {
    const { api, controller, onError } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Capacity & registry' }));
    expect(screen.getByRole('region', { name: /Hardware capacity registry; scroll horizontally/ })).toBeTruthy();
    const count = screen.getByLabelText('Planned server count for GH-POOL-02') as HTMLInputElement;
    count.focus();
    fireEvent.change(count, { target: { value: '3' } });
    fireEvent.blur(count);
    await waitFor(() => expect(recordsFor(controller)[0].project.management.topology.gh200Pools[1].plannedServers).toBe(3));
    expect(screen.getByLabelText('Planned server count for GH-POOL-02')).toBe(count);
    expect(recordsFor(controller)[0].activity[0]).toMatchObject({
      title: 'GH200 pool capacity planned', detail: 'GH-POOL-02',
    });

    const invalid = screen.getByLabelText('Planned server count for GH-POOL-02') as HTMLInputElement;
    fireEvent.change(invalid, { target: { value: '7' } });
    fireEvent.blur(invalid);
    await waitFor(() => expect(onError).toHaveBeenCalledWith('GH200 pool GH-POOL-02 supports up to six planned servers'));
    expect((screen.getByLabelText('Planned server count for GH-POOL-02') as HTMLInputElement).value).toBe('3');
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(recordsFor(controller)[0].activity).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Capacity & registry' }).getAttribute('aria-selected')).toBe('true');
  });

  it('keeps registry state during edits and resets transient selections on project switch', async () => {
    const { controller, view, onError, unsubscribe } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Capacity & registry' }));
    const registry = screen.getByText(/Hardware role registry/).closest('details') as HTMLDetailsElement;
    registry.open = true;
    const root = screen.getByRole('region', { name: 'Hardware preview route' });
    const alias = root.querySelector<HTMLInputElement>('[data-hw-alias="vdu-pool"]')!;
    const previousAlias = alias;
    fireEvent.change(alias, { target: { value: '  vDU planning target  ' } });
    fireEvent.blur(alias);
    await waitFor(() => expect((recordsFor(controller)[0].project.management.hardware[0]).alias)
      .toBe('vDU planning target'));
    expect(screen.getByText(/Hardware role registry/).closest('details')?.open).toBe(true);
    expect(root.querySelector('[data-hw-alias="vdu-pool"]')).toBe(previousAlias);

    fireEvent.click(screen.getByRole('tab', { name: 'Fronthaul topology' }));
    fireEvent.click(screen.getByRole('button', { name: /Inspect Ethernet switch fabric/ }));
    await controller.dispatch(state => activateWorkspaceProject(state, backupProject.id));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Fronthaul topology' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(root.querySelector('[data-hw-node="GH-POOL-01"].selected')).not.toBeNull());
    expect(root.textContent).toContain('<script>alert(1)</script>');
    expect(root.querySelector('script')).toBeNull();
    expect(recordsFor(controller)[1].project.management.hardware[0].alias).not.toBe('vDU planning target');
    view.unmount();
    unsubscribe();
    onError.mockClear();
  });
});
