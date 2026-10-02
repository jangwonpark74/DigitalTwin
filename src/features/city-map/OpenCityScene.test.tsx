import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import OpenCityScene, { type CityBuilding, type CityMapState, type OpenCityHandle, type OpenCityLoader } from './OpenCityScene';
import { BUILDING_LAYER, CITY_LOCATIONS, openCityStyle } from './openCityStyle';

function setup() {
  const handle: OpenCityHandle = { setLocation: vi.fn(), setView: vi.fn(), setLayer: vi.fn(), reset: vi.fn(), inspect: vi.fn(), destroy: vi.fn() };
  let report!: (state: CityMapState) => void;
  let select!: (building: CityBuilding) => void;
  const create = vi.fn((_host, onState, onSelect) => { report = onState; select = onSelect; return handle; });
  const load: OpenCityLoader = vi.fn(async () => create);
  return { handle, create, load, report: (state: CityMapState) => act(() => report(state)), select: (building: CityBuilding) => act(() => select(building)) };
}

describe('open Silicon Valley city scene', () => {
  it('shows delivered geometry, inspects heights honestly, and keeps layer changes independent of the camera', async () => {
    const scene = setup();
    const close = vi.fn();
    const user = userEvent.setup();
    render(<OpenCityScene onClose={close} loadDriver={scene.load} />);
    await waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    scene.report({ phase: 'ready', count: 212, message: 'Open map connected' });
    expect(screen.getByRole('status').textContent).toBe('Open map connected');
    expect(screen.getByText('212')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Example base stations' }).textContent).toContain('24–36 m above ground');
    await user.click(screen.getByLabelText('Base stations'));
    expect(scene.handle.setLayer).toHaveBeenCalledWith('stations', false);
    await user.click(screen.getByRole('button', { name: 'Inspect a visible building' }));
    expect(scene.handle.inspect).toHaveBeenCalledOnce();
    await user.selectOptions(screen.getByLabelText('Silicon Valley location'), 'san-jose');
    expect(scene.handle.setLocation).toHaveBeenLastCalledWith('san-jose');
    const cameraCalls = vi.mocked(scene.handle.setLocation).mock.calls.length;
    await user.click(screen.getByLabelText('Street & place labels'));
    expect(scene.handle.setLayer).toHaveBeenLastCalledWith('labels', false);
    expect(vi.mocked(scene.handle.setLocation).mock.calls).toHaveLength(cameraCalls);
    await user.click(screen.getByRole('button', { name: '2D plan' }));
    expect(scene.handle.setView).toHaveBeenLastCalledWith(false);
    scene.select({ id: '123', height: null, base: 0, longitude: -121.89, latitude: 37.336 });
    expect(screen.getByText('6 m fallback')).toBeTruthy();
    expect(screen.getByText(/not necessarily an OSM object/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Reset city camera' }));
    expect(scene.handle.reset).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Return to radio map' }));
    expect(close).toHaveBeenCalledOnce();
  });

  it('retries failed map initialization and destroys the old scene on retry and unmount', async () => {
    const scene = setup();
    const user = userEvent.setup();
    const { unmount } = render(<OpenCityScene onClose={() => {}} loadDriver={scene.load} />);
    await waitFor(() => expect(scene.create).toHaveBeenCalledOnce());
    scene.report({ phase: 'error', count: 0, message: 'Map tiles could not load. Check your connection and retry.' });
    expect(screen.queryByText('Open map connected')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Retry open map' }));
    await waitFor(() => expect(scene.create).toHaveBeenCalledTimes(2));
    expect(scene.handle.destroy).toHaveBeenCalledOnce();
    unmount();
    expect(scene.handle.destroy).toHaveBeenCalledTimes(2);
  });

  it('does not instantiate a renderer after a late import resolves following unmount', async () => {
    const scene = setup();
    let resolve!: (create: Awaited<ReturnType<OpenCityLoader>>) => void;
    const load: OpenCityLoader = () => new Promise(done => { resolve = done; });
    const { unmount } = render(<OpenCityScene onClose={() => {}} loadDriver={load} />);
    unmount();
    await act(async () => resolve(scene.create));
    expect(scene.create).not.toHaveBeenCalled();
  });

  it('reports unavailable WebGL without claiming that a real map loaded', async () => {
    const load: OpenCityLoader = async () => { throw new Error('WebGL unavailable'); };
    render(<OpenCityScene onClose={() => {}} loadDriver={load} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toContain('WebGL'));
    expect(screen.getByRole('button', { name: '3D perspective' }).hasAttribute('disabled')).toBe(true);
    expect(screen.queryByText('Open map connected')).toBeNull();
  });

  it('uses actual vector geometry and source heights for the three California locations', () => {
    const style = openCityStyle();
    expect(style.sources.openmaptiles).toMatchObject({ type: 'vector', url: 'https://tiles.openfreemap.org/planet' });
    expect(style.layers.find(layer => layer.id === BUILDING_LAYER)).toMatchObject({ type: 'fill-extrusion', 'source-layer': 'building',
      paint: { 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6] } });
    expect(Object.keys(CITY_LOCATIONS)).toEqual(['palo-alto', 'mountain-view', 'san-jose']);
    for (const city of Object.values(CITY_LOCATIONS)) {
      expect(city.center[0]).toBeGreaterThan(-123); expect(city.center[0]).toBeLessThan(-121);
      expect(city.center[1]).toBeGreaterThan(37); expect(city.center[1]).toBeLessThan(38);
    }
  });
});
