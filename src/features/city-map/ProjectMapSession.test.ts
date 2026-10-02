import { describe, expect, it, vi } from 'vitest';
import { projectMapSession } from './ProjectMapSession';

describe('shared geographic map view', () => {
  const map = { longitude: 127.0346, latitude: 37.5058, radiusMeters: 2400 };
  it('shares the viewport and drive selections across routes without changing project data', () => {
    const controller = {}, original = structuredClone(map);
    const city = projectMapSession(controller, 'gangnam', map);
    const lab = projectMapSession(controller, 'gangnam', { ...map });
    city.update({ metric: 'sinr', technology: 'NR', selectedIndex: 340, sitesVisible: false,
      viewport: { longitude: 127.032, latitude: 37.507, zoom: 15, bearing: 35 } });
    expect(lab.getSnapshot()).toMatchObject({ metric: 'sinr', technology: 'NR', selectedIndex: 340, sitesVisible: false,
      viewport: { longitude: 127.032, latitude: 37.507, zoom: 15, bearing: 35 } });
    expect(map).toEqual(original);
    expect(projectMapSession(controller, 'another-project', map).getSnapshot().metric).toBe('rsrp');
    expect(projectMapSession({}, 'gangnam', map).getSnapshot().viewport).toBeNull();
    expect(projectMapSession(controller, 'gangnam', { ...map, latitude: 37.566 }).getSnapshot().viewport).toBeNull();
  });
  it('ignores repeated camera events to avoid update loops and detaches listeners', () => {
    const session = projectMapSession({}, 'gangnam', map);
    const listener = vi.fn(), unsubscribe = session.subscribe(listener);
    const viewport = { longitude: 127.032, latitude: 37.507, zoom: 15, bearing: 35 };
    session.update({ viewport }); session.update({ viewport: { ...viewport, latitude: viewport.latitude + 1e-10 } });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(Object.isFrozen(session.getSnapshot().viewport)).toBe(true);
    unsubscribe(); session.update({ metric: 'sinr' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
