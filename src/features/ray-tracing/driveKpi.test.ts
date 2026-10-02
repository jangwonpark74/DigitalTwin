import { describe, expect, it } from 'vitest';
import { DRIVE_HEIGHT_M, driveColors, driveDots, driveFeatures, driveLevel, driveLines, type DriveSample, type DriveView } from './driveKpi';

it('renders missing KPIs in a neutral band and never bridges a missing observation with a quality-colored line', () => {
  const input = view([sample(0), sample(1, { rsrpDbm: null }), sample(2)]);
  expect(driveLevel(null, 'rsrp')).toBe('unavailable');
  const features = driveFeatures(input).features;
  expect(features.find(feature => feature.geometry.type === 'Point' && feature.properties?.index === 1)?.properties)
    .toMatchObject({ value: null, color: driveColors.unavailable });
  expect(features.filter(feature => feature.geometry.type === 'LineString').every(feature => feature.properties?.color === driveColors.unavailable)).toBe(true);
});
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
    expect(rsrp.geometry.coordinates).toEqual([126.978, 37.566, 1.5]);
    expect(rsrp.properties).toMatchObject({ color: driveColors.good, selected: true });
    expect(driveFeatures({ ...input, metric: 'sinr' }).features[0].properties?.color).toBe(driveColors.poor);
    expect(driveFeatures({ ...input, visible: false }).features).toHaveLength(0);
  });
  it('renders every route vertex and sample at 1.5 m and clears hidden geometry', () => {
    const input = view([sample(0), sample(1)]);
    expect(DRIVE_HEIGHT_M).toBe(1.5);
    expect(driveLines(input)[0].points).toEqual([
      { latitude: 37.566, longitude: 126.978, heightM: 1.5 },
      { latitude: 37.566, longitude: 126.9781, heightM: 1.5 },
    ]);
    expect(driveDots(input).map(dot => dot.point.heightM)).toEqual([1.5, 1.5]);
    expect(driveDots(input)[0]).toMatchObject({ index: 0, radius: 10, border: 3 });
    expect(driveLines({ ...input, visible: false })).toEqual([]);
    expect(driveDots({ ...input, visible: false })).toEqual([]);
    expect(input.samples[0]).not.toHaveProperty('heightM');
  });
  it('connects only adjacent GPS rows without bridging filtered samples, GPS jumps or time gaps', () => {
    const lines = (input: DriveSample[]) => driveFeatures(view(input)).features.filter(feature => feature.geometry.type === 'LineString');
    expect(lines([sample(0), sample(1)])).toHaveLength(1);
    expect(lines([sample(0), sample(2)])).toHaveLength(0);
    expect(lines([sample(0), sample(1, { timeS: 100 })])).toHaveLength(0);
    expect(lines([sample(0), sample(1, { longitude: 127 })])).toHaveLength(0);
  });
});
