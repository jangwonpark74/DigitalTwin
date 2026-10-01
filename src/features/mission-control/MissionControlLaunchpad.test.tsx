import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { buildMissionControlModel } from './missionControlModel';
import MissionControlLaunchpad from './MissionControlLaunchpad';

const selected = () => workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];
const tasksFor = (record = selected()) => {
  const model = buildMissionControlModel(record);
  if (model.kind !== 'ready') throw new Error('Valid project required');
  return model.tasks;
};

describe('Mission Control four-step planning launchpad (not yet routed)', () => {
  it('preserves each legacy route, planned task count, next due task and external integration caveats', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    render(<MissionControlLaunchpad tasks={tasksFor()} onNavigate={navigate} />);
    const region = screen.getByRole('region', { name: 'Planning next actions' });
    expect(within(region).getAllByRole('button')).toHaveLength(4);
    expect(region.textContent).toContain('Four connected planning steps. RAN deployment and telemetry still require external integration.');
    expect(region.textContent).toContain('Geometry validation is still pending.');
    expect(region.textContent).toContain('H200, Grace CPU and fronthaul have not been discovered.');
    expect(region.textContent).toContain('No collector or telemetry is connected.');
    expect(region.textContent).toMatch(/Review 7 planned tasks/);
    expect(region.textContent).toMatch(/Next: OSM geometry & coordinates · due/);
    await user.click(within(region).getByRole('button', { name: /Prepare the city map/i }));
    await user.click(within(region).getByRole('button', { name: /Review 7 planned tasks/i }));
    await user.click(within(region).getByRole('button', { name: /Define GH200 targets/i }));
    await user.click(within(region).getByRole('button', { name: /Prepare monitoring/i }));
    expect(navigate.mock.calls).toEqual([['map'], ['tasks'], ['hardware'], ['monitoring']]);
  });

  it('handles an empty plan and escapes a project-specific task label while retaining keyboard access', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const record = selected();
    record.project.tasks = [];
    const { rerender, container } = render(<MissionControlLaunchpad tasks={tasksFor(record)} onNavigate={navigate} />);
    expect(screen.getByText('No tasks planned yet. Add one on the task board.')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Review 0 planned tasks/i })).toBeTruthy();
    const altered = selected();
    (altered.project.tasks as { title: string }[])[0].title = '<img src=x onerror=alert(1)>';
    rerender(<MissionControlLaunchpad tasks={tasksFor(altered)} onNavigate={navigate} />);
    expect(screen.getByText(/Next: <img src=x onerror=alert\(1\)> · due/)).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Prepare the city map/i }));
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('map');
  });
});
