import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { defaultProject } from '../../../model.mjs';
import { studyNextActions } from './studyReadiness';
import MissionControlLaunchpad from './MissionControlLaunchpad';

describe('evidence-driven study actions', () => {
  it('links each missing prerequisite to a workspace without starting a job', async () => {
    const user = userEvent.setup(), navigate = vi.fn();
    render(<MissionControlLaunchpad actions={studyNextActions(defaultProject())} onNavigate={navigate} />);
    const buttons = within(screen.getByRole('region', { name: 'Planning next actions' })).getAllByRole('button');
    expect(buttons).toHaveLength(4);
    expect(buttons[0].textContent).toContain('NEXT ACTION');
    for (const button of buttons) await user.click(button);
    expect(navigate.mock.calls).toEqual([['drive'], ['study'], ['ray'], ['artifacts']]);
    expect(screen.queryByText(/Define GH200 targets/)).toBeNull();
  });
  it('updates the next step from project evidence and escapes labels', () => {
    const actions = studyNextActions(defaultProject());
    const { rerender, container } = render(<MissionControlLaunchpad actions={actions} onNavigate={vi.fn()} />);
    actions[0] = { ...actions[0], status: 'ready', title: '<img src=x onerror=alert(1)>' };
    rerender(<MissionControlLaunchpad actions={actions} onNavigate={vi.fn()} />);
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByRole('button', { name: /Define engineering study/ }).textContent).toContain('NEXT ACTION');
  });
});
