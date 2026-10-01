import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import SchedulePreviewLeaf from './SchedulePreviewLeaf';

describe('SchedulePreviewLeaf', () => {
  it('shows planned dependencies and restores invalid dates without persisting them', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    render(<SchedulePreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} />);

    const route = screen.getByRole('region', { name: 'Schedule preview route' });
    expect(route.textContent).toContain('Planning calendar only');
    expect(route.textContent).toContain('Prerequisites: T-01');
    const date = screen.getByLabelText('Reschedule T-02');
    fireEvent.change(date, { target: { value: '2000-01-01' } });
    expect(screen.getByRole('alert').textContent).toContain('Task T-02 scheduled before dependency T-01');
    expect((date as HTMLInputElement).value).not.toBe('2000-01-01');
    expect(api.write).not.toHaveBeenCalled();
  });
});
