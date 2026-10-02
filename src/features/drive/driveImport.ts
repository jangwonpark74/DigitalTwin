import { parseDmCsv, DM_METRICS } from '../../../dm.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import { stableJson } from '../../../study.mjs';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';

export type DriveOrigin = 'unknown' | 'synthetic' | 'field-measured';
export type CsvMapping = Record<string, { column: string | null; unit: string | null }>;
export type DriveEvidence = { schemaVersion: 1 | 2; datasetId: string; origin: DriveOrigin; verification: 'unverified';
  rawCsv: string; sha256: string; sourceDate: string | null; importedAt: string; coordinateReference: 'EPSG:4326';
  normalizationSha256?: string; transformations: { type: string; version: number; mapping?: CsvMapping }[] };
export type DriveImportPreview = { measurements: DriveMeasurements & { evidence: DriveEvidence };
  quality: { accepted: number; rejected: number; duplicates: number; unmatchedCells: string[]; warnings: string[];
    metrics: Record<string, { label: string; unit: string; available: number; missing: number }> };
  extent: { south: number; north: number; west: number; east: number } };

export async function readDriveCsv(file: { text: () => Promise<string>; arrayBuffer?: () => Promise<ArrayBuffer> }) {
  // Preserve a UTF-8 BOM as part of the source artifact and digest; File.text() removes it.
  if (!file.arrayBuffer) return file.text();
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('CSV must use UTF-8 encoding. Export the source as UTF-8 and retry.'); }
}

export async function prepareDriveImport({ name, rawCsv, mapping, origin, sourceDate = '', knownCellIds, importedAt = new Date().toISOString() }: {
  name: string; rawCsv: string; mapping?: CsvMapping; origin: DriveOrigin; sourceDate?: string; knownCellIds: string[]; importedAt?: string;
}): Promise<DriveImportPreview> {
  if (!['unknown', 'synthetic', 'field-measured'].includes(origin)) throw new Error('Declare a supported dataset origin.');
  const bytes = new TextEncoder().encode(rawCsv);
  if (bytes.length > 1_000_000) throw new Error('Drive CSV must be smaller than 1 MB.');
  if (!Number.isFinite(Date.parse(importedAt))) throw new Error('Invalid import date.');
  if (sourceDate && (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !Number.isFinite(Date.parse(sourceDate))
    || new Date(sourceDate).toISOString().slice(0, 10) !== sourceDate || sourceDate > importedAt.slice(0, 10))) {
    throw new Error('Source date must be a valid acquisition date no later than the import date.');
  }
  const parsed = parseDmCsv(rawCsv, { mapping });
  const measurements = buildDriveMeasurements(parsed, name) as DriveMeasurements;
  const synthetic = /synthetic(?:[-_ ]|$)/i.test(rawCsv) || /synthetic(?:[-_ .]|$)/i.test(name);
  const warnings: string[] = [];
  if (synthetic) {
    origin = 'synthetic';
    warnings.push('The file identifies synthetic data. It remains synthetic regardless of the selected origin.');
  } else if (origin === 'unknown') warnings.push('Network origin is unknown. Importing does not verify the measurements.');
  const known = new Set(knownCellIds), seen = new Set<string>();
  let duplicates = 0;
  for (const sample of measurements.samples) {
    const key = `${sample.timeS}:${sample.latitude}:${sample.longitude}:${sample.technology}:${sample.servingCell}`;
    if (seen.has(key)) duplicates++;
    seen.add(key);
  }
  const unmatchedCells = [...new Set(measurements.samples.filter(sample => !known.has(sample.servingCell)).map(sample => sample.servingCell))];
  if (unmatchedCells.length) warnings.push(`${unmatchedCells.length} serving-cell identifiers need mapping. Samples are retained.`);
  if (duplicates) warnings.push(`${duplicates} duplicate sample positions/times retained in the source order.`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  const transformations = [{ type: 'mapped-gps-csv-parse', version: 2, mapping: parsed.mapping }];
  const normalizedDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson({ sourceSha256: sha256, transformations })));
  const normalizationSha256 = Array.from(new Uint8Array(normalizedDigest), value => value.toString(16).padStart(2, '0')).join('');
  const metrics = Object.fromEntries(Object.entries(DM_METRICS).map(([metric, spec]) => {
    const available = measurements.samples.filter(sample => Number.isFinite(sample[spec.key as keyof typeof sample])).length;
    return [metric, { label: spec.label, unit: spec.unit, available, missing: measurements.samples.length - available }];
  }));
  const latitudes = measurements.samples.map(sample => sample.latitude), longitudes = measurements.samples.map(sample => sample.longitude);
  return { measurements: { ...measurements, evidence: { schemaVersion: 2, datasetId: `sha256-${normalizationSha256}`, origin, verification: 'unverified',
    rawCsv, sha256, sourceDate: sourceDate || null, importedAt, coordinateReference: 'EPSG:4326',
    normalizationSha256, transformations } },
  quality: { accepted: measurements.samples.length, rejected: 0, duplicates, unmatchedCells, warnings, metrics },
  extent: { south: Math.min(...latitudes), north: Math.max(...latitudes), west: Math.min(...longitudes), east: Math.max(...longitudes) } };
}
