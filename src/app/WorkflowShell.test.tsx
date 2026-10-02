import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import PreviewWorkspaceShell from './PreviewWorkspaceShell';
const context = { name: 'City pilot', city: 'Example City', cluster: 'Central cluster', projectCount: 2, siteCount: 3, cellCount: 9, ueCount: 1200, activityCount: 4 };

describe('lifecycle workspace shell', () => {
  it('presents the radio bookmark as the canonical Sites and Cells menu entry', () => {
    render(<PreviewWorkspaceShell route="radio" context={context} onNavigate={vi.fn()}><h1>Compatibility route</h1></PreviewWorkspaceShell>);
    expect(screen.queryByRole('button', { name: 'Radio planner' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sites and Cells' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Sites and Cells');
  });
  it('expands the active section, preserves project context and exposes a global library', async () => {
    const user = userEvent.setup(), navigate = vi.fn();
    const { rerender } = render(<PreviewWorkspaceShell route="drive" context={context} onNavigate={navigate}><h1>Drive leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Validation and Optimization' }).getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('button', { name: 'Virtual drive test' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('City pilot');
    await user.click(screen.getByRole('button', { name: 'Projects' }));
    expect(navigate).toHaveBeenCalledWith('projects');
    rerender(<PreviewWorkspaceShell route="ray" context={context} onNavigate={navigate}><h1>Propagation leaf</h1></PreviewWorkspaceShell>);
    expect(screen.getByRole('button', { name: 'Ray tracing lab' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Simulation and Experiments');
  });
  it('supports keyboard operation and retains selection through role changes', async () => {
    const user = userEvent.setup();
    render(<PreviewWorkspaceShell route="planner" context={context} onNavigate={vi.fn()}><h1>Planner</h1></PreviewWorkspaceShell>);
    const group = screen.getByRole('button', { name: 'Network Design' });
    group.focus(); await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Sites and Cells' })).toBeNull();
    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Sites and Cells' })).toBeTruthy();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace preset' }), 'operations');
    expect(screen.getByRole('button', { name: 'Sites and Cells' }).getAttribute('aria-current')).toBe('page');
    expect(screen.queryByRole('button', { name: 'Simulation and Experiments' })).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Workspace preset' }), 'all');
    expect(screen.getByRole('button', { name: 'Simulation and Experiments' })).toBeTruthy();
  });
});
