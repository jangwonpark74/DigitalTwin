import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PreviewWorkspaceShell from './PreviewWorkspaceShell';

const context = { name: 'City pilot', city: 'Example City', cluster: 'Central cluster',
  projectCount: 2, siteCount: 3, cellCount: 9, ueCount: 1200, activityCount: 4 };

describe('single-owner React preview shell', () => {
  it('exposes Site & cell planner from the keyboard-operable workspace group', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rerender } = render(<PreviewWorkspaceShell route="activity" context={context} onNavigate={navigate}><h1>Activity leaf</h1></PreviewWorkspaceShell>);
    const planner = screen.getByRole('button', { name: 'Site & cell planner' });
    await user.click(planner);
    expect(navigate).toHaveBeenCalledWith('planner');
    rerender(<PreviewWorkspaceShell route="planner" context={context} onNavigate={navigate}><h1>Site planner leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Site & cell planner');
    expect(screen.getByRole('button', { name: 'Site & cell planner' }).getAttribute('aria-current')).toBe('page');
  });

  it('keeps project context, breadcrumb, accordion keyboard access and route selection in React', async () => {
    const navigate = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<PreviewWorkspaceShell route="activity" context={context} onNavigate={navigate}>
      <h1>Activity leaf</h1>
    </PreviewWorkspaceShell>);
    expect(screen.getByRole('complementary', { name: 'Primary navigation' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Application workspaces' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Activity');
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('City pilot');
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('Central cluster · 2 projects');
    expect(screen.getByRole('contentinfo', { name: 'Planning status' }).textContent).toContain('3 SITES · 9 CELLS · 1,200 VIRTUAL UES');
    const group = screen.getByRole('button', { name: /WORKSPACE/i });
    expect(group.getAttribute('aria-expanded')).toBe('true');
    expect(group.getAttribute('aria-controls')).toBe('preview-workspace-routes');
    group.focus();
    await user.keyboard('{Enter}');
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'RAN topology' })).toBeNull();
    await user.keyboard(' ');
    expect(group.getAttribute('aria-expanded')).toBe('true');
    await user.click(screen.getByRole('button', { name: 'RAN topology' }));
    expect(navigate).toHaveBeenCalledWith('stack');
    rerender(<PreviewWorkspaceShell route="stack" context={context} onNavigate={navigate}>
      <h1>Stack leaf</h1>
    </PreviewWorkspaceShell>);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('RAN topology');
    expect(screen.getByRole('button', { name: 'RAN topology' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('heading', { name: 'Activity leaf' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Stack leaf' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Virtual UE fleet' }));
    expect(navigate).toHaveBeenCalledWith('ues');
    rerender(<PreviewWorkspaceShell route="ues" context={context} onNavigate={navigate}><h1>UE leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Virtual UE fleet' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Virtual UE fleet');
  });

  it('keeps System monitoring navigation keyboard-operable without implying telemetry', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rerender } = render(<PreviewWorkspaceShell route="monitoring" context={context} onNavigate={navigate}><h1>Monitoring leaf</h1></PreviewWorkspaceShell>);
    const system = screen.getByRole('button', { name: /SYSTEM/i });
    expect(system.getAttribute('aria-expanded')).toBe('false');
    expect(system.getAttribute('aria-controls')).toBe('preview-system-routes');
    expect(screen.queryByRole('button', { name: 'Monitoring' })).toBeNull();
    system.focus();
    await user.keyboard('{Enter}');
    expect(system.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Software management' })).toBeTruthy();
    const route = screen.getByRole('button', { name: 'Monitoring' });
    expect(route.getAttribute('aria-current')).toBe('page');
    await user.click(route);
    expect(navigate).toHaveBeenCalledWith('monitoring');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Monitoring');
    expect(screen.getByRole('contentinfo', { name: 'Planning status' }).textContent).toContain('PREPARATION');
    await user.click(screen.getByRole('button', { name: 'Software management' }));
    expect(navigate).toHaveBeenCalledWith('software');
    rerender(<PreviewWorkspaceShell route="software" context={context} onNavigate={navigate}><h1>Software leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Software management' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Software management');
  });

  it('exposes the A/B and data fallbacks through a keyboard-operable group', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rerender } = render(<PreviewWorkspaceShell route="activity" context={context} onNavigate={navigate}><h1>Activity leaf</h1></PreviewWorkspaceShell>);
    const group = screen.getByRole('button', { name: 'USE CASES' });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    group.focus();
    await user.keyboard('{Enter}');
    await user.click(screen.getByRole('button', { name: 'Package A/B test' }));
    expect(navigate).toHaveBeenCalledWith('ab');
    rerender(<PreviewWorkspaceShell route="ab" context={context} onNavigate={navigate}><h1>A/B leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Package A/B test' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Package A/B test');
    await user.click(screen.getByRole('button', { name: 'AI-RAN data generation' }));
    expect(navigate).toHaveBeenCalledWith('data');
    rerender(<PreviewWorkspaceShell route="data" context={context} onNavigate={navigate}><h1>Data leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'AI-RAN data generation' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('AI-RAN data generation');
  });

  it('exposes Task board and Schedule via the keyboard-operable Tasks & Schedule group', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    const { rerender } = render(<PreviewWorkspaceShell route="schedule" context={context} onNavigate={navigate}><h1>Schedule leaf</h1></PreviewWorkspaceShell>);
    const group = screen.getByRole('button', { name: /TASKS & SCHEDULE/i });
    expect(group.getAttribute('aria-expanded')).toBe('false');
    expect(group.getAttribute('aria-controls')).toBe('preview-task-routes');
    group.focus();
    await user.keyboard('{Enter}');
    const route = screen.getByRole('button', { name: 'Schedule' });
    expect(screen.getByRole('button', { name: 'Task board' })).toBeTruthy();
    expect(route.getAttribute('aria-current')).toBe('page');
    await user.click(route);
    expect(navigate).toHaveBeenCalledWith('schedule');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Schedule');
    expect(screen.getByRole('contentinfo', { name: 'Planning status' }).textContent).toContain('PREPARATION');
    await user.click(screen.getByRole('button', { name: 'Task board' }));
    expect(navigate).toHaveBeenCalledWith('tasks');
    rerender(<PreviewWorkspaceShell route="tasks" context={context} onNavigate={navigate}><h1>Task board leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Task board' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Task board');
    await user.click(screen.getByRole('button', { name: 'Ray tracing lab' }));
    expect(navigate).toHaveBeenCalledWith('ray');
    rerender(<PreviewWorkspaceShell route="ray" context={context} onNavigate={navigate}><h1>Ray tracing leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Ray tracing lab' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Ray tracing lab');
  });
});
