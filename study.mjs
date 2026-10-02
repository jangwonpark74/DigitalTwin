// Portable, append-only engineering studies. Digests identify content, not field verification.
import { validateInventoryImports, verifyInventoryImports } from './inventory-import.mjs';
const copy = value => structuredClone(value);
const clock = () => new Date().toISOString();
const idPattern = /^[\w-]{1,80}$/;
const fields = {
  heightM: { scope: 'site', min: 1, max: 300, unit: 'm', label: 'Antenna height' },
  txPowerDbm: { scope: 'cell', min: 0, max: 60, unit: 'dBm', label: 'Transmit power' },
  downtiltDeg: { scope: 'cell', min: 0, max: 30, unit: '°', label: 'Downtilt' },
  azimuthDeg: { scope: 'cell', min: 0, max: 359.999, unit: '°', label: 'Azimuth' },
  bandwidthMhz: { scope: 'cell', min: 5, max: 400, unit: 'MHz', label: 'Bandwidth' },
};
export const scenarioFields = fields;
const inputKeys = ['map', 'sites', 'channel', 'ue', 'architecture', 'driveMeasurements'];
const stamp = now => typeof now === 'function' ? now() : now;
const label = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new Error(`${name} must contain 1–${max} characters`);
  return value.trim();
};
const timestamp = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid study timestamp');
};
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).filter(key => value[key] !== undefined).sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Study inputs must contain finite numbers');
  return JSON.stringify(value);
}
async function digest(text) {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}
const empty = () => ({ schemaVersion: 1, definitions: [], baselines: [], candidates: [], selection: { kind: 'draft' } });
function checked(project) {
  const errors = validateStudy(project.study);
  if (errors.length) throw new Error(errors[0]);
  return copy(project);
}
function definitionValues(value) {
  const result = { objective: label(value.objective, 500, 'Study objective'), operator: label(value.operator, 120, 'Operator declaration'),
    rat: value.rat, carrierMhz: value.carrierMhz ?? null, windowStart: value.windowStart ?? null, windowEnd: value.windowEnd ?? null };
  if (!['ALL', 'LTE', 'NR'].includes(result.rat)) throw new Error('Invalid study RAT');
  if (result.carrierMhz !== null && (!Number.isFinite(result.carrierMhz) || result.carrierMhz < 500 || result.carrierMhz > 100000)) throw new Error('Study carrier must be 500–100000 MHz or unspecified');
  const validDate = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
  if ((result.windowStart !== null || result.windowEnd !== null)
    && (!validDate(result.windowStart) || !validDate(result.windowEnd) || result.windowStart > result.windowEnd)) throw new Error('Study window requires valid ordered start and end dates');
  return result;
}
export function saveStudyDefinition(project, value, { now = clock } = {}) {
  const next = checked(project), study = next.study ??= empty();
  if (study.definitions.length >= 50) throw new Error('Study definition history limit reached (50)');
  const createdAt = stamp(now); timestamp(createdAt);
  study.definitions.push({ ...definitionValues(value), version: study.definitions.length + 1, createdAt });
  return next;
}
export function engineeringInputs(project) {
  const map = copy(project.map);
  delete map.geometryValidated; delete map.materialAssigned; delete map.coordinateAligned;
  const channel = copy(project.channel); delete channel.execution;
  return copy({ map, sites: project.sites, channel, ue: project.ue, architecture: project.architecture,
    driveMeasurements: project.driveMeasurements ?? null, ...(project.inventoryImports ? { inventoryImports: project.inventoryImports } : {}) });
}
function baseline(study, id) {
  const result = study?.baselines.find(item => item.id === id);
  if (!result) throw new Error('Baseline not found in this study');
  return result;
}
function uniqueId(study, id) {
  if (typeof id !== 'string' || !idPattern.test(id) || [...study.baselines, ...study.candidates].some(item => item.id === id)) throw new Error('Study IDs must be unique and valid');
}
function bounded(project) {
  if (new TextEncoder().encode(JSON.stringify(project.study)).length > 2_000_000) throw new Error('Study history exceeds 2 MB; reduce source size or create another project. History is retained.');
  if (new TextEncoder().encode(JSON.stringify(project, null, 2)).length > 3_000_000) throw new Error('Project artifact exceeds 3 MB; create another project. History is retained.');
  const errors = validateStudy(project.study);
  if (errors.length) throw new Error(errors[0]);
  return project;
}
export async function captureBaseline(project, name, { id = crypto.randomUUID(), now = clock } = {}) {
  const next = checked(project), study = next.study;
  if (!study?.definitions.length) throw new Error('Save a study definition before capturing a baseline');
  if (study.baselines.length >= 8) throw new Error('Baseline history limit reached (8)');
  uniqueId(study, id);
  const createdAt = stamp(now); timestamp(createdAt);
  const inputJson = stableJson({ definition: study.definitions.at(-1), inputs: engineeringInputs(next) });
  const record = { id, name: label(name, 80, 'Baseline name'), createdAt, inputJson, sha256: await digest(inputJson) };
  study.baselines.push(record); study.selection = { kind: 'baseline', id };
  return bounded(next);
}
function normalizedChanges(inputs, changes) {
  if (!Array.isArray(changes) || changes.length > 250) throw new Error('Candidate requires at most 250 changes');
  const seen = new Set();
  return changes.map(change => {
    const spec = fields[change?.field];
    if (!spec || !Object.hasOwn(fields, change.field)) throw new Error('Unsupported candidate field');
    const site = inputs.sites.find(site => site.id === change.siteId);
    const target = spec.scope === 'cell' ? site?.cells.find(cell => cell.id === change.cellId) : site;
    if (!target || (spec.scope === 'site' && change.cellId !== undefined)) throw new Error('Candidate site / cell does not match the baseline');
    if (!Number.isFinite(change.after) || change.after < spec.min || change.after > spec.max) throw new Error(`${spec.label} change is outside its ${spec.min}–${spec.max} ${spec.unit} range`);
    const key = `${change.siteId}:${change.cellId ?? ''}:${change.field}`;
    if (seen.has(key)) throw new Error('Duplicate candidate change'); seen.add(key);
    return { siteId: site.id, ...(spec.scope === 'cell' ? { cellId: target.id } : {}), field: change.field,
      before: target[change.field], after: change.after };
  }).filter(change => change.before !== change.after).sort((a, b) => stableJson(a).localeCompare(stableJson(b)));
}
export async function createCandidate(project, baselineId, name, issue = '', { id = crypto.randomUUID(), now = clock } = {}) {
  const next = checked(project), study = next.study;
  baseline(study, baselineId); uniqueId(study, id);
  if (study.candidates.length >= 20) throw new Error('Candidate history limit reached (20)');
  if (typeof issue !== 'string' || issue.length > 500) throw new Error('Linked issue must be at most 500 characters');
  const createdAt = stamp(now); timestamp(createdAt);
  const inputJson = stableJson({ baselineId, issue: issue.trim(), changes: [] });
  study.candidates.push({ id, name: label(name, 80, 'Candidate name'), baselineId,
    versions: [{ version: 1, createdAt, inputJson, sha256: await digest(inputJson) }] });
  study.selection = { kind: 'candidate', id, version: 1 };
  return bounded(next);
}
export async function reviseCandidate(project, id, expectedVersion, changes, { now = clock } = {}) {
  const next = checked(project), candidate = next.study?.candidates.find(item => item.id === id);
  if (!candidate || candidate.versions.length !== expectedVersion) throw new Error('Candidate revision changed; reopen the latest revision');
  if (expectedVersion >= 50) throw new Error('Candidate revision history limit reached (50)');
  const previous = JSON.parse(candidate.versions.at(-1).inputJson);
  const inputs = JSON.parse(baseline(next.study, candidate.baselineId).inputJson).inputs;
  const inputJson = stableJson({ ...previous, changes: normalizedChanges(inputs, changes) });
  if (inputJson === candidate.versions.at(-1).inputJson) throw new Error('No candidate changes to save');
  const createdAt = stamp(now); timestamp(createdAt);
  candidate.versions.push({ version: expectedVersion + 1, createdAt, inputJson, sha256: await digest(inputJson) });
  next.study.selection = { kind: 'candidate', id, version: expectedVersion + 1 };
  return bounded(next);
}
export function candidateInputs(study, id, version) {
  const candidate = study?.candidates.find(item => item.id === id);
  const revision = candidate?.versions.find(item => item.version === version);
  if (!revision) throw new Error('Candidate revision not found');
  const inputs = JSON.parse(baseline(study, candidate.baselineId).inputJson).inputs;
  for (const change of JSON.parse(revision.inputJson).changes) {
    const site = inputs.sites.find(site => site.id === change.siteId);
    const target = change.cellId ? site.cells.find(cell => cell.id === change.cellId) : site;
    target[change.field] = change.after;
  }
  return inputs;
}
function payload(record) {
  timestamp(record.createdAt);
  if (typeof record.inputJson !== 'string' || record.inputJson.length > 2_000_000 || !/^[a-f0-9]{64}$/.test(record.sha256)) throw new Error('Invalid study payload or SHA-256');
  const value = JSON.parse(record.inputJson);
  if (stableJson(value) !== record.inputJson) throw new Error('Study payload must use canonical JSON');
  return value;
}
export function validateStudy(study, validateInputs = () => []) {
  if (study === undefined || study === null) return [];
  try {
    if (study.schemaVersion !== 1 || !Array.isArray(study.definitions) || study.definitions.length < 1 || study.definitions.length > 50
      || !Array.isArray(study.baselines) || study.baselines.length > 8 || !Array.isArray(study.candidates) || study.candidates.length > 20) throw new Error('Invalid study schema or history limits');
    if (new TextEncoder().encode(JSON.stringify(study)).length > 2_000_000) throw new Error('Study history exceeds 2 MB');
    study.definitions.forEach((record, i) => { definitionValues(record); timestamp(record.createdAt); if (record.version !== i + 1) throw new Error('Invalid study definition version'); });
    const ids = new Set();
    for (const record of [...study.baselines, ...study.candidates]) {
      if (typeof record.id !== 'string' || !idPattern.test(record.id) || ids.has(record.id)) throw new Error('Study IDs must be unique and valid');
      ids.add(record.id); label(record.name, 80, 'Study record name');
    }
    for (const record of study.baselines) {
      const value = payload(record);
      if (!value.inputs || stableJson(Object.keys(value.inputs).sort()) !== stableJson([...inputKeys, ...(Object.hasOwn(value.inputs, 'inventoryImports') ? ['inventoryImports'] : [])].sort())
        || stableJson(value.definition) !== stableJson(study.definitions[value.definition?.version - 1])) throw new Error('Baseline inputs / definition do not match the study');
      if (['geometryValidated', 'materialAssigned', 'coordinateAligned'].some(key => key in value.inputs.map) || 'execution' in value.inputs.channel) throw new Error('Baseline cannot assert unverified execution or geometry');
      const errors = validateInputs(value.inputs); if (errors.length) throw new Error(`Baseline: ${errors[0]}`);
      const inventoryErrors = validateInventoryImports(value.inputs); if (inventoryErrors.length) throw new Error(`Baseline: ${inventoryErrors[0]}`);
    }
    for (const candidate of study.candidates) {
      const inputs = JSON.parse(baseline(study, candidate.baselineId).inputJson).inputs;
      if (!Array.isArray(candidate.versions) || candidate.versions.length < 1 || candidate.versions.length > 50) throw new Error('Invalid candidate history');
      candidate.versions.forEach((record, i) => {
        const value = payload(record);
        if (record.version !== i + 1 || value.baselineId !== candidate.baselineId || typeof value.issue !== 'string' || value.issue.length > 500
          || stableJson(value.changes) !== stableJson(normalizedChanges(inputs, value.changes))) throw new Error('Invalid candidate revision / exact change list');
      });
    }
    const selection = study.selection;
    if (selection?.kind === 'baseline') baseline(study, selection.id);
    else if (selection?.kind === 'candidate') candidateInputs(study, selection.id, selection.version);
    else if (selection?.kind !== 'draft') throw new Error('Invalid study reference selection');
    return [];
  } catch (error) { return [`Study: ${error.message}`]; }
}
export async function verifyStudyDigests(study) {
  const errors = validateStudy(study); if (errors.length) throw new Error(errors[0]);
  if (!study) return;
  for (const record of [...study.baselines, ...study.candidates.flatMap(item => item.versions)]) {
    if (await digest(record.inputJson) !== record.sha256) throw new Error('Study content digest does not match its saved inputs');
  }
  for (const baseline of study.baselines) await verifyInventoryImports(JSON.parse(baseline.inputJson).inputs);
}
export function assertStudyTransition(previous, next) {
  if (!previous) return;
  const immutable = () => { throw new Error('Study history is immutable; create a new baseline or candidate revision'); };
  if (!next) immutable();
  for (const key of ['definitions', 'baselines']) {
    if (previous[key].length > next[key].length || previous[key].some((record, i) => stableJson(record) !== stableJson(next[key][i]))) immutable();
  }
  if (previous.candidates.length > next.candidates.length) immutable();
  previous.candidates.forEach((record, i) => {
    const current = next.candidates[i];
    if (!current || record.id !== current.id || record.name !== current.name || record.baselineId !== current.baselineId
      || record.versions.length > current.versions.length || record.versions.some((version, j) => stableJson(version) !== stableJson(current.versions[j]))) immutable();
  });
}
