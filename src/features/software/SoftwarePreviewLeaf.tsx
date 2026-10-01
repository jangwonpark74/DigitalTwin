import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../../app/AppController';
import { applySoftwareVersion } from './softwareCommands';

type SoftwareItem = { id: string; name: string; layer: string; targetVersion: string; installation: string };
type SoftwareRecord = { id: string; name: string; project: unknown };

export default function SoftwarePreviewLeaf({ controller, record }: { controller: AppController; record: SoftwareRecord }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const active = snapshot.workspace?.projects.find(item => item.id === record.id);
  const project = (active?.project ?? record.project) as { management: { software: SoftwareItem[] } };
  const current = project.management.software;
  const signature = current.map(item => `${item.id}:${item.targetVersion}`).join('|');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => { setDrafts({}); setError(''); }, [record.id, signature]);

  const change = (softwareId: string, value: string) => {
    setDrafts(previous => ({ ...previous, [softwareId]: value }));
    try {
      const save = applySoftwareVersion(controller, record.id, softwareId, value);
      if (!save) return;
      setError('');
      void save.catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setDrafts(previous => ({ ...previous, [softwareId]: current.find(item => item.id === softwareId)?.targetVersion ?? '' }));
    }
  };

  return <section className="software-preview" role="region" aria-label="Software preview route">
    <header><div><p className="eyebrow">SYSTEM · CONFIGURATION ONLY</p><h1>Software management</h1>
      <p>Track intended components and package versions without implying installation.</p></div>
      <span className="mini-pill warn">NOT DEPLOYED</span></header>
    <p className="artifacts-boundary">Version targets are planning inputs. No packages are downloaded, installed, or verified here.</p>
    {error && <p role="alert">Input rejected · {error}</p>}
    <div className="ops-summary"><div><strong>{current.length}</strong><span>software targets</span></div>
      <div><strong>0</strong><span>verified installs</span></div><div><strong>0</strong><span>running services</span></div></div>
    <section className="panel"><header><div><h2>Software registry</h2><p>Edit version targets; no deployments or package downloads occur.</p></div>
      <span className="mini-pill">CONFIGURATION ONLY</span></header>
      <div className="table-wrap software-table-wrap" role="region" aria-label="Software registry table; scroll horizontally to inspect all columns" tabIndex={0}>
        <table className="data-table"><thead><tr><th>Component</th><th>Role</th><th>Target version</th><th>Installation</th></tr></thead>
          <tbody>{current.map(item => <tr key={item.id}><td><strong>{item.name}</strong><small className="ops-row-id">{item.id}</small></td>
            <td>{item.layer}</td><td><input aria-label={`Target version for ${item.name}`} maxLength={40}
              value={drafts[item.id] ?? item.targetVersion} onChange={event => change(item.id, event.target.value)} /></td>
            <td><span className="mini-pill warn">NOT VERIFIED</span></td></tr>)}</tbody>
        </table>
      </div>
      <p className="detail-copy">The two RAN package entries remain version targets. A paired experiment still requires matching scene, traffic, seeds, and verified deployment artifacts.</p>
    </section>
  </section>;
}
