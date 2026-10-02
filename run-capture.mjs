// Versioned execution assumptions. This profile is mirrored and checked by the local server.
export const PATH_SOLVER_PROFILE = Object.freeze({ engine: 'sionna-rt', profileVersion: 1, seed: 42,
  antenna: 'isotropic-single-element-v', buildingMaterial: 'concrete', groundMaterial: 'concrete',
  buildingThicknessM: 0.2, groundThicknessM: 0.1, syntheticArray: true, los: true,
  diffuseReflection: false, refraction: false, maxPathsPerSource: 1000, retainedPaths: 200, maxRuntimeSeconds: 180 });
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = value => typeof value === 'string' && /^[\w-]{1,80}$/.test(value);
const fields = ['schemaVersion', 'kind', 'preparedAt', 'reference', 'definitionVersion', 'baselineSha256',
  'candidateSha256', 'networkInputSha256', 'jobSha256', 'datasetSha256', 'datasetOrigin', 'solverProfile', 'networkInputJson', 'jobJson'];
const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
export function parseRunCaptureHeader(value) {
  if (!value || Object.keys(value).some(key => !fields.includes(key)) || value.schemaVersion !== 1 || value.kind !== 'ran-path-input'
    || typeof value.preparedAt !== 'string' || !isoTime.test(value.preparedAt) || !Number.isFinite(Date.parse(value.preparedAt))
    || !hash(value.networkInputSha256) || !hash(value.jobSha256)
    || ![value.baselineSha256, value.candidateSha256, value.datasetSha256].every(item => item === null || hash(item))
    || (value.definitionVersion !== null && (!Number.isInteger(value.definitionVersion) || value.definitionVersion < 1))
    || !['none', 'unknown', 'synthetic', 'field-measured'].includes(value.datasetOrigin)
    || !value.solverProfile || Object.keys(PATH_SOLVER_PROFILE).some(key => value.solverProfile[key] !== PATH_SOLVER_PROFILE[key])
    || Object.keys(value.solverProfile).length !== Object.keys(PATH_SOLVER_PROFILE).length) throw new Error('Invalid run capture metadata');
  const ref = value.reference;
  const referenceFields = ref?.kind === 'working' ? ['kind'] : ref?.kind === 'baseline' ? ['kind', 'baselineId'] : ['kind', 'baselineId', 'candidateId', 'version'];
  if (!ref || Object.keys(ref).length !== referenceFields.length || Object.keys(ref).some(key => !referenceFields.includes(key))
    || (ref.kind === 'working' ? value.baselineSha256 !== null || value.candidateSha256 !== null
    : ref.kind === 'baseline' ? !id(ref.baselineId) || !hash(value.baselineSha256) || value.candidateSha256 !== null
    : ref.kind === 'candidate' ? !id(ref.baselineId) || !id(ref.candidateId) || !hash(value.baselineSha256) || !hash(value.candidateSha256)
      || !Number.isInteger(ref.version) || ref.version < 1 : true)) throw new Error('Invalid run capture reference');
  return { schemaVersion: 1, kind: 'ran-path-input', preparedAt: value.preparedAt, reference: structuredClone(ref),
    definitionVersion: value.definitionVersion, baselineSha256: value.baselineSha256, candidateSha256: value.candidateSha256,
    networkInputSha256: value.networkInputSha256, jobSha256: value.jobSha256, datasetSha256: value.datasetSha256,
    datasetOrigin: value.datasetOrigin, solverProfile: { ...PATH_SOLVER_PROFILE } };
}
