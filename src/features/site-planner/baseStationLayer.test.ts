import { describe, expect, it } from 'vitest';
import { stationFeatures, type BaseStation } from './baseStationLayer';

describe('base station 3D dimensions', () => {
  it('uses the saved height for both mast and sector panels, with metre-sized footprints', () => {
    const station: BaseStation = { id: 'SITE-01', name: 'Civic', longitude: 127, latitude: 37.5,
      heightM: 32, azimuths: [0, 120, 240] };
    const features = stationFeatures([station]).features;
    expect(features).toHaveLength(5);
    expect(features[1].properties).toMatchObject({ stationId: 'SITE-01', base: 0, height: 32 });
    for (const panel of features.slice(2)) expect(panel.properties).toMatchObject({ base: 29.6, height: 32 });
    const ring = features[1].geometry.coordinates[0];
    const width = (ring[1][0] - ring[0][0]) * 111320 * Math.cos(station.latitude * Math.PI / 180);
    expect(width).toBeCloseTo(.9, 5);
    expect(ring[0]).toEqual(ring.at(-1));
    const taller = stationFeatures([{ ...station, heightM: 48 }]).features;
    expect(taller[1].properties?.height).toBe(48);
    expect(taller[2].properties?.base).toBe(45.6);
  });
});
