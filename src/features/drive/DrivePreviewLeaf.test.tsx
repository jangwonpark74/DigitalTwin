import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import DrivePreviewLeaf from './DrivePreviewLeaf';

const workspace = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('DrivePreviewLeaf', () => {
  it('updates the chart category, physical unit, exact axes and cursor with the selected metric and filter', async () => {
    const controller = new AppController({ read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) });
    await controller.hydrate();
    const view = render(<DrivePreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onError={vi.fn()} />);
    const metric = screen.getByRole('combobox', { name: 'Color route by' });
    for (const [value, label, category, unit, threshold] of [
      ['rsrp', 'RSRP / SS-RSRP', 'Signal power', 'dBm', '-110'],
      ['rsrq', 'RSRQ / SS-RSRQ', 'Signal quality', 'dB', '-15'],
      ['sinr', 'SINR / SS-SINR', 'Signal quality', 'dB', '0'],
      ['dl', 'DL throughput', 'Downlink throughput', 'Mbps', '5'],
      ['ul', 'UL throughput', 'Uplink throughput', 'Mbps', '2'],
    ]) {
      fireEvent.change(metric, { target: { value } });
      const chart = screen.getByRole('img', { name: new RegExp(`${label} trend by sample number`) });
      const panel = within(chart.parentElement!);
      expect(panel.getByText(`KPI category · ${category}`)).toBeTruthy();
      expect(panel.getByText(`Example weak threshold: ${threshold} ${unit}`)).toBeTruthy();
      expect(panel.getByText(new RegExp(`Scale .+ ${unit} · .+ ${unit} / division`))).toBeTruthy();
      expect(chart.querySelector('.dm-trend-y-ticks text')?.textContent).toMatch(/^-?\d+$/);
      expect(chart.getAttribute('preserveAspectRatio')).toBe('xMinYMid meet');
    }
    const slider = screen.getByRole('slider', { name: 'DM trace sample' });
    fireEvent.change(slider, { target: { value: '47' } });
    expect(view.container.querySelector('#dm-trend-cursor')?.getAttribute('x1')).toBe('920');
    fireEvent.change(screen.getByRole('combobox', { name: 'Radio access' }), { target: { value: 'LTE' } });
    const ticks = view.container.querySelectorAll('.dm-trend-x-ticks text');
    expect(ticks[0].textContent).toBe('1');
    expect(slider.getAttribute('max')).toBe('15');
    expect(ticks[ticks.length - 1].textContent).toBe('16');
  });

  it('keeps the focused route setting mounted while persisting edits under StrictMode', async () => {
    const api = {
      read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1),
    };
    const controller = new AppController(api);
    await controller.hydrate();
    const record = controller.getSnapshot().workspace!.projects[0];
    const onError = vi.fn();
    const view = render(<StrictMode><DrivePreviewLeaf controller={controller} record={record} onError={onError} /></StrictMode>);
    const unsubscribe = controller.subscribe(() => {
      const snapshot = controller.getSnapshot().workspace;
      const active = snapshot?.projects.find(item => item.id === snapshot.activeProjectId);
      if (active) view.rerender(<StrictMode><DrivePreviewLeaf controller={controller} record={active} onError={onError} /></StrictMode>);
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Route & simulation plan' }));
    const samples = screen.getByRole('spinbutton', { name: 'Samples along route' }) as HTMLInputElement;
    samples.focus();
    fireEvent.change(samples, { target: { value: '32' } });
    fireEvent.blur(samples);
    await waitFor(() => expect((controller.getSnapshot().workspace!.projects[0].project as unknown as {
      useCases: { drive: { samples: number } };
    }).useCases.drive.samples).toBe(32));
    expect(screen.getByRole('spinbutton', { name: 'Samples along route' })).toBe(samples);
    expect(document.activeElement).toBe(samples);
    expect(onError).toHaveBeenLastCalledWith('');
    unsubscribe();
  });

  it('exports the active drive plan and records its project activity', async () => {
    vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:test'), revokeObjectURL: vi.fn() });
    const api = {
      read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1),
    };
    const controller = new AppController(api);
    await controller.hydrate();
    const record = controller.getSnapshot().workspace!.projects[0];
    const onError = vi.fn();
    render(<StrictMode><DrivePreviewLeaf controller={controller} record={record} onError={onError} /></StrictMode>);
    fireEvent.click(screen.getByRole('tab', { name: 'Route & simulation plan' }));
    fireEvent.click(screen.getByRole('button', { name: /Export drive job plan/ }));
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects[0].activity[0]?.title).toBe('Use-case plan exported'));
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenLastCalledWith('');
  });
});
