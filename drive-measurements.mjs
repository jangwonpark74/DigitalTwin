import { DM_METRICS, parseDmCsv } from './dm.mjs';
import { stableJson } from './study.mjs';
import { validateCellIdentity } from './cell-identity.mjs';

/** Only GPS imports can become geographic evidence; schematic demo rows stay transient. */
export function validateDriveMeasurements(trace) {
  if (trace == null) return [];
  const errors = [];
  if (trace.schemaVersion !== undefined && trace.schemaVersion !== 1 && trace.schemaVersion !== 2) errors.push('Invalid drive measurement schema version');
  const nullable = trace.schemaVersion === 2, kpiKeys = Object.values(DM_METRICS).map(({ key }) => key);
  const evidence = trace.evidence;
  if (evidence !== undefined) {
    if (!evidence || ![1, 2].includes(evidence.schemaVersion) || !['unknown', 'synthetic', 'field-measured'].includes(evidence.origin)
      || evidence.verification !== 'unverified' || evidence.coordinateReference !== 'EPSG:4326'
      || typeof evidence.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.sha256)
      || evidence.datasetId !== `sha256-${evidence.schemaVersion === 2 ? evidence.normalizationSha256 : evidence.sha256}`
      || (evidence.schemaVersion === 2 && (trace.schemaVersion !== 2 || !/^[a-f0-9]{64}$/.test(evidence.normalizationSha256 ?? '')))
      || typeof evidence.rawCsv !== 'string' || new TextEncoder().encode(evidence.rawCsv).length > 1_000_000
      || typeof evidence.importedAt !== 'string' || !Number.isFinite(Date.parse(evidence.importedAt))
      || (evidence.sourceDate !== null && (typeof evidence.sourceDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(evidence.sourceDate)
        || !Number.isFinite(Date.parse(evidence.sourceDate)) || new Date(evidence.sourceDate).toISOString().slice(0, 10) !== evidence.sourceDate
        || evidence.sourceDate > evidence.importedAt.slice(0, 10)))
      || !Array.isArray(evidence.transformations) || evidence.transformations.length !== 1
      || (evidence.schemaVersion === 1 ? evidence.transformations[0]?.type !== 'strict-gps-csv-parse' || evidence.transformations[0]?.version !== 1
        : evidence.transformations[0]?.type !== 'mapped-gps-csv-parse' || evidence.transformations[0]?.version !== 2
          || !evidence.transformations[0]?.mapping || Object.keys(evidence.transformations[0]).length !== 3)) {
      errors.push('Invalid drive source evidence');
    } else if (evidence.origin !== 'synthetic' && (/synthetic(?:[-_ ]|$)/i.test(evidence.rawCsv)
      || (evidence.schemaVersion === 2 && /synthetic(?:[-_ .]|$)/i.test(trace.fileName ?? '')))) {
      errors.push('Declared origin conflicts with synthetic source evidence');
    }
    if (evidence?.schemaVersion === 2 && !errors.length) {
      try {
        const replay = buildDriveMeasurements(parseDmCsv(evidence.rawCsv, { mapping: evidence.transformations[0].mapping }), trace.fileName);
        if (stableJson(replay.samples) !== stableJson(trace.samples)) errors.push('Drive samples do not match the retained source mapping');
      } catch { errors.push('Invalid drive source mapping or normalized samples'); }
    }
  }
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
      || Object.entries(bounds).some(([key, [min, max]]) => nullable && kpiKeys.includes(key) && sample[key] === null ? false : !Number.isFinite(sample[key]) || sample[key] < min || sample[key] > max)
      || sample.timeS < previousTime) {
      errors.push(`Invalid drive GPS sample ${index + 1}`);
      break;
    }
    previousTime = sample.timeS;
  }
  return [...errors, ...validateCellIdentity(trace)];
}

/** Verify new source/normalization digests; legacy captures retain their original contract. */
export async function verifyDriveEvidence(trace) {
  const evidence = trace?.evidence;
  if (evidence?.schemaVersion !== 2) return;
  const errors = validateDriveMeasurements(trace);
  if (errors.length) throw new Error(errors[0]);
  const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
  if (await hash(evidence.rawCsv) !== evidence.sha256 || await hash(stableJson({ sourceSha256: evidence.sha256, transformations: evidence.transformations })) !== evidence.normalizationSha256) throw new Error('Drive source or normalization digest does not match');
}

export async function verifyProjectDriveEvidence(project) {
  await verifyDriveEvidence(project.driveMeasurements);
  for (const baseline of project.study?.baselines ?? []) await verifyDriveEvidence(JSON.parse(baseline.inputJson).inputs.driveMeasurements);
}

export function buildDriveMeasurements(trace, fileName) {
  if (trace?.source !== 'imported-unverified') throw new Error('Only imported drive data can be saved as GPS evidence.');
  const result = { schemaVersion: 2, source: 'imported-unverified', coordinateMode: 'gps', fileName,
    samples: trace.samples.map((sample, index) => ({ index, timeS: sample.timeS,
      latitude: sample.latitude, longitude: sample.longitude, technology: sample.technology,
      servingCell: sample.servingCell, event: sample.event, provenance: 'imported-unverified',
      ...Object.fromEntries(Object.values(DM_METRICS).map(({ key }) => [key, sample[key]])),
    })) };
  const errors = validateDriveMeasurements(result);
  if (errors.length) throw new Error(errors.join('; ') + '. Import a CSV with latitude and longitude for every sample.');
  return result;
}
