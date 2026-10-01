import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import MissionControlPage from './MissionControlPage';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const first = workspaceSchema.parse(createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }));
const second = structuredClone(first.projects[0]);
second.id = secondId;
second.name = 'Another plan';
second.project.name = second.name;
(second.project.sites as { name: string }[])[0].name = 'Another site';
const workspace = workspaceSchema.parse({ ...first, projects: [first.projects[0], second] });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('Mission Control controller-owned composition (not yet routed)', () => {
  it('combines map, metrics, scenarios and workflows without a second save owner', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const onNavigate = vi.fn();
    render(<MissionControlPage controller={controller} onNavigate={onNavigate} />);
    expect(screen.getAllByRole('heading', { name: '5G RAN twin mission control' })).toHaveLength(1);
    expect(screen.getByRole('region', { name: 'Operational use cases' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'End-to-end twin boundary' }).textContent).toContain('CHANNEL · PLANNED');
    expect(screen.getByRole('region', { name: 'Quick scenarios' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Planning next actions' })).getAllByRole('button')).toHaveLength(4);
    const order = [
      screen.getByRole('heading', { name: '5G RAN twin mission control' }),
      screen.getByRole('region', { name: 'Planning next actions' }),
      screen.getByRole('region', { name: 'City and cluster radio environment' }),
      screen.getByRole('region', { name: 'Deployment readiness' }),
      screen.getByRole('region', { name: 'Operational use cases' }),
      screen.getByRole('region', { name: 'End-to-end twin boundary' }),
      screen.getByRole('region', { name: 'Selected site' }),
      screen.getByRole('region', { name: 'Quick scenarios' }),
      screen.getByRole('region', { name: 'Recent activity' }),
    ];
    expect(order.every((element, index) => index === 0 ||
      Boolean(order[index - 1].compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
    expect(screen.queryByRole('button', { name: /Open task board/i })).toBeNull();
    const map = screen.getByRole('group', { name: 'Schematic city map with selectable 5G sites' });
    await user.click(within(map).getByRole('button', { name: 'Select River Bridge site on map' }));
    expect(screen.getByRole('region', { name: 'Selected site' }).textContent).toContain('River Bridge');
    expect(api.write).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'UE density surge' }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(screen.getByText('3,400 UEs')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Selected site' }).textContent).toContain('River Bridge');
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Scenario selected');
    expect(controller.getSnapshot().workspace?.projects[1].activity).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: /Review 7 planned tasks/i }));
    await user.click(screen.getByRole('button', { name: /Virtual drive test/i }));
    expect(onNavigate.mock.calls).toEqual([['tasks'], ['drive']]);
    await controller.dispatch(next => activateWorkspaceProject(next, secondId) as WorkspaceSnapshot);
    await waitFor(() => expect(screen.getByRole('region', { name: 'Selected site' }).textContent).toContain('Another site'));
    expect(screen.getByText(/Another plan · Example City/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Baseline' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows loading rather than fabricated indicators before the shared controller hydrates', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn() };
    const controller = new AppController(api);
    render(<MissionControlPage controller={controller} onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading local workspace');
    expect(screen.queryByText('COVERAGE PROXY')).toBeNull();
    expect(api.read).not.toHaveBeenCalled();
    await controller.hydrate();
    expect(await screen.findByText('COVERAGE PROXY')).toBeTruthy();
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.write).not.toHaveBeenCalled();
  });
});
