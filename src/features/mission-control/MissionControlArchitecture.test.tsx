import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ARCHITECTURE_BLOCKS } from '../../../stack-ui.mjs';
import MissionControlArchitecture from './MissionControlArchitecture';

describe('Mission Control shared RAN boundary (not yet routed)', () => {
  it('renders the six legacy descriptors in order and retains planned/unverified semantics', () => {
    render(<MissionControlArchitecture />);
    const region = screen.getByRole('region', { name: 'End-to-end twin boundary' });
    expect(within(region).getByText('TARGET ARCHITECTURE')).toBeTruthy();
    expect(within(region).getByText('Physical network to virtual radio and CPU-based UEs')).toBeTruthy();
    const blocks = within(region).getAllByTestId('architecture-block');
    expect(blocks).toHaveLength(ARCHITECTURE_BLOCKS.length);
    expect(blocks.map(block => block.querySelector('strong')?.textContent)).toEqual(ARCHITECTURE_BLOCKS.map(([name]) => name));
    expect(within(region).getByText('CHANNEL · PLANNED')).toBeTruthy();
    expect(within(region).getByText('PHYSICAL NETWORK SIDE')).toBeTruthy();
    expect(within(region).getByText('VIRTUALIZATION ON GH200 · H200 GPU + GRACE CPU')).toBeTruthy();
    expect(region.textContent).not.toMatch(/connected|calibrated|discovered/i);
  });

  it('exposes the wide diagram as a keyboard-focusable, labelled scroll region', async () => {
    const user = userEvent.setup();
    render(<MissionControlArchitecture />);
    const scroll = screen.getByRole('region', { name: 'RAN architecture diagram' });
    expect(scroll.getAttribute('tabindex')).toBe('0');
    expect(screen.getByText(/Scroll the architecture diagram horizontally/)).toBeTruthy();
    await user.tab();
    expect(document.activeElement).toBe(scroll);
  });
});
