import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import ActivityPreviewLeaf from './ActivityPreviewLeaf';

describe('React activity preview leaf', () => {
  it('shows the selected project log newest first and exports the planning manifest', () => {
    const onExport = vi.fn();
    render(<ActivityPreviewLeaf record={{ id: 'pilot', name: 'Pilot', activity: [
      { when: '2026-01-02T13:00:00Z', title: 'Newest change', detail: '<unsafe>' },
      { when: '2026-01-01T13:00:00Z', title: 'Earlier change', detail: 'Earlier detail' },
    ] }} onExport={onExport} />);
    const route = screen.getByRole('region', { name: 'Activity preview route' });
    const events = within(route).getByRole('list', { name: 'Recent activity' });
    expect(Array.from(events.querySelectorAll('strong')).map(item => item.textContent)).toEqual(['Newest change', 'Earlier change']);
    expect(within(route).getByText('<unsafe>')).toBeTruthy();
    fireEvent.click(within(route).getByRole('button', { name: /Export planning manifest/ }));
    expect(onExport).toHaveBeenCalledOnce();
    expect(within(route).getByText('NOT IMPLEMENTED')).toBeTruthy();
  });

  it('shows an explicit empty project log', () => {
    render(<ActivityPreviewLeaf record={{ id: 'empty', name: 'Empty pilot', activity: [] }} onExport={vi.fn()} />);
    expect(screen.getByText('No project activity has been recorded yet.')).toBeTruthy();
  });
});
