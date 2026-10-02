import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { SitePlannerSession } from './SitePlannerSession';
import SitePlannerPreviewLeaf from './SitePlannerPreviewLeaf';
import type { SceneLoader } from './OpenSiteScene';

const projectId = '11111111-1111-4111-8111-111111111111';
const initialWorkspace = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: projectId, now: () => '2026-01-01T00:00:00Z',
}));
const activeProject = (controller: AppController) => controller.getSnapshot().workspace!.projects[0].project as {
  sites: Array<{ name: string; heightM: number; cells: Array<{ azimuthDeg: number }> }>;
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

const mockSceneLoader: SceneLoader = async () => () => ({ update: vi.fn(), setCamera: vi.fn(), destroy: vi.fn() });
async function setup(sceneLoader: SceneLoader = mockSceneLoader) {
  const api = {
    read: vi.fn().mockResolvedValue({ revision: 0, workspace: initialWorkspace }),
    write: vi.fn().mockImplementation(async (_workspace: unknown, revision: number) => revision + 1),
  };
  const controller = new AppController(api);
  await controller.hydrate();
  const record = controller.getSnapshot().workspace!.projects[0];
  const session = new SitePlannerSession(record.id, record.project as unknown as { sites: { id: string; cells: { id: string }[] }[] });
  const view = render(<SitePlannerPreviewLeaf controller={controller} record={record} session={session}
    onError={vi.fn()} onNavigate={vi.fn()} sceneLoader={sceneLoader} />);
  return { api, controller, session, view };
}

describe('SitePlannerPreviewLeaf', () => {
  it('restores a cleared required sector value instead of saving it as zero', async () => {
    const { api, controller } = await setup();
    fireEvent.click(screen.getByRole('tab', { name: /SITE-01-C2/ }));
    fireEvent.click(screen.getByRole('tab', { name: 'Antenna' }));
    const azimuth = screen.getByLabelText('Azimuth (°)') as HTMLInputElement;
    const original = activeProject(controller).sites[0].cells[1].azimuthDeg;
    fireEvent.change(azimuth, { target: { value: '' } }); fireEvent.blur(azimuth);
    expect((await screen.findByRole('alert')).textContent).toContain('requires a number');
    expect(azimuth.value).toBe(String(original));
    expect(api.write).not.toHaveBeenCalled();
    fireEvent.change(azimuth, { target: { value: '0' } }); fireEvent.blur(azimuth);
    await waitFor(() => expect(activeProject(controller).sites[0].cells[1].azimuthDeg).toBe(0));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });
  it('uses one inspector for position, radio, antenna and topology without changing the selected sector', async () => {
    const { controller, session } = await setup();
    expect(screen.getByRole('heading', { name: 'Sites and Cells' })).toBeTruthy();
    const tabs = screen.getByRole('tablist', { name: 'Site inspector' });
    expect(within(tabs).getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Summary', 'Position', 'RF', 'Antenna', 'Topology']);
    fireEvent.click(screen.getByRole('tab', { name: /SITE-01-C2/ }));
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Position' }));
    const center = controller.getSnapshot().workspace!.projects[0].project.map as { latitude: number; longitude: number };
    const targetLongitude = center.longitude + .0001;
    const latitude = screen.getByLabelText('Latitude');
    fireEvent.change(latitude, { target: { value: String(center.latitude) } }); fireEvent.blur(latitude);
    const longitude = screen.getByLabelText('Longitude');
    fireEvent.change(longitude, { target: { value: String(targetLongitude) } }); fireEvent.blur(longitude);
    await waitFor(() => expect((activeProject(controller).sites[0] as unknown as { radioLocation: { longitude: number } }).radioLocation.longitude).toBe(targetLongitude));
    const position = within(tabs).getByRole('tab', { name: 'Position' });
    position.focus();
    fireEvent.keyDown(position, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(within(tabs).getByRole('tab', { name: 'RF' }));
    expect(screen.getByLabelText('RU model / part number')).toBeTruthy();
    expect(screen.queryByLabelText('Latitude')).toBeNull();
    fireEvent.click(within(tabs).getByRole('tab', { name: 'Antenna' }));
    expect(screen.getByLabelText('Azimuth (°)')).toBeTruthy();
    expect(session.getSnapshot().selectedCellId).toBe('SITE-01-C2');
    fireEvent.keyDown(within(tabs).getByRole('tab', { name: 'Antenna' }), { key: 'End' });
    expect(document.activeElement).toBe(within(tabs).getByRole('tab', { name: 'Topology' }));
    expect(screen.getByText(/Topology relationships remain unverified/)).toBeTruthy();
  });
  it('opens the geographic map in 2D and keeps an accessible site and sector inventory in 3D', async () => {
    const sceneLoader = vi.fn(async () => () => ({ update: vi.fn(), setCamera: vi.fn(), destroy: vi.fn() }));
    const { session } = await setup(sceneLoader);
    await waitFor(() => expect(sceneLoader).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('button', { name: '2D map' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.setup().click(screen.getByRole('button', { name: '3D scene' }));
    const alternative = screen.getByRole('complementary', { name: '3D scene site and sector list' });
    expect(alternative.textContent).toContain('Geographic coordinates not set');
    expect(alternative.textContent).toContain('SITE-01-C1 0° sector');
    await userEvent.setup().click(within(alternative).getByRole('button', { name: /SITE-02/ }));
    expect(session.getSnapshot().selectedSiteId).toBe('SITE-02');
  });

  it('searches and filters site inventory without altering project configuration', async () => {
    const { api, controller } = await setup();
    const before = structuredClone(activeProject(controller));
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search sites' }), { target: { value: 'River' } });
    const list = screen.getByRole('group', { name: 'Select a site' });
    expect(within(list).getAllByRole('button')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Positioned' }));
    expect(within(list).getByText('No sites match these filters.')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: 'Clear filters' }));
    expect(within(list).getAllByRole('button')).toHaveLength(3);
    expect(activeProject(controller)).toEqual(before);
    expect(api.write).not.toHaveBeenCalled();
  });

  it('selects a site and cell, persists validated edits, and adds a domain-default site', async () => {
    const user = userEvent.setup();
    const { api, controller, session } = await setup();
    const planner = screen.getByRole('region', { name: 'Site & cell planner preview route' });
    expect((within(planner).getByLabelText('Site name') as HTMLInputElement).value).toBe('Civic Square');
    const siteName = within(planner).getByLabelText('Site name');
    await user.clear(siteName);
    await user.type(siteName, 'Central Hub');
    fireEvent.blur(siteName);
    await waitFor(() => expect(activeProject(controller).sites[0].name).toBe('Central Hub'));
    const firstSector = within(planner).getByRole('tab', { name: /SITE-01-C1/ });
    firstSector.focus();
    fireEvent.keyDown(firstSector, { key: 'ArrowRight' });
    expect(session.getSnapshot().selectedCellId).toBe('SITE-01-C2');
    expect(document.activeElement).toBe(within(planner).getByRole('tab', { name: /SITE-01-C2/ }));

    await user.click(within(planner).getByRole('button', { name: /SITE-02/ }));
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: 'SITE-02', selectedCellId: 'SITE-02-C1' });
    await user.click(within(planner).getByRole('tab', { name: /SITE-02-C2/ }));
    expect(session.getSnapshot().selectedCellId).toBe('SITE-02-C2');

    await user.click(within(planner).getByRole('tab', { name: 'Antenna' }));
    const azimuth = within(planner).getByLabelText('Azimuth (°)');
    await user.clear(azimuth);
    await user.type(azimuth, '221');
    fireEvent.blur(azimuth);
    await waitFor(() => expect(activeProject(controller).sites[1].cells[1].azimuthDeg).toBe(221));
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Cell setting changed', detail: 'SITE-02-C2 · azimuthDeg',
    });

    const addForm = within(planner).getByRole('form', { name: 'Add planned site' });
    await user.type(within(addForm).getByLabelText('New site name'), 'North Tower');
    await user.clear(within(addForm).getByLabelText('New site X position (%)'));
    await user.type(within(addForm).getByLabelText('New site X position (%)'), '43');
    await user.clear(within(addForm).getByLabelText('New site Y position (%)'));
    await user.type(within(addForm).getByLabelText('New site Y position (%)'), '49');
    await user.click(within(addForm).getByRole('button', { name: 'Add site' }));
    await waitFor(() => expect(activeProject(controller).sites).toHaveLength(4));
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: 'SITE-04', selectedCellId: 'SITE-04-C1' });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({ title: 'Site created', detail: 'North Tower' });
    expect(api.write).toHaveBeenCalled();
  });

  it('supports marker selection and restores an invalid draft to the validated project value', async () => {
    const { controller } = await setup();
    const planner = screen.getByRole('region', { name: 'Site & cell planner preview route' });
    fireEvent.click(within(planner).getByRole('button', { name: 'Select River Bridge site SITE-02' }));
    expect((screen.getByLabelText('Site name') as HTMLInputElement).value).toBe('River Bridge');

    fireEvent.click(within(planner).getByRole('tab', { name: 'Position' }));
    const height = within(planner).getByLabelText('Height (m)');
    fireEvent.change(height, { target: { value: '0' } });
    fireEvent.blur(height);
    expect((await screen.findByRole('alert')).textContent).toMatch(/Invalid height for SITE-02/);
    await waitFor(() => expect(activeProject(controller).sites[1].heightM).toBe(36));
    expect((within(planner).getByLabelText('Height (m)') as HTMLInputElement).value).toBe('36');
  });
});
