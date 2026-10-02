import { engineeringInputs, candidateInputs, stableJson, validateStudy, verifyStudyDigests } from './study.mjs';
import { buildRtJob } from './rt-job.mjs';
import { PATH_SOLVER_PROFILE, parseRunCaptureHeader } from './run-capture.mjs';

const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(value => value.toString(16).padStart(2, '0')).join('');
export function resolveRunInputs(project, reference = { kind: 'working' }) {
  if (reference.kind === 'working') return { inputs: engineeringInputs(project), definition: project.study?.definitions.at(-1) ?? null,
    reference: { kind: 'working' }, baseline: null, candidate: null, revision: null, changes: [] };
  const errors = validateStudy(project.study); if (errors.length) throw new Error(errors[0]);
  const candidate = reference.kind === 'candidate' ? project.study?.candidates.find(item => item.id === reference.candidateId) : null;
  const revision = candidate?.versions.find(item => item.version === reference.version);
  if (reference.kind === 'candidate' && !revision) throw new Error('Candidate revision not found in this project');
  const baselineId = candidate?.baselineId ?? reference.baselineId;
  const baseline = project.study?.baselines.find(item => item.id === baselineId);
  if (!baseline || !['baseline', 'candidate'].includes(reference.kind)) throw new Error('Baseline not found in this project');
  const payload = JSON.parse(baseline.inputJson);
  return { inputs: candidate ? candidateInputs(project.study, candidate.id, revision.version) : payload.inputs,
    definition: payload.definition, reference: candidate ? { kind: 'candidate', baselineId, candidateId: candidate.id, version: revision.version } : { kind: 'baseline', baselineId },
    baseline, candidate, revision, changes: revision ? JSON.parse(revision.inputJson).changes : [] };
}
export function candidateRunProblems(project, reference, siteId) {
  const resolved = resolveRunInputs(project, reference);
  return resolved.changes.flatMap(change => change.field !== 'heightM'
    ? [`${change.cellId ?? change.siteId} · ${change.field}: the isotropic path solver cannot apply this sector RF setting.`]
    : change.siteId !== siteId ? [`${change.siteId} · heightM: this job only evaluates selected transmitter ${siteId}.`] : []);
}
export async function prepareStudyRun(project, reference, siteId, receiver, options = {}, { now = () => new Date().toISOString() } = {}) {
  await verifyStudyDigests(project.study);
  const resolved = resolveRunInputs(project, reference), problems = candidateRunProblems(project, reference, siteId);
  if (problems.length) throw new Error(problems.join(' '));
  const job = buildRtJob(resolved.inputs, siteId, receiver, options);
  const networkInputJson = stableJson(resolved.inputs), jobJson = stableJson(job);
  const preparedAt = typeof now === 'function' ? now() : now;
  const dataset = resolved.inputs.driveMeasurements;
  const origin = dataset?.evidence?.origin ?? (dataset && /synthetic(?:[-_ .]|$)/i.test(dataset.fileName) ? 'synthetic' : dataset ? 'unknown' : 'none');
  const header = parseRunCaptureHeader({ schemaVersion: 1, kind: 'ran-path-input', preparedAt,
    reference: resolved.reference, definitionVersion: resolved.definition?.version ?? null,
    baselineSha256: resolved.baseline?.sha256 ?? null, candidateSha256: resolved.revision?.sha256 ?? null,
    networkInputSha256: await hash(networkInputJson), jobSha256: await hash(jobJson),
    datasetSha256: dataset ? await hash(stableJson(dataset)) : null, datasetOrigin: origin, solverProfile: PATH_SOLVER_PROFILE });
  const result = { ...job, runCapture: { ...header, networkInputJson, jobJson } };
  if (new TextEncoder().encode(JSON.stringify(result)).length > 1_990_000) throw new Error('Frozen run inputs exceed the 2 MB job request limit. Reduce source size or create a bounded project.');
  return result;
}
export async function runInputStatus(project, capture) {
  if (!capture) return { kind: 'unknown', message: 'This result has no frozen input identity.' };
  try {
    const header = parseRunCaptureHeader(capture), resolved = resolveRunInputs(project, header.reference);
    if (header.networkInputSha256 !== await hash(stableJson(resolved.inputs))) return { kind: 'stale', message: 'Network inputs changed since this run. Retained output still describes its original inputs.' };
    if (header.reference.kind === 'working' && header.definitionVersion !== (resolved.definition?.version ?? null)) return { kind: 'stale', message: 'Study definition changed since this working-network run.' };
    if (resolved.baseline && resolved.baseline.sha256 !== header.baselineSha256 || resolved.revision && resolved.revision.sha256 !== header.candidateSha256) return { kind: 'stale', message: 'Captured reference content does not match this result.' };
    if (resolved.candidate && resolved.revision.version < resolved.candidate.versions.length) return { kind: 'historical', message: `Historical candidate v${resolved.revision.version}; newer revisions are retained separately.` };
    return { kind: 'current', message: 'Result input identity matches the selected saved network version.' };
  } catch { return { kind: 'unknown', message: 'Captured input reference is unavailable or invalid in this project.' }; }
}
