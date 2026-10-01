import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { USE_CASE_CARD_ITEMS } from '../../../usecase-ui.mjs';
import MissionControlWorkflows from './MissionControlWorkflows';

describe('Mission Control workflow entry cards (not yet routed)', () => {
  it('renders the exact shared legacy card descriptions without claiming that a workflow ran', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<MissionControlWorkflows onNavigate={onNavigate} />);
    const region = screen.getByRole('region', { name: 'Operational use cases' });
    expect(within(region).getByText('Distinct planning workflows for drive tests, paired releases, and AI-RAN datasets')).toBeTruthy();
    const buttons = within(region).getAllByRole('button');
    expect(buttons).toHaveLength(USE_CASE_CARD_ITEMS.length);
    for (const [, , title, description] of USE_CASE_CARD_ITEMS) {
      expect(within(region).getByText(title)).toBeTruthy();
      expect(within(region).getByText(description)).toBeTruthy();
    }
    expect(region.textContent).toContain('3 WORKFLOWS');
    expect(region.textContent).not.toMatch(/completed|measured|generated rows/i);
    await user.click(within(region).getByRole('button', { name: /Package A\/B test/i }));
    expect(onNavigate).toHaveBeenCalledWith('ab');
  });

  it('opens drive and data workspaces with keyboard intent rather than implicit execution', async () => {
    const onNavigate = vi.fn();
    const user = userEvent.setup();
    render(<MissionControlWorkflows onNavigate={onNavigate} />);
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Virtual drive test/i }));
    await user.keyboard('{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('drive');
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /AI-RAN data generation/i }));
    await user.keyboard(' ');
    expect(onNavigate).toHaveBeenCalledWith('data');
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });
});
