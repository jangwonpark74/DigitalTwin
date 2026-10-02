import { useRunInputStatus } from './useRunInputStatus';
import { parseRunCaptureHeader } from '../../../run-capture.mjs';
import './study.css';

export default function RunCaptureSummary({ project, capture, trusted = false }: {
  project: Record<string, unknown>; capture: unknown; trusted?: boolean;
}) {
  const state = useRunInputStatus(project, capture, trusted);
  let header: ReturnType<typeof parseRunCaptureHeader> | null = null;
  try { if (capture) header = parseRunCaptureHeader(capture); } catch { /* Missing / malformed identity has no current-version claim. */ }
  if (!header) return <p className="study-helper">This result has no frozen input identity.</p>;
  const ref = header.reference;
  return <section className="run-capture-summary" aria-label="Run input identity" data-input-status={state.kind}>
    <strong>{ref.kind === 'working' ? 'Working-network capture' : ref.kind === 'baseline' ? `Baseline ${ref.baselineId}` : `Candidate ${ref.candidateId} · v${ref.version}`}</strong>
    <p>{state.message}</p><p>Definition {header.definitionVersion ? `v${header.definitionVersion}` : 'unspecified'} · dataset {header.datasetOrigin} · seed {header.solverProfile.seed}</p>
    <dl><div><dt>Network inputs</dt><dd title={header.networkInputSha256}>{header.networkInputSha256.slice(0, 16)}…</dd></div>
      <div><dt>Job settings</dt><dd title={header.jobSha256}>{header.jobSha256.slice(0, 16)}…</dd></div></dl>
    <p className="study-helper">Input identity identifies a saved configuration. Geometry, materials and antenna assumptions remain uncalibrated.</p>
  </section>;
}
