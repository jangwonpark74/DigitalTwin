export type RunReference = { kind: 'working' } | { kind: 'baseline'; baselineId: string }
  | { kind: 'candidate'; candidateId: string; version: number; baselineId?: string };
export function studyReferenceValue(selection?: { kind: string; id?: string; version?: number }) {
  return selection?.kind === 'baseline' && selection.id ? `baseline:${selection.id}`
    : selection?.kind === 'candidate' && selection.id && selection.version ? `candidate:${selection.id}:${selection.version}` : 'working';
}
export function runReference(value: string): RunReference {
  if (value === 'working') return { kind: 'working' };
  const [kind, id, revision] = value.split(':');
  if (kind === 'baseline' && id) return { kind: 'baseline', baselineId: id };
  if (kind === 'candidate' && id && Number.isInteger(Number(revision)) && Number(revision) > 0) return { kind: 'candidate', candidateId: id, version: Number(revision) };
  throw new Error('Choose an available propagation input version.');
}
export function runReferenceValue(reference: RunReference) {
  return reference.kind === 'working' ? 'working' : reference.kind === 'baseline' ? `baseline:${reference.baselineId}` : `candidate:${reference.candidateId}:${reference.version}`;
}
