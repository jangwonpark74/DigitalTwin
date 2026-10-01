import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import ProjectsPreviewLeaf from './ProjectsPreviewLeaf';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('Projects preview leaf', () => {
  it('creates an independent project, opens it, and navigates to Mission Control', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const navigate = vi.fn();
    render(<ProjectsPreviewLeaf controller={controller} onNavigate={navigate} />);
    await user.type(screen.getByRole('textbox', { name: 'Project name' }), 'South pilot');
    await user.type(screen.getByRole('textbox', { name: 'City / location' }), 'Busan');
    await user.type(screen.getByRole('textbox', { name: 'Cluster' }), 'Harbor');
    await user.click(screen.getByRole('button', { name: 'Create project' }));
    expect(await screen.findByText('Project created and opened.')).toBeTruthy();
    expect(controller.getSnapshot().workspace?.projects).toHaveLength(2);
    expect(controller.getSnapshot().workspace?.projects.find(item => item.id === controller.getSnapshot().workspace?.activeProjectId)?.name)
      .toBe('South pilot');
    expect(navigate).toHaveBeenCalledWith('overview');
    expect(screen.getByRole('group', { name: 'Project counts' }).textContent).toContain('2');
  });
});
