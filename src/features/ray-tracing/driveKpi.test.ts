import { describe, expect, it } from 'vitest';
import { driveColors, driveFeatures, driveLevel, type DriveSample, type DriveView } from './driveKpi';
const sample = (index: number, extras: Partial<DriveSample> = {}): DriveSample => ({ index, timeS: index,
  latitude: 37.566, longitude: 126.978 + index * .0001, technology: 'NR', servingCell: 'SITE-01-C1', event: '',
  provenance: 'imported-unverified', rsrpDbm: -90, rsrqDb: -9, sinrDb: 18, dlMbps: 120, ulMbps: 30, ...extras });
const view = (samples: DriveSample[]): DriveView => ({ samples, metric: 'rsrp', selectedIndex: 0, visible: true, interactive: true });

describe('street GPS KPI geometry', () => {
  it('uses shared metric boundaries and changes colors with the selected KPI', () => {
    expect([-111, -110, -95].map(value => driveLevel(value, 'rsrp'))).toEqual(['poor', 'fair', 'good']);
    expect([-1, 0, 13].map(value => driveLevel(value, 'sinr'))).toEqual(['poor', 'fair', 'good']);
    const input = view([sample(0, { sinrDb: -1 })]);
    const rsrp = driveFeatures(input).features[0];
    expect(rsrp.geometry.coordinates).toEqual([126.978, 37.566]);
    expect(rsrp.properties).toMatchObject({ color: driveColors.good, selected: true });
    expect(driveFeatures({ ...input, metric: 'sinr' }).features[0].properties?.color).toBe(driveColors.poor);
    expect(driveFeatures({ ...input, visible: false }).features).toHaveLength(0);
  });
  it('connects only adjacent GPS rows without bridging filtered samples, GPS jumps or time gaps', () => {
    const lines = (input: DriveSample[]) => driveFeatures(view(input)).features.filter(feature => feature.geometry.type === 'LineString');
    expect(lines([sample(0), sample(1)])).toHaveLength(1);
    expect(lines([sample(0), sample(2)])).toHaveLength(0);
    expect(lines([sample(0), sample(1, { timeS: 100 })])).toHaveLength(0);
    expect(lines([sample(0), sample(1, { longitude: 127 })])).toHaveLength(0);
  });
});
