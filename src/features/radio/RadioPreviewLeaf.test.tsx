import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { RadioSession } from './RadioSession';
import RadioPreviewLeaf from './RadioPreviewLeaf';

const firstWorkspace = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));
type RadioProjectFixture = {
  name: string;
  sites: { name: string; frontEnd: string; radio: { mmuElements: number | null; ruModel: string } }[];
};
type RadioRecordFixture = { id: string; project: RadioProjectFixture; activity: { title: string }[] };
const projectsFor = (controller: AppController) =>
  controller.getSnapshot().workspace!.projects as unknown as RadioRecordFixture[];
const backupProject = structuredClone(firstWorkspace.projects[0]);
backupProject.id = '22222222-2222-4222-8222-222222222222';
backupProject.name = 'Backup radio workspace';
const backupRadioProject = backupProject.project as unknown as RadioProjectFixture;
backupRadioProject.name = backupProject.name;
backupRadioProject.sites[0].name = 'Backup Site';
const initialWorkspace = workspaceSchema.parse({ ...firstWorkspace, projects: [firstWorkspace.projects[0], backupProject] });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

async function setup() {
  const api = {
    read: vi.fn().mockResolvedValue({ revision: 0, workspace: initialWorkspace }),
    write: vi.fn().mockImplementation(async (_workspace: unknown, revision: number) => revision + 1),
  };
  const controller = new AppController(api);
  await controller.hydrate();
  const record = controller.getSnapshot().workspace!.projects[0];
  const session = new RadioSession(record.id, record.project as unknown as { sites: { id: string }[] });
  const onError = vi.fn();
  const onNavigate = vi.fn();
  const view = render(<RadioPreviewLeaf controller={controller} record={record} session={session}
    onError={onError} onNavigate={onNavigate} />);
  return { api, controller, record, session, onError, onNavigate, view };
}

describe('RadioPreviewLeaf', () => {
  it('renders radio planning details and switches the selected site reactively', async () => {
    const { session } = await setup();
    const planner = screen.getByRole('region', { name: 'Radio planner preview route' });
    expect(within(planner).getByRole('heading', { name: 'Radio planner' })).toBeTruthy();
    expect(within(planner).getByText('Radio technology')).toBeTruthy();
    expect(within(planner).getByText('Coordinates not set')).toBeTruthy();
    expect(planner.textContent).toMatch(/compatibility unverified/i);

    const secondSite = within(planner).getByRole('button', { name: /River Bridge/ });
    secondSite.focus();
    fireEvent.click(secondSite);
    expect(session.getSnapshot().selectedSiteId).toBe('SITE-02');
    expect(within(planner).getByRole('button', { name: /River Bridge/ })).toBe(secondSite);
    expect(document.activeElement).toBe(secondSite);
    expect(secondSite.getAttribute('aria-pressed')).toBe('true');
    expect(within(planner).getByLabelText('Array elements')).toBeTruthy();
  });

  it('persists valid radio planning edits and resets rejected values to the saved state', async () => {
    const { api, controller, record, session, onError, onNavigate, view } = await setup();
    const planner = screen.getByRole('region', { name: 'Radio planner preview route' });

    fireEvent.change(within(planner).getByRole('combobox', { name: 'RF front end' }), { target: { value: 'MMU' } });
    await waitFor(() => expect(projectsFor(controller)[0].project.sites[0].frontEnd).toBe('MMU'));
    view.rerender(<RadioPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      session={session} onError={onError} onNavigate={onNavigate} />);
    const elements = within(planner).getByLabelText('Array elements') as HTMLInputElement;
    fireEvent.change(elements, { target: { value: '64' } });
    fireEvent.blur(elements);
    await waitFor(() => expect(projectsFor(controller)[0].project.sites[0].radio.mmuElements).toBe(64));
    view.rerender(<RadioPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      session={session} onError={onError} onNavigate={onNavigate} />);
    expect(projectsFor(controller)[0].activity).toHaveLength(2);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Radio configuration changed', detail: 'SITE-01 · mmuElements',
    });

    const invalid = within(planner).getByLabelText('Array elements') as HTMLInputElement;
    fireEvent.change(invalid, { target: { value: '1025' } });
    fireEvent.blur(invalid);
    await waitFor(() => expect(onError).toHaveBeenLastCalledWith('Invalid MMU element count for SITE-01'));
    expect((within(planner).getByLabelText('Array elements') as HTMLInputElement).value).toBe('64');
    expect(api.write).toHaveBeenCalledTimes(4);
    expect(projectsFor(controller)[0].activity).toHaveLength(2);
    expect(record.id).toBe(controller.getSnapshot().workspace!.activeProjectId);
  });

  it('starts map placement for the selected site and keeps map navigation explicit', async () => {
    const { session, onNavigate } = await setup();
    const planner = screen.getByRole('region', { name: 'Radio planner preview route' });
    fireEvent.click(within(planner).getByRole('button', { name: /Place on map/ }));
    expect(session.getSnapshot().placementSiteId).toBe('SITE-01');
    expect(onNavigate).toHaveBeenCalledWith('map');

    fireEvent.click(within(planner).getByRole('button', { name: 'View map scope' }));
    expect(onNavigate).toHaveBeenLastCalledWith('map');
  });

  it('keeps the site navigation node mounted while project settings update', async () => {
    const { controller, record, session, onError, onNavigate, view } = await setup();
    const siteCard = screen.getByRole('button', { name: /Civic Square/ });
    const planner = screen.getByRole('region', { name: 'Radio planner preview route' });
    fireEvent.change(within(planner).getByRole('combobox', { name: 'RF front end' }), { target: { value: 'MMU' } });
    await waitFor(() => expect(projectsFor(controller)[0].project.sites[0].frontEnd).toBe('MMU'));

    const currentRecord = controller.getSnapshot().workspace!.projects[0];
    expect(currentRecord.id).toBe(record.id);
    // The caller passes its current snapshot on controller updates, as ActivityPreview does.
    view.rerender(<RadioPreviewLeaf controller={controller} record={currentRecord} session={session}
      onError={onError} onNavigate={onNavigate} />);
    expect(screen.getByRole('button', { name: /Civic Square/ })).toBe(siteCard);
  });

  it('follows the active project and persists radio edits only to that project', async () => {
    const { api, controller, session } = await setup();
    await controller.dispatch(workspace => activateWorkspaceProject(workspace, backupProject.id));
    await waitFor(() => expect(session.getSnapshot().projectId).toBe(backupProject.id));
    expect(screen.getByRole('button', { name: /Backup Site/ })).toBeTruthy();

    const input = screen.getByLabelText('RU model / part number') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BACKUP-RU' } });
    fireEvent.blur(input);
    await waitFor(() => expect(projectsFor(controller)[1].project.sites[0].radio.ruModel).toBe('BACKUP-RU'));
    expect(projectsFor(controller)[0].project.sites[0].radio.ruModel).toBe('');
    expect(projectsFor(controller)[1].activity[0].title).toBe('Radio configuration changed');
    expect(api.write).toHaveBeenCalledTimes(3);
  });
});
