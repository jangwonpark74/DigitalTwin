import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import TaskBoardPreviewLeaf from './TaskBoardPreviewLeaf';

describe('TaskBoardPreviewLeaf', () => {
  it('adds planned work, keeps execution false, and rejects dates before dependencies', async () => {
    const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111',
      now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    render(<TaskBoardPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} />);

    const form = screen.getByRole('form', { name: 'Add a planned task' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Validate antenna patterns' } });
    fireEvent.change(screen.getByLabelText('Task due date'), { target: { value: '2026-12-01' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Depends on' }), { target: { value: 'T-07' } });
    fireEvent.submit(form);
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects[0].project.tasks).toHaveLength(8));
    expect(screen.getByText('Validate antenna patterns')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Task board preview route' }).textContent).toContain('0planned tasks executed');

    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveProperty('value', ''));
    fireEvent.change(screen.getByLabelText('Task due date'), { target: { value: '2000-01-01' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Task title' }), { target: { value: 'Too early' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Depends on' }), { target: { value: 'T-01' } });
    fireEvent.submit(form);
    expect(screen.getByRole('alert').textContent).toContain('Task T-09 scheduled before dependency T-01');
    expect(controller.getSnapshot().workspace!.projects[0].project.tasks).toHaveLength(8);
  });
});
