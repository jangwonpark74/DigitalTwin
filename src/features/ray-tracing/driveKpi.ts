import { DM_METRICS } from '../../../dm.mjs';
import type { Feature, FeatureCollection, LineString, Point } from 'geojson';
import type { RadioDot, RadioLine } from './radioOverlay';
import type { DriveEvidence } from '../drive/driveImport';
import type { CellIdentity } from '../drive/cellIdentityTypes';

export type DriveMetric = keyof typeof DM_METRICS;
export type DriveTechnology = 'ALL' | 'LTE' | 'NR';
export type DriveSample = { index: number; timeS: number; latitude: number; longitude: number;
  technology: 'LTE' | 'NR'; servingCell: string; event: string; provenance: 'imported-unverified';
  rsrpDbm: number | null; rsrqDb: number | null; sinrDb: number | null; dlMbps: number | null; ulMbps: number | null };
export type DriveMeasurements = { schemaVersion?: 1 | 2; source: 'imported-unverified'; coordinateMode: 'gps'; fileName: string; samples: DriveSample[]; evidence?: DriveEvidence; cellIdentity?: CellIdentity };
export type DriveView = { samples: DriveSample[]; metric: DriveMetric; selectedIndex: number | null; visible: boolean; interactive: boolean };

export const DRIVE_HEIGHT_M = 1.5;
export const driveColors = { good: '#15956f', fair: '#e6ab28', poor: '#dc5261', unavailable: '#6f7f89' };
export const driveMetrics = DM_METRICS as Record<DriveMetric, { label: string; unit: string; key: keyof DriveSample; poor: number; good: number }>;

export function driveLevel(value: unknown, metric: DriveMetric) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'unavailable';
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
    const value = sample[spec.key] as number | null;
    const properties = { index: sample.index, value, color: driveColors[driveLevel(value, view.metric)], selected: sample.index === view.selectedIndex, heightM: DRIVE_HEIGHT_M };
    features.push({ type: 'Feature', properties, geometry: { type: 'Point', coordinates: [sample.longitude, sample.latitude, DRIVE_HEIGHT_M] } });
    const previous = view.samples[index - 1];
    if (previous && sample.index === previous.index + 1 && sample.timeS - previous.timeS <= 30 && distanceM(previous, sample) <= 300) {
      features.push({ type: 'Feature', properties: { ...properties, color: driveLevel(previous[spec.key], view.metric) === 'unavailable' ? driveColors.unavailable : properties.color }, geometry: { type: 'LineString', coordinates: [
        [previous.longitude, previous.latitude, DRIVE_HEIGHT_M], [sample.longitude, sample.latitude, DRIVE_HEIGHT_M],
      ] } });
    }
  });
  return { type: 'FeatureCollection', features };
}

export function driveLines(view?: DriveView): RadioLine[] {
  return driveFeatures(view).features.flatMap(feature => feature.geometry.type === 'LineString' ? [{
    points: feature.geometry.coordinates.map(([longitude, latitude, heightM]) => ({ longitude, latitude, heightM })),
    color: String(feature.properties!.color), width: 7,
  }] : []);
}

export function driveDots(view?: DriveView): RadioDot[] {
  return driveFeatures(view).features.flatMap(feature => {
    if (feature.geometry.type !== 'Point') return [];
    const [longitude, latitude, heightM] = feature.geometry.coordinates;
    const selected = feature.properties!.selected;
    return [{ point: { longitude, latitude, heightM }, index: Number(feature.properties!.index),
      color: String(feature.properties!.color), radius: selected ? 10 : 5.5, border: selected ? 3 : 0 }];
  });
}
