import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { RadioSession } from './RadioSession';
import RadioMapPreview from './RadioMapPreview';

vi.mock('../site-planner/OpenSiteScene', () => ({
  default: ({ camera }: { camera: { yaw: number; pitch: number; zoom: number } }) =>
    <div role="region" aria-label="Mock project 3D scene">{camera.yaw}/{camera.pitch}/{camera.zoom}</div>,
}));

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
afterEach(() => { document.body.innerHTML = ''; vi.unstubAllGlobals(); });

function fixture(write = vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1)) {
  const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write };
  const controller = new AppController(api);
  const record = workspace.projects[0];
  const session = new RadioSession(record.id, record.project as unknown as { sites: { id: string }[] });
  return { api, controller, record, session };
}

describe('Radio map placement preview', () => {
  it('switches between the 2D map and project 3D with bounded camera controls', async () => {
    const { controller, record, session } = fixture();
    await controller.hydrate();
    render(<RadioMapPreview controller={controller} record={record} session={session}
      onError={vi.fn()} onNavigate={vi.fn()} />);
    expect(screen.getByRole('region', { name: 'Mock project 3D scene' }).textContent).toBe('35/0/1');
    fireEvent.click(screen.getByRole('button', { name: 'Project 3D' }));
    const scene = screen.getByRole('region', { name: 'Mock project 3D scene' });
    expect(scene.textContent).toBe('35/52/1');
    fireEvent.click(screen.getByRole('button', { name: 'Rotate left' }));
    fireEvent.click(screen.getByRole('button', { name: 'Lower tilt' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(scene.textContent).toBe('20/44/1.1');
    fireEvent.click(screen.getByRole('button', { name: '2D map' }));
    expect(screen.getByRole('button', { name: '2D map' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('persists keyboard-entered placement and clears the pending target only after the save succeeds', async () => {
    const { api, controller, record, session } = fixture();
    await controller.hydrate();
    session.startPlacement('SITE-02');
    const onError = vi.fn();
    const onComplete = vi.fn();
    render(<RadioMapPreview controller={controller} record={record} session={session}
      onError={onError} onComplete={onComplete} onNavigate={vi.fn()} />);

    fireEvent.change(screen.getByRole('spinbutton', { name: 'Map X position (%)' }), { target: { value: '35' } });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Map Y position (%)' }), { target: { value: '72' } });
    fireEvent.click(screen.getByRole('button', { name: 'Place radio at these coordinates' }));

    await act(async () => { await vi.waitFor(() => expect(session.getSnapshot().placementSiteId).toBeNull()); });
    const sites = controller.getSnapshot().workspace!.projects[0].project.sites as {
      id: string; x: number; y: number; radioLocation: { latitude: number | null; longitude: number | null; source: string };
    }[];
    const placed = sites.find(site => site.id === 'SITE-02')!;
    expect(placed).toMatchObject({ x: 35, y: 72, radioLocation: { source: 'map-estimate' } });
    expect(placed.radioLocation.latitude).toBeTypeOf('number');
    expect(placed.radioLocation.longitude).toBeTypeOf('number');
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Radio location placed on map');
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith('');
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it('keeps the target selected after a rejected save so the user can retry', async () => {
    const { controller, record, session, api } = fixture(vi.fn().mockRejectedValue(new Error('Revision conflict')));
    await controller.hydrate();
    session.startPlacement('SITE-02');
    const onError = vi.fn();
    const onComplete = vi.fn();
    render(<RadioMapPreview controller={controller} record={record} session={session}
      onError={onError} onComplete={onComplete} onNavigate={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Place radio at these coordinates' }));

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith('Revision conflict'));
    expect(session.getSnapshot().placementSiteId).toBe('SITE-02');
    expect(onComplete).not.toHaveBeenCalled();
    expect(api.write).toHaveBeenCalledTimes(1);
  });
});
