import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import AbPreviewLeaf from './AbPreviewLeaf';

describe('AbPreviewLeaf', () => {
  it('shows paired plans without results and persists configuration in the active project', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    render(<AbPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onExport={vi.fn()} />);

    const route = screen.getByRole('region', { name: 'A/B experiment preview route' });
    expect(route.textContent).toContain('NO VERDICT');
    expect(route.textContent).toContain('NOT RUN');
    expect(route.textContent).toContain('same scene/materials');
    const rows = route.querySelectorAll('[data-testid="paired-run"]');
    expect(rows.length).toBeGreaterThan(0);
    const packageB = screen.getByRole('textbox', { name: 'Package B · candidate' });
    fireEvent.change(packageB, { target: { value: 'candidate-2' } });
    fireEvent.blur(packageB);
    await waitFor(() => expect((controller.getSnapshot().workspace!.projects[0].project as {
      useCases: { ab: { packageB: string } } }).useCases.ab.packageB).toBe('candidate-2'));
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Use-case setting changed');
  });
});
