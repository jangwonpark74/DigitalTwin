import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { cancelRtJob, getRtCapability, retryRtJob } from '../../api/rtJobsApi';
import type { AppController } from '../../app/AppController';

type Receipt = Awaited<ReturnType<typeof cancelRtJob>> | Awaited<ReturnType<typeof retryRtJob>>;
type Props = { controller: AppController; record: WorkspaceSnapshot['projects'][number];
  run: { id: string; status: string; hasCapture: boolean }; onResult: (receipt: Receipt) => void | Promise<void> };

export default function RunRecoveryActions({ controller, record, run, onResult }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [capability, setCapability] = useState<Awaited<ReturnType<typeof getRtCapability>> | null>(null);
  const [pending, setPending] = useState<'cancel' | 'retry' | 'refresh' | null>(null);
  const [accepted, setAccepted] = useState<Receipt | null>(null);
  const [notice, setNotice] = useState(''), [error, setError] = useState(''), [cancelAccepted, setCancelAccepted] = useState(false);
  const pendingAction = useRef(false), generation = useRef(0);
  useEffect(() => {
    const ticket = ++generation.current;
    setCapability(null); setNotice(''); setError(''); setCancelAccepted(false); setAccepted(null);
    void getRtCapability().then(value => { if (ticket === generation.current) setCapability(value); })
      .catch(() => { if (ticket === generation.current) setError('Run actions could not be checked. Refresh this view to retry.'); });
    return () => { generation.current++; };
  }, [controller, record.id, run.id]);
  const active = snapshot.workspace?.activeProjectId === record.id;
  const status = cancelAccepted && ['queued', 'running'].includes(run.status) ? 'cancelling' : run.status;
  const recoverable = ['failed', 'interrupted', 'cancelled'].includes(status);
  const canCancel = active && capability?.jobActions?.includes('cancel') && ['queued', 'running'].includes(status) && !pending;
  const canRetry = active && record.status === 'active' && capability?.available && capability.jobActions?.includes('retry')
    && recoverable && run.hasCapture && !snapshot.dirty && snapshot.status === 'ready' && !pending && (!accepted || accepted.id === run.id);
  const refreshAccepted = async (receipt: Receipt) => {
    try { await onResult(receipt); }
    catch (cause) { throw new Error(`Request accepted for run ${receipt.id}, but its record could not be refreshed: ${cause instanceof Error ? cause.message : String(cause)}`); }
  };
  const act = async (kind: 'cancel' | 'retry') => {
    if (pendingAction.current || (kind === 'cancel' ? !canCancel : !canRetry)) return;
    const state = controller.getSnapshot();
    if (state.workspace?.activeProjectId !== record.id) return;
    pendingAction.current = true; setPending(kind); setError(''); setNotice(''); setAccepted(null);
    const ticket = generation.current;
    const current = () => ticket === generation.current && controller.getSnapshot().workspace?.activeProjectId === record.id;
    try {
      const result = await (kind === 'cancel' ? cancelRtJob(record.id, run.id) : retryRtJob(record.id, run.id));
      if (!current()) return;
      setAccepted(result);
      if (kind === 'cancel') { setCancelAccepted(true); setNotice('Cancellation requested; awaiting worker exit.'); }
      else setNotice('New run queued using the original frozen request.');
      await refreshAccepted(result);
    } catch (cause) {
      if (current()) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pendingAction.current = false;
      if (current()) setPending(null);
    }
  };
  const refresh = async () => {
    if (!accepted || pendingAction.current || controller.getSnapshot().workspace?.activeProjectId !== record.id) return;
    pendingAction.current = true; setPending('refresh'); setError('');
    const ticket = generation.current;
    try { await refreshAccepted(accepted); }
    catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally {
      pendingAction.current = false;
      if (ticket === generation.current) setPending(null);
    }
  };
  return <section className="run-recovery-actions" aria-label="Run recovery">
    {['queued', 'running', 'cancelling'].includes(status) && <>
      <button type="button" className="button outline" disabled={!canCancel} onClick={() => { void act('cancel'); }}>
        {pending === 'cancel' ? 'Requesting cancellation…' : status === 'cancelling' ? 'Cancellation requested' : 'Cancel path job'}</button>
      {status === 'cancelling' && !notice && <p role="status">Cancellation requested; awaiting worker exit. The worker slot remains occupied.</p>}
    </>}
    {status === 'cancelled' && <p role="status">Worker stopped; output discarded. The frozen request remains in run history.</p>}
    {recoverable && <><button type="button" className="button outline" disabled={!canRetry} onClick={() => { void act('retry'); }}>
      {pending === 'retry' ? 'Queueing retry…' : 'Retry frozen inputs'}</button>
      <p>{run.hasCapture ? 'Reuse the original inputs, receiver, options and seed in a new linked run. Working-network edits are excluded.' : 'This legacy run has no frozen request. Prepare a new run in Propagation.'}</p>
      {run.hasCapture && capability && !capability.available && <p>The configured solver runtime is unavailable.</p>}
      {run.hasCapture && capability && !capability.jobActions?.includes('retry') && <p>This server does not confirm exact-input retry support.</p>}
    </>}
    {notice && status !== 'cancelled' && <p role="status">{notice}</p>}
    {error && <p role="alert">{accepted ? 'Run record unavailable' : 'Run action unavailable'} · {error}</p>}
    {accepted && error && <button type="button" className="button outline" disabled={!active || !!pending} onClick={() => { void refresh(); }}>Refresh accepted run</button>}
  </section>;
}
