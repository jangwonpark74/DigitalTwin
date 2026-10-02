import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import RunRecordsPanel from './RunRecordsPanel';

export default function RunsWorkspace({ controller, record, onNavigate }: {
  controller: AppController; record: WorkspaceSnapshot['projects'][number]; onNavigate: (route: string) => void;
}) {
  return <section className="runs-workspace" role="region" aria-label="Jobs and runs workspace">
    <header className="study-page-header"><div><p className="study-eyebrow">SIMULATION / EXECUTION EVIDENCE</p><h1>Jobs &amp; runs</h1>
      <p>Inspect local path execution, retained input versions and recovery history for {record.name}.</p></div>
      <button type="button" className="button outline" onClick={() => onNavigate('ray')}>Prepare propagation run</button></header>
    <p className="artifacts-boundary">Recorded local Sionna-RT path jobs use uncalibrated geometry and isotropic antennas. Work-plan dates and tasks do not schedule this solver.</p>
    <RunRecordsPanel controller={controller} record={record} title="Recorded path runs" />
  </section>;
}
