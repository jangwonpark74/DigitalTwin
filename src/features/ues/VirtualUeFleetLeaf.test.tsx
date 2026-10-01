import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import VirtualUeFleetLeaf from './VirtualUeFleetLeaf';

describe('VirtualUeFleetLeaf', () => {
  it('saves bounded planned fleet inputs and keeps allocations scoped to the selected project', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const currentUe = () => controller.getSnapshot().workspace?.projects[0].project.ue as
      { count: number; mobility: string; seed: number };
    const selectSite = vi.fn(), onError = vi.fn();
    render(<VirtualUeFleetLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      onSiteSelect={selectSite} onError={onError} />);

    expect(screen.getByText('No UE processes are running in the browser')).toBeTruthy();
    expect(screen.getByText('1,200 PLANNED')).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: 'UE population' }), { target: { value: '2400' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'UE population' }));
    await waitFor(() => expect(currentUe().count).toBe(2400));
    fireEvent.change(screen.getByRole('combobox', { name: 'Mobility profile' }), { target: { value: 'Vehicular cluster' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Reproducibility seed' }), { target: { value: '71' } });
    fireEvent.blur(screen.getByRole('spinbutton', { name: 'Reproducibility seed' }));
    await waitFor(() => expect(currentUe())
      .toMatchObject({ count: 2400, mobility: 'Vehicular cluster', seed: 71 }));
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({
      title: 'Project setting changed', detail: 'ue.seed: 71',
    });
    expect(screen.getAllByText('800 UEs')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /River Bridge.*800 UEs/ }));
    expect(selectSite).toHaveBeenCalledWith('SITE-02');

    const count = screen.getByRole('spinbutton', { name: 'UE population' });
    fireEvent.change(count, { target: { value: '50001' } });
    fireEvent.blur(count);
    expect((await screen.findByRole('alert')).textContent).toContain('Invalid UE count');
    expect((count as HTMLInputElement).value).toBe('2400');
  });
});
