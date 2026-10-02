import { validateDriveMeasurements, verifyDriveEvidence } from './drive-measurements.mjs';
import { stableJson } from './study.mjs';

const bytes = value => new TextEncoder().encode(value).length;
const digest = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2, '0')).join('');
const source = project => stableJson({ library: project.measurementLibrary ?? null, working: project.driveMeasurements ?? null });
export const measurementInputIdentity = source;

export function measurementPayload(record) {
  let value;
  try { value = JSON.parse(record.inputJson); } catch { throw new Error('Invalid measurement dataset payload'); }
  const errors = validateDriveMeasurements(value);
  if (!value || errors.length) throw new Error(errors[0] ?? 'Invalid measurement dataset payload');
  return value;
}

export function validateMeasurementLibrary(project) {
  const library = project?.measurementLibrary;
  if (library == null) return [];
  try {
    if (library.schemaVersion !== 1 || Object.keys(library).length !== 3 || !Object.hasOwn(library, 'activeId')
      || !Array.isArray(library.records) || !library.records.length || library.records.length > 20) throw new Error('Measurement library requires 1–20 retained datasets');
    if (bytes(JSON.stringify(library)) > 2_000_000) throw new Error('Measurement library exceeds 2 MB');
    const ids = new Set();
    for (const [index, record] of library.records.entries()) {
      if (!record || Object.keys(record).length !== 5 || record.version !== index + 1 || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')
        || record.id !== `dataset-${record.sha256}` || ids.has(record.id) || typeof record.registeredAt !== 'string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(record.registeredAt) || !Number.isFinite(Date.parse(record.registeredAt))
        || typeof record.inputJson !== 'string') throw new Error('Invalid measurement dataset identity or version');
      measurementPayload(record); ids.add(record.id);
    }
    const active = library.records.find(record => record.id === library.activeId);
    if (library.activeId !== null && !active) throw new Error('Working dataset selection not found in the measurement library');
    if (stableJson(project.driveMeasurements ?? null) !== stableJson(active ? measurementPayload(active) : null)) throw new Error('Working dataset does not match the selected retained measurement version');
    return [];
  } catch (error) { return [error.message]; }
}

export async function verifyMeasurementLibrary(project) {
  const errors = validateMeasurementLibrary(project); if (errors.length) throw new Error(errors[0]);
  for (const record of project.measurementLibrary?.records ?? []) {
    if (await digest(record.inputJson) !== record.sha256) throw new Error('Retained measurement dataset digest does not match');
    await verifyDriveEvidence(measurementPayload(record));
  }
}

export function assertMeasurementTransition(previous, next) {
  if (!previous) return;
  if (!next || previous.records.length > next.records.length || previous.records.some((record, index) => stableJson(record) !== stableJson(next.records[index]))) {
    throw new Error('Measurement history is immutable; import a new dataset version');
  }
}

function bounded(project) {
  const errors = validateMeasurementLibrary(project); if (errors.length) throw new Error(errors[0]);
  if (bytes(JSON.stringify(project, null, 2)) > 3_000_000) throw new Error('Project snapshot exceeds 3 MB; retain further measurements in another project');
  return project;
}

export async function retainMeasurementDataset(project, measurements, { now = () => new Date().toISOString() } = {}) {
  await verifyMeasurementLibrary(project);
  const errors = validateDriveMeasurements(measurements); if (!measurements || errors.length) throw new Error(errors[0] ?? 'A GPS dataset is required');
  await verifyDriveEvidence(measurements);
  const next = structuredClone(project), library = next.measurementLibrary ??= { schemaVersion: 1, records: [], activeId: null };
  const register = async value => {
    const inputJson = stableJson(value), sha256 = await digest(inputJson), id = `dataset-${sha256}`;
    if (!library.records.some(record => record.id === id)) {
      if (library.records.length >= 20) throw new Error('Measurement library limit reached (20 datasets)');
      library.records.push({ id, version: library.records.length + 1, registeredAt: typeof now === 'function' ? now() : now, inputJson, sha256 });
    }
    return id;
  };
  if (!project.measurementLibrary && project.driveMeasurements) await register(project.driveMeasurements);
  library.activeId = await register(measurements);
  next.driveMeasurements = structuredClone(measurements);
  return bounded(next);
}

export function selectMeasurementDataset(project, id) {
  const errors = validateMeasurementLibrary(project); if (errors.length) throw new Error(errors[0]);
  if (!project.measurementLibrary) throw new Error('Retain the current dataset or import evidence before selecting a version');
  const next = structuredClone(project), record = next.measurementLibrary.records.find(item => item.id === id);
  if (id !== null && !record) throw new Error('Measurement dataset not found in this project');
  next.measurementLibrary.activeId = id;
  next.driveMeasurements = record ? measurementPayload(record) : null;
  return bounded(next);
}
