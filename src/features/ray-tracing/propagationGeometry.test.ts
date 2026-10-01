import { describe, expect, it } from 'vitest';
import { aimBeam, beamOutline, tracePreview, type Footprint, type GeoPoint } from './propagationGeometry';
const geo = (x: number, y: number, heightM = 2): GeoPoint => ({ longitude: x / 111195, latitude: y / 111195, heightM });
const rectangle = (id: string, west: number, south: number, east: number, north: number, heightM = 10): Footprint => ({ id, heightM,
  ring: [[west, south], [east, south], [east, north], [west, north], [west, south]].map(([x, y]) => [x / 111195, y / 111195]) });
const beam = { azimuthDeg: 90, downtiltDeg: 0, widthDeg: 65 };
describe('geometric propagation preview', () => {
  it('finds an unobstructed direct path and a specular reflection with a longer travel time', () => {
    const paths = tracePreview(geo(0, 0), geo(20, 0), [rectangle('north-wall', -10, 10, 30, 12)], beam);
    const direct = paths.find(path => path.kind === 'direct')!;
    expect(direct.distanceM).toBeCloseTo(20, 5);
    expect(direct.delayNs).toBeCloseTo(66.7128, 3);
    expect(direct.inBeam).toBe(true);
    const reflected = paths.find(path => path.kind === 'reflection')!;
    expect(reflected.points[1].longitude * 111195).toBeCloseTo(10, 5);
    expect(reflected.points[1].latitude * 111195).toBeCloseTo(10, 5);
    expect(reflected.distanceM).toBeCloseTo(Math.sqrt(200) * 2, 5);
    expect(reflected.inBeam).toBe(false);
  });
  it('stops a blocked direct path at the first facade rather than drawing it through a building', () => {
    const paths = tracePreview(geo(0, 0), geo(20, 0), [rectangle('blocker', 8, -5, 12, 5)], beam);
    expect(paths[0]).toMatchObject({ kind: 'blocked', buildingId: 'blocker' });
    expect(paths[0].points.at(-1)!.longitude * 111195).toBeCloseTo(8, 5);
    const openRing = rectangle('open-ring', 8, -5, 12, 5); openRing.ring.pop();
    const openPaths = tracePreview(geo(0, 0), geo(20, 0), [openRing], beam);
    expect(openPaths[0].points.at(-1)!.longitude * 111195).toBeCloseTo(8, 5);
    expect(paths.some(path => path.kind === 'direct')).toBe(false);
  });
  it('uses antenna heights to allow paths above roofs and rejects indoor terminals', () => {
    const buildings = [rectangle('blocker', 8, -5, 12, 5)];
    expect(tracePreview(geo(0, 0, 20), geo(20, 0, 20), buildings, beam)[0].kind).toBe('direct');
    expect(tracePreview(geo(10, 0), geo(20, 0), buildings, beam)).toEqual([]);
  });
  it('rejects invalid receiver coordinates and keeps visualization calculations separate from RF loss', () => {
    expect(tracePreview(geo(0, 0), { ...geo(20, 0), latitude: NaN }, [rectangle('wall', -10, 10, 30, 12)], beam)).toEqual([]);
    expect(tracePreview(geo(0, 0), geo(20, 0), [rectangle('wall', -10, 10, 30, 12)], beam)[0]).not.toHaveProperty('pathLossDb');
    expect(aimBeam(geo(0, 0, 20), geo(20, 0))).toMatchObject({ azimuthDeg: 90 });
    expect(beamOutline(geo(0, 0, 20), beam, 100)).toHaveLength(6);
  });
});
