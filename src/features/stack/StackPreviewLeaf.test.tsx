import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import StackPreviewLeaf from './StackPreviewLeaf';

describe('StackPreviewLeaf', () => {
  it('renders the physical-to-virtual boundary and saves endpoint labels without connecting them', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    render(<StackPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} />);

    const route = screen.getByRole('region', { name: 'RAN topology preview route' });
    expect(within(route).getByRole('region', { name: 'RAN architecture diagram' })).toBeTruthy();
    expect(route.querySelectorAll('[data-testid="architecture-block"]')).toHaveLength(6);
    expect(route.textContent).toContain('NOT CONNECTED');
    expect(route.textContent).toContain('Do not enter credentials');

    const core = within(route).getByRole('textbox', { name: 'vCore endpoint label' });
    fireEvent.change(core, { target: { value: 'core-lab' } });
    fireEvent.blur(core);
    await waitFor(() => expect((controller.getSnapshot().workspace!.projects[0].project as { integration: { vCoreEndpoint: string } }).integration.vCoreEndpoint).toBe('core-lab'));
    const du = within(route).getByRole('textbox', { name: 'vDU endpoint label' });
    fireEvent.change(du, { target: { value: 'du-lab' } });
    fireEvent.blur(du);
    await waitFor(() => expect((controller.getSnapshot().workspace!.projects[0].project as { integration: { vDUEndpoint: string } }).integration.vDUEndpoint).toBe('du-lab'));
    expect((controller.getSnapshot().workspace!.projects[0].project as { integration: { connected: boolean } }).integration.connected).toBe(false);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Project setting changed', detail: 'integration.vDUEndpoint: du-lab',
    });
  });
});
