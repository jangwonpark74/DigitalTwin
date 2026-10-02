import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PreviewWorkspaceShell from './PreviewWorkspaceShell';
import { workflowSections } from './workflowNavigation';
import { previewRoutes } from './routeRegistry';
const context = { name: 'City pilot', city: 'Example City', cluster: 'Central cluster', projectCount: 2, siteCount: 3, cellCount: 9, ueCount: 1200, activityCount: 4 };

describe('workspace navigation migration', () => {
  it('retains every existing destination through keyboard-operable lifecycle sections', async () => {
    const user = userEvent.setup(), navigate = vi.fn();
    const view = render(<PreviewWorkspaceShell route="projects" context={context} onNavigate={navigate}><h1>Project library</h1></PreviewWorkspaceShell>);
    for (const group of workflowSections) {
      const toggle = screen.getByRole('button', { name: group.label });
      if (toggle.getAttribute('aria-expanded') !== 'true') { toggle.focus(); await user.keyboard('{Enter}'); }
      for (const route of group.routes.filter(route => route !== 'radio')) {
        await user.click(screen.getByRole('button', { name: previewRoutes[route].label }));
        expect(navigate).toHaveBeenLastCalledWith(route);
        view.rerender(<PreviewWorkspaceShell route={route} context={context} onNavigate={navigate}><h1>{route} leaf</h1></PreviewWorkspaceShell>);
        expect(screen.getByRole('button', { name: previewRoutes[route].label }).getAttribute('aria-current')).toBe('page');
        expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain(previewRoutes[route].label);
      }
    }
    view.rerender(<PreviewWorkspaceShell route="radio" context={context} onNavigate={navigate}><h1>Compatibility entry</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Sites and Cells' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Radio planner' })).toBeNull();
  });
  it('keeps counts and mobile controls available without claiming connected operations', async () => {
    const user = userEvent.setup(), navigate = vi.fn();
    render(<PreviewWorkspaceShell route="activity" context={context} onNavigate={navigate}><h1>Activity</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('Central cluster · 2 projects');
    expect(screen.getByRole('contentinfo', { name: 'Planning status' }).textContent).toContain('3 SITES · 9 CELLS · 1,200 VIRTUAL UES');
    await user.click(screen.getByRole('button', { name: 'Navigation +' }));
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByRole('button', { name: 'Navigation +' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('RAN endpoints not connected')).toBeTruthy();
  });
});
