import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import MapScopeControls from './MapScopeControls';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));
const sceneInput = JSON.stringify({ type: 'FeatureCollection', features: [{
  type: 'Feature', id: 'Block A', properties: { levels: 4 }, geometry: { type: 'Polygon', coordinates: [[
    [126.97, 37.55], [126.98, 37.55], [126.98, 37.56], [126.97, 37.56], [126.97, 37.55],
  ]] },
}] });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

async function setup(fetcher: typeof fetch = vi.fn()) {
  const api = { read: vi.fn().mockResolvedValue({ revision: 0, workspace }),
    write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
  const controller = new AppController(api);
  await controller.hydrate();
  const record = controller.getSnapshot().workspace!.projects[0];
  render(<MapScopeControls controller={controller} record={record} fetcher={fetcher} />);
  return { controller, api };
}

describe('MapScopeControls', () => {
  it('saves validated map scope fields and rejects values outside the project model', async () => {
    const { controller, api } = await setup();
    const city = screen.getByLabelText('City / location');
    fireEvent.change(city, { target: { value: 'Seoul Central' } });
    fireEvent.blur(city);
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects[0].project.map).toMatchObject({ city: 'Seoul Central' }));
    const radius = screen.getByLabelText('Area radius (m)');
    fireEvent.change(radius, { target: { value: '20001' } });
    fireEvent.blur(radius);
    expect((await screen.findByRole('alert')).textContent).toMatch(/map radius/i);
    expect((radius as HTMLInputElement).value).toBe('1200');
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it('loads the shared demo GeoJSON, exposes scene bounds, and fits the map scope', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, text: async () => sceneInput } as Response);
    const { controller, api } = await setup(fetcher);
    fireEvent.click(screen.getByRole('button', { name: 'Load demo scene' }));
    expect(await screen.findByText(/demo-buildings\.geojson/)).toBeTruthy();
    expect(screen.getByText(/footprints.*heights estimated.*EPSG:4326/i)).toBeTruthy();
    expect(fetcher).toHaveBeenCalledWith('/examples/demo-buildings.geojson', { cache: 'no-store' });
    const map = controller.getSnapshot().workspace!.projects[0].project.map as { latitude: number; longitude: number; radiusMeters: number };
    const before = { ...map };
    fireEvent.click(screen.getByRole('button', { name: 'Fit map scope to geometry' }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(4));
    expect(controller.getSnapshot().workspace!.projects[0].project.map).toMatchObject(before);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Map fitted to geometry');
  });
});
