import { DM_METRICS } from '../../../dm.mjs';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';

export type DriveMetric = keyof typeof DM_METRICS;
export type DriveTechnology = 'ALL' | 'LTE' | 'NR';
export type DriveSample = { index: number; timeS: number; latitude: number; longitude: number;
  technology: 'LTE' | 'NR'; servingCell: string; event: string; provenance: 'imported-unverified';
  rsrpDbm: number; rsrqDb: number; sinrDb: number; dlMbps: number; ulMbps: number };
export type DriveMeasurements = { source: 'imported-unverified'; coordinateMode: 'gps'; fileName: string; samples: DriveSample[] };
export type DriveView = { samples: DriveSample[]; metric: DriveMetric; selectedIndex: number | null; visible: boolean; interactive: boolean };
export const driveColors = { good: '#15956f', fair: '#e6ab28', poor: '#dc5261' };
export const driveMetrics = DM_METRICS as Record<DriveMetric, { label: string; unit: string; key: keyof DriveSample; poor: number; good: number }>;

export function driveLevel(value: number, metric: DriveMetric) {
  const spec = driveMetrics[metric];
  return value < spec.poor ? 'poor' : value < spec.good ? 'fair' : 'good';
}

function distanceM(a: DriveSample, b: DriveSample) {
  const toRad = Math.PI / 180;
  const lat = (b.latitude - a.latitude) * toRad, lon = (b.longitude - a.longitude) * toRad;
  const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * toRad) * Math.cos(b.latitude * toRad) * Math.sin(lon / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Render original GPS positions. Never bridge filtered rows, long time gaps, or GPS jumps. */
export function driveFeatures(view?: DriveView): FeatureCollection<Point | LineString> {
  const features: Feature<Point | LineString>[] = [];
  if (!view?.visible) return { type: 'FeatureCollection', features };
  const spec = driveMetrics[view.metric];
  view.samples.forEach((sample, index) => {
    const value = sample[spec.key] as number;
    const properties = { index: sample.index, value, color: driveColors[driveLevel(value, view.metric)], selected: sample.index === view.selectedIndex };
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [sample.longitude, sample.latitude] } });
    const previous = view.samples[index - 1];
    if (previous && sample.index === previous.index + 1 && sample.timeS - previous.timeS <= 30 && distanceM(previous, sample) <= 300) {
      features.push({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: [
        [previous.longitude, previous.latitude], [sample.longitude, sample.latitude],
      ] } });
    }
  });
  return { type: 'FeatureCollection', features };
}
