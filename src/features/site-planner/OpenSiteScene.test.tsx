import { act, render, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import OpenSiteScene, { type SceneDriver, type SceneHandle } from './OpenSiteScene';

const project = (name: string) => ({
  map: { latitude: 37.5, longitude: 127, radiusMeters: 1200 },
  sites: [{ id: 'SITE-01', name, heightM: 32, x: 45, y: 55,
    radioLocation: { latitude: 37.5, longitude: 127, source: 'manual' },
    cells: [{ id: 'SITE-01-C1', azimuthDeg: 30, downtiltDeg: 4 }] }],
});

describe('OpenSiteScene lifecycle', () => {
  it('fits an imported route after lazy loading and forwards sample selection to the latest handler', async () => {
    const fitDriveRoute = vi.fn(), fitCellSites = vi.fn(), firstPick = vi.fn(), nextPick = vi.fn();
    let select: ((index: number) => void) | undefined;
    const driver: SceneDriver = (_host, _project, _pick, _status, onSelect) => {
      select = onSelect;
      return { update: vi.fn(), setCamera: vi.fn(), fitDriveRoute, fitCellSites, destroy: vi.fn() };
    };
    const loader = async () => driver;
    const view = render(<OpenSiteScene project={project('Civic')} fitDriveRequest={1} onSelectDriveSample={firstPick} loadDriver={loader} />);
    await waitFor(() => expect(fitDriveRoute).toHaveBeenCalledTimes(1));
    view.rerender(<OpenSiteScene project={project('Civic')} fitDriveRequest={2} onSelectDriveSample={nextPick} loadDriver={loader} />);
    await waitFor(() => expect(fitDriveRoute).toHaveBeenCalledTimes(2));
    act(() => select?.(7));
    expect(nextPick).toHaveBeenCalledWith(7);
    expect(firstPick).not.toHaveBeenCalled();
    view.rerender(<OpenSiteScene project={project('Civic')} fitDriveRequest={2} fitSitesRequest={1} loadDriver={loader} />);
    await waitFor(() => expect(fitCellSites).toHaveBeenCalledTimes(1));
    expect(fitDriveRoute).toHaveBeenCalledTimes(2);
  });
  it('loads on mount, updates the existing scene, and destroys its viewer once', async () => {
    const update = vi.fn();
    const setCamera = vi.fn();
    const destroy = vi.fn();
    const driver: SceneDriver = () => ({ update, setCamera, destroy } satisfies SceneHandle);
    const loadDriver = vi.fn(async () => driver);
    const view = render(<OpenSiteScene project={project('Civic')} camera={{ yaw: 35, pitch: 48, zoom: 1 }} loadDriver={loadDriver} />);

    expect(loadDriver).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(view.getByRole('status').textContent).toMatch(/3D RF scene ready/i));
    view.rerender(<OpenSiteScene project={project('River')} camera={{ yaw: 50, pitch: 56, zoom: 1.2 }} loadDriver={loadDriver} />);
    await waitFor(() => expect(update).toHaveBeenCalledWith(project('River')));
    await waitFor(() => expect(setCamera).toHaveBeenCalledWith(project('River'), { yaw: 50, pitch: 56, zoom: 1.2 }));
    expect(loadDriver).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('restores the latest shared viewport when the lazy map loads and publishes to the current route handler', async () => {
    let resolveDriver: (driver: SceneDriver) => void = () => {};
    let publish: Parameters<SceneDriver>[5];
    const setViewport = vi.fn(), firstChange = vi.fn(), currentChange = vi.fn();
    const loadDriver = () => new Promise<SceneDriver>(resolve => { resolveDriver = resolve; });
    const initial = { longitude: 127.01, latitude: 37.51, zoom: 14, bearing: 35 };
    const latest = { longitude: 127.04, latitude: 37.52, zoom: 16, bearing: -15 };
    const view = render(<OpenSiteScene project={project('Civic')} viewport={initial} onViewChange={firstChange} loadDriver={loadDriver} />);
    view.rerender(<OpenSiteScene project={project('Civic')} viewport={latest} onViewChange={currentChange} loadDriver={loadDriver} />);
    await act(async () => {
      resolveDriver((_host, _project, _pick, _status, _sample, onChange) => {
        publish = onChange;
        return { update: vi.fn(), setCamera: vi.fn(), setViewport, destroy: vi.fn() };
      });
    });
    expect(setViewport).toHaveBeenCalledWith(latest);
    expect(setViewport).not.toHaveBeenCalledWith(initial);
    act(() => publish?.(initial));
    expect(currentChange).toHaveBeenCalledWith(initial);
    expect(firstChange).not.toHaveBeenCalled();
  });

  it('does not create a viewer when a lazy map load resolves after route exit', async () => {
    let resolveDriver: (driver: SceneDriver) => void = () => {};
    const loadDriver = vi.fn(() => new Promise<SceneDriver>(resolve => { resolveDriver = resolve; }));
    const create = vi.fn(() => ({ update: vi.fn(), setCamera: vi.fn(), destroy: vi.fn() }));
    const view = render(<OpenSiteScene project={project('Civic')} loadDriver={loadDriver} />);
    view.unmount();
    await act(async () => { resolveDriver(create); });
    expect(create).not.toHaveBeenCalled();
  });
});
