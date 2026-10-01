import { useEffect, useSyncExternalStore } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';

type ProjectRecord = WorkspaceSnapshot['projects'][number];

export default function RunRecordsPanel({ controller, record }: { controller: AppController; record: ProjectRecord }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const runs = snapshot.runs;
  const selected = snapshot.selectedRun;
  const page = runs.data;

  useEffect(() => {
    void controller.refreshRuns({ limit: 50 }).catch(() => {});
  }, [controller, record.id]);

  const refresh = () => { void controller.refreshRuns({ limit: 50 }).catch(() => {}); };
  const select = (id: string) => { void controller.selectRun(id).catch(() => {}); };
  const more = () => { void controller.loadOlderRuns({ limit: 50 }).catch(() => {}); };

  return <section className="run-records-panel" role="region" aria-label="Run records">
    <header><div><h2>Task run results</h2><p>Server-recorded Sionna-RT jobs for {record.name}. Planned delivery tasks remain unexecuted.</p></div>
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
        onClick={() => select(run.id)} disabled={selected.status === 'loading'}>
        <span><strong>Run {run.id} · {run.status}</strong><small>{Number.isFinite(Date.parse(run.createdAt))
          ? new Date(run.createdAt).toLocaleString() : run.createdAt} · {run.kind}</small></span>
        <span>{run.totalPaths === null ? 'Path count unavailable' : `${run.totalPaths} paths`}</span>
      </button></li>)}
    </ul>}
    {selected.status === 'loading' && <p role="status">Loading selected run…</p>}
    {selected.error && <p role="alert">Run detail unavailable · {selected.error}</p>}
    {selected.data && <article className="run-record-detail" aria-label={`Run detail ${selected.data.id}`}>
      <h3>Run {selected.data.id}</h3><p>Status: {selected.data.status}</p>
      {selected.data.error && <p role="alert">{selected.data.error}</p>}
      {selected.data.result && <p>{String(selected.data.result.totalPaths)} paths returned</p>}
      <pre>{JSON.stringify({ input: selected.data.input, result: selected.data.result }, null, 2)}</pre>
    </article>}
  </section>;
}
