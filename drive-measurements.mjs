import { DM_METRICS } from './dm.mjs';

/** Only GPS imports can become geographic evidence; schematic demo rows stay transient. */
export function validateDriveMeasurements(trace) {
  if (trace == null) return [];
  const errors = [];
  if (trace.source !== 'imported-unverified' || trace.coordinateMode !== 'gps') errors.push('Drive measurements must be an unverified GPS import');
  if (typeof trace.fileName !== 'string' || !trace.fileName.trim() || trace.fileName.length > 255) errors.push('Invalid drive measurement filename');
  if (!Array.isArray(trace.samples) || trace.samples.length < 2 || trace.samples.length > 5000) return [...errors, 'Drive measurements require 2–5000 GPS samples'];
  let previousTime = -Infinity;
  const bounds = { latitude: [-90, 90], longitude: [-180, 180], timeS: [0, 604800],
    rsrpDbm: [-160, -40], rsrqDb: [-40, 0], sinrDb: [-30, 60], dlMbps: [0, 10000], ulMbps: [0, 10000] };
  for (const [index, sample] of trace.samples.entries()) {
    if (!sample || sample.index !== index || sample.provenance !== 'imported-unverified'
      || !['LTE', 'NR'].includes(sample.technology)
      || typeof sample.servingCell !== 'string' || !/^[A-Za-z0-9._:/-]{1,60}$/.test(sample.servingCell)
      || typeof sample.event !== 'string' || sample.event.length > 60 || /[<>\x00-\x1f]/.test(sample.event)
      || Object.entries(bounds).some(([key, [min, max]]) => !Number.isFinite(sample[key]) || sample[key] < min || sample[key] > max)
      || sample.timeS < previousTime) {
      errors.push(`Invalid drive GPS sample ${index + 1}`);
      break;
    }
    previousTime = sample.timeS;
  }
  return errors;
}

export function buildDriveMeasurements(trace, fileName) {
  if (trace?.source !== 'imported-unverified') throw new Error('Only imported drive data can be saved as GPS evidence.');
  const result = { source: 'imported-unverified', coordinateMode: 'gps', fileName,
    samples: trace.samples.map((sample, index) => ({ index, timeS: sample.timeS,
      latitude: sample.latitude, longitude: sample.longitude, technology: sample.technology,
      servingCell: sample.servingCell, event: sample.event, provenance: 'imported-unverified',
      ...Object.fromEntries(Object.values(DM_METRICS).map(({ key }) => [key, sample[key]])),
    })) };
  const errors = validateDriveMeasurements(result);
  if (errors.length) throw new Error(errors.join('; ') + '. Import a CSV with latitude and longitude for every sample.');
  return result;
}
