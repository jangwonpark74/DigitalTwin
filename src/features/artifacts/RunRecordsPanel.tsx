import { useEffect, useSyncExternalStore } from 'react';
import RunCaptureSummary from '../study/RunCaptureSummary';
import RunRecoveryActions from './RunRecoveryActions';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import './run-records.css';

type ProjectRecord = WorkspaceSnapshot['projects'][number];

export default function RunRecordsPanel({ controller, record, pollIntervalMs = 1500, title = 'Task run results' }: { controller: AppController; record: ProjectRecord; pollIntervalMs?: number; title?: string }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const runs = snapshot.runs;
  const selected = snapshot.selectedRun;
  const page = runs.data;

  useEffect(() => {
    void controller.refreshRuns({ limit: 50 }).catch(() => {});
  }, [controller, record.id]);

  useEffect(() => {
    if (!selected.data || !['queued', 'running', 'cancelling'].includes(selected.data.status) || selected.status === 'loading') return;
    const id = selected.data.id;
    const timer = window.setTimeout(() => { void controller.selectRun(id, { background: true }).catch(() => {}); }, pollIntervalMs);
    return () => window.clearTimeout(timer);
  }, [controller, record.id, selected.data?.id, selected.data?.status, selected.status, pollIntervalMs]);

  const refresh = () => { void controller.refreshRuns({ limit: 50 }).catch(() => {}); };
  const select = (id: string) => { void controller.selectRun(id).catch(() => {}); };
  const more = () => { void controller.loadOlderRuns({ limit: 50 }).catch(() => {}); };

  return <section className="run-records-panel" role="region" aria-label="Run records">
    <header><div><h2>{title}</h2><p>Server-recorded Sionna-RT jobs for {record.name}. Planned delivery tasks remain unexecuted.</p></div>
      <div><button type="button" onClick={refresh} disabled={runs.status === 'loading'}>Refresh run list</button>
        {page?.nextOffset !== null && page && <button type="button" onClick={more} disabled={runs.status === 'loading'}>Load older runs</button>}</div>
    </header>
    {runs.error && <p role="alert">Run list unavailable · {runs.error}</p>}
    {runs.status === 'loading' && !page && <p role="status">Loading run records…</p>}
    {page && <p className="run-record-count">{page.total} {page.total === 1 ? 'run' : 'runs'} recorded · showing {page.runs.length}</p>}
    {!page && runs.status !== 'loading' && runs.status !== 'error' && <p>No run query has been loaded.</p>}
    {page && page.runs.length === 0 && <p>No Sionna-RT run has been recorded for this project.</p>}
    {page && page.runs.length > 0 && <ul className="run-record-list">
      {page.runs.map(run => <li key={run.id}><button type="button" aria-current={selected.data?.id === run.id ? 'true' : undefined}
        aria-label={`Run ${run.id} · ${run.status} · ${run.totalPaths === null ? 'Path count unavailable' : `${run.totalPaths} paths`}`}
        onClick={() => select(run.id)} disabled={selected.status === 'loading'}>
        <span className="run-record-description"><strong title={run.id}>Run {run.id.slice(0, 8)}</strong><small>{Number.isFinite(Date.parse(run.createdAt))
          ? new Date(run.createdAt).toLocaleString() : run.createdAt} · {run.kind}</small></span>
        <span className="run-record-status" data-status={run.status}>{run.status}</span>
        <span className="run-record-metric">{run.totalPaths === null ? 'Path count unavailable' : `${run.totalPaths} paths`}</span>
      </button></li>)}
    </ul>}
    {selected.status === 'loading' && <p role="status">Loading selected run…</p>}
    {selected.error && <p role="alert">Run detail unavailable · {selected.error}</p>}
    {selected.data && <article className="run-record-detail" aria-label={`Run detail ${selected.data.id}`}>
      <header><div><h3>Selected run</h3><code>Run {selected.data.id}</code></div><span className="run-record-status" data-status={selected.data.status}>{selected.data.status}</span></header>
      {selected.data.error && <p role="alert">{selected.data.error}</p>}
      {selected.data.result && <p>{String(selected.data.result.totalPaths)} paths returned</p>}
      {selected.data.retryOf && <p>Exact-input retry of <button type="button" onClick={() => select(selected.data!.retryOf!)}>Run {selected.data.retryOf.slice(0, 8)}</button></p>}
      <RunCaptureSummary project={record.project} capture={selected.data.input.runCapture} trusted />
      {selected.data.kind === 'sionna-rt' && <RunRecoveryActions key={`${record.id}:${selected.data.id}`} controller={controller} record={record}
        run={{ id: selected.data.id, status: selected.data.status, hasCapture: Boolean(selected.data.input.runCapture) }} onResult={async receipt => {
          await controller.refreshRuns({ limit: 50 });
          if (controller.getSnapshot().workspace?.activeProjectId === record.id) await controller.selectRun(receipt.id);
        }} />}
      {!!selected.data.events?.length && <details className="run-event-timeline"><summary>Run lifecycle · {selected.data.events.length} events</summary>
        <ol>{selected.data.events.map(event => <li key={event.sequence}><time>{new Date(event.when).toLocaleString()}</time><strong>{event.status}</strong><span>{event.detail}</span></li>)}</ol></details>}
      <details><summary>Frozen request and result JSON</summary><pre>{JSON.stringify({ input: selected.data.input, result: selected.data.result }, null, 2)}</pre></details>
    </article>}
  </section>;
}
