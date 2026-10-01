import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import DataPreviewLeaf from './DataPreviewLeaf';

describe('DataPreviewLeaf', () => {
  it('keeps generated rows at zero while saving the dataset contract', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const onExport = vi.fn();
    render(<DataPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onExport={onExport} />);

    const route = screen.getByRole('region', { name: 'Dataset generation preview route' });
    expect(route.textContent).toContain('0 ROWS GENERATED');
    expect(route.textContent).toContain('No generated samples');
    fireEvent.change(screen.getByRole('combobox', { name: 'Learning task' }), { target: { value: 'handover-prediction' } });
    await waitFor(() => expect(route.textContent).toContain('requires EM+RAN simulation mode'));
    const train = screen.getByRole('spinbutton', { name: 'Train (%)' });
    fireEvent.change(train, { target: { value: '60' } });
    fireEvent.blur(train);
    await waitFor(() => expect(route.textContent).toContain('6000 / 1500 / 2500'));
    expect(route.textContent).toContain('10,000 / 0');
    fireEvent.click(screen.getByRole('button', { name: /Export dataset job spec/i }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });
});
