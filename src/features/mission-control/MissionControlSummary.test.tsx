import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { buildMissionControlModel } from './missionControlModel';
import MissionControlSummary from './MissionControlSummary';

const record = () => workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];

describe('Mission Control React summary (not yet routed)', () => {
  it('distinguishes loading, missing workspace and invalid project without manufacturing metrics', () => {
    const { rerender } = render(<MissionControlSummary model={buildMissionControlModel(null, { loading: true })} onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading local workspace');
    expect(screen.queryByText('COVERAGE PROXY')).toBeNull();
    rerender(<MissionControlSummary model={buildMissionControlModel(null)} onNavigate={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('No active project');
    const invalid = record();
    (invalid.project.ue as { count: number }).count = 0;
    rerender(<MissionControlSummary model={buildMissionControlModel(invalid)} onNavigate={vi.fn()} />);
    expect(screen.getByRole('alert').textContent).toContain('Invalid UE count');
    expect(screen.queryByText('COVERAGE PROXY')).toBeNull();
  });

  it('presents selected-project evidence gates and illustrative indicators without duplicating the launchpad', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    const selected = record();
    selected.activity = [{ when: '2026-01-02T00:00:00Z', title: 'Set radio target', detail: 'Planning only' }];
    render(<MissionControlSummary model={buildMissionControlModel(selected)} onNavigate={navigate} />);
    expect(screen.getByRole('heading', { name: '5G RAN twin mission control' })).toBeTruthy();
    expect(screen.getByText(new RegExp(selected.name))).toBeTruthy();
    expect(screen.getByText('RAN OFFLINE')).toBeTruthy();
    expect(screen.getByText(/Illustrative only · not Sionna-RT/)).toBeTruthy();
    expect(screen.getByText(/1\s*\/\s*6 GATES/)).toBeTruthy();
    const gates = screen.getByRole('list', { name: 'Deployment readiness gates' });
    expect(within(gates).getAllByText('PENDING')).toHaveLength(5);
    expect(within(gates).getByText('CONFIGURED')).toBeTruthy();
    expect(screen.getByText('Set radio target')).toBeTruthy();
    expect(screen.getByText('Planning only')).toBeTruthy();
    expect(screen.queryByText(/Review 7 planned tasks/)).toBeNull();
    expect(within(screen.getByLabelText('Study inventory')).queryByText('COVERAGE PROXY')).toBeNull();
    expect(screen.getByText('COVERAGE PROXY').closest('details')?.hasAttribute('open')).toBe(false);
    await user.tab();
    expect(document.activeElement?.tagName).toBe('SUMMARY');
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /View all activity/i }));
    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('activity');
  });

  it('replaces scoped content on project switch, and treats activity labels as text', () => {
    const first = record();
    first.activity = [{ when: '2026-01-02T00:00:00Z', title: 'First project action', detail: 'Only first' }];
    const second = structuredClone(first);
    second.name = 'Another pilot';
    second.project.name = second.name;
    (second.project.ue as { count: number }).count = 3400;
    second.activity = [{ when: '2026-01-03T00:00:00Z', title: '<img src=x onerror=alert(1)>', detail: 'Only second' }];
    const { rerender, container } = render(<MissionControlSummary model={buildMissionControlModel(first)} onNavigate={vi.fn()} />);
    rerender(<MissionControlSummary model={buildMissionControlModel(second)} onNavigate={vi.fn()} />);
    expect(screen.getByText(/Another pilot/)).toBeTruthy();
    expect(screen.getByText('3,400 UEs')).toBeTruthy();
    expect(screen.queryByText('First project action')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
  });
});
