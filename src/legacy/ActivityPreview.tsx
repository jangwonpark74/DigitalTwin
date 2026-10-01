import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createManifest } from '../../model.mjs';
import { buildUseCasePlanSpec } from '../../usecases.mjs';
import { activateWorkspaceProject, appendWorkspaceLog } from '../../workspaces.mjs';
import { AppController } from '../app/AppController';
import PreviewWorkspaceShell from '../app/PreviewWorkspaceShell';
import { isPreviewRoute, previewRoutes, type PreviewRouteId } from '../app/routeRegistry';
import { buildPreviewContext } from '../app/selectors';
import type { WorkspaceSnapshot } from '../api/schemas';
import DrivePreviewLeaf from '../features/drive/DrivePreviewLeaf';
import HardwarePreviewLeaf from '../features/hardware/HardwarePreviewLeaf';
import ArtifactsPreviewLeaf from '../features/artifacts/ArtifactsPreviewLeaf';
import SitePlannerPreviewLeaf from '../features/site-planner/SitePlannerPreviewLeaf';
import { SitePlannerSession } from '../features/site-planner/SitePlannerSession';
import RadioMapPreview from '../features/radio/RadioMapPreview';
import RadioPreviewLeaf from '../features/radio/RadioPreviewLeaf';
import { RadioSession } from '../features/radio/RadioSession';
import '../../dm.css';
import '../../hardware-workspace.css';
import '../../radio.css';
import '../features/site-planner/site-planner.css';
import '../features/artifacts/artifacts-preview.css';
import './activity-preview.css';

import RunRecordsPanel from '../features/artifacts/RunRecordsPanel';
import RayTracingPreviewLeaf from '../features/ray-tracing/RayTracingPreviewLeaf';
import VirtualUeFleetLeaf from '../features/ues/VirtualUeFleetLeaf';
import StackPreviewLeaf from '../features/stack/StackPreviewLeaf';
import AbPreviewLeaf from '../features/use-cases/AbPreviewLeaf';
import DataPreviewLeaf from '../features/use-cases/DataPreviewLeaf';
import SchedulePreviewLeaf from '../features/tasks/SchedulePreviewLeaf';
import TaskBoardPreviewLeaf from '../features/tasks/TaskBoardPreviewLeaf';
import SoftwarePreviewLeaf from '../features/software/SoftwarePreviewLeaf';
import MonitoringPreviewLeaf from '../features/monitoring/MonitoringPreviewLeaf';
import ActivityPreviewLeaf from '../features/activity/ActivityPreviewLeaf';
import ProjectsPreviewLeaf from '../features/projects/ProjectsPreviewLeaf';
import MissionControlPage from '../features/mission-control/MissionControlPage';

type ActivityPreviewProps = { controller?: AppController; initialRoute?: PreviewRouteId };

export default function ActivityPreview({ controller: provided, initialRoute = 'activity' }: ActivityPreviewProps) {
  const [controller] = useState(() => provided ?? new AppController());
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [radioSession] = useState(() => new RadioSession('pending', { sites: [] }));
  const [sitePlannerSession] = useState(() => new SitePlannerSession('pending', { sites: [] }));
  const [actionError, setActionError] = useState('');
  const [comparison, setComparison] = useState<NonNullable<Awaited<ReturnType<AppController['compareServer']>>> | null>(null);
  const [route, setRoute] = useState<PreviewRouteId>(initialRoute);
  const selectedSite = useRef<{ projectId: string; siteId: string } | null>(null);
  const focusTarget = useRef<HTMLElement>(null);
  const focused = useRef(false);

  useEffect(() => {
    let mounted = true;
    void controller.hydrate().catch(error => {
      if (mounted) setActionError(error instanceof Error ? error.message : String(error));
    });
    return () => { mounted = false; };
  }, [controller]);

  useEffect(() => {
    if (snapshot.status === 'ready' && !focused.current) {
      focusTarget.current?.focus({ preventScroll: true });
      focused.current = true;
    }
  }, [snapshot.status]);

  const navigate = useCallback((route: string) => {
    if (isPreviewRoute(route)) {
      setRoute(route);
      focusTarget.current?.focus({ preventScroll: true });
    }
  }, [controller]);

  const selectSite = useCallback((siteId: string) => {
    const state = controller.getSnapshot().workspace;
    const record = state?.projects.find(item => item.id === state.activeProjectId);
    const sites = (record?.project.sites as { id: string }[] | undefined) ?? [];
    if (record && sites.some(site => site.id === siteId)) selectedSite.current = { projectId: record.id, siteId };
  }, [controller]);

  const exportManifest = useCallback(async () => {
    const state = controller.getSnapshot().workspace;
    if (!state) return;
    const record = state.projects.find(item => item.id === state.activeProjectId);
    if (!record) return;
    try {
      const manifest = createManifest(record.project as Parameters<typeof createManifest>[0]);
      const url = URL.createObjectURL(new Blob([manifest], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'atlas-ran-twin-manifest.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await controller.dispatch(workspace => appendWorkspaceLog(workspace, record.id,
        { title: 'Manifest exported', detail: 'Local planning configuration downloaded' }) as WorkspaceSnapshot);
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [controller]);

  const exportUseCase = useCallback(async (kind: 'ab' | 'data') => {
    const state = controller.getSnapshot().workspace;
    const record = state?.projects.find(item => item.id === state.activeProjectId);
    if (!record) return;
    try {
      const spec = buildUseCasePlanSpec(record.project, kind);
      const url = URL.createObjectURL(new Blob([JSON.stringify(spec, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `atlas-ran-${kind}-plan.json`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      await controller.dispatch(workspace => appendWorkspaceLog(workspace, record.id,
        { title: 'Use-case plan exported', detail: kind }) as WorkspaceSnapshot);
      setActionError('');
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    }
  }, [controller]);

  const active = snapshot.workspace?.projects.find(item => item.id === snapshot.workspace?.activeProjectId);
  useEffect(() => {
    if (active) radioSession.setProject(active.id, active.project as unknown as { sites: { id: string }[] });
  }, [active, radioSession]);
  useEffect(() => {
    if (active) sitePlannerSession.setProject(active.id, active.project as unknown as {
      sites: { id: string; cells: { id: string }[] }[];
    });
  }, [active, sitePlannerSession]);
  return (
    <section className="activity-preview" role="region" aria-label="Activity migration preview" ref={focusTarget} tabIndex={-1}>
      <PreviewWorkspaceShell route={route} context={buildPreviewContext(active ?? null, snapshot.workspace?.projects.length ?? 0)} onNavigate={navigate}>
      {route === 'software' && <p className="stack-scroll-hint">Scroll the software registry table horizontally to inspect all columns.</p>}
      {route === 'ab' && <p className="stack-scroll-hint">Scroll the paired A/B run matrix horizontally to inspect all columns.</p>}
      {snapshot.workspace && (
        <label className="activity-project-select">Active project
          <select value={snapshot.workspace.activeProjectId} onChange={event => {
            setActionError('');
            setComparison(null);
            selectedSite.current = null;
            void controller.dispatch(state => activateWorkspaceProject(state, event.target.value) as WorkspaceSnapshot)
              .then(() => {
                focusTarget.current?.focus({ preventScroll: true });
              })
              .catch(error => setActionError(error instanceof Error ? error.message : String(error)));
          }}>
            {snapshot.workspace.projects.filter(item => item.status === 'active').map(item =>
              <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
      )}
      {snapshot.status === 'loading' || snapshot.status === 'idle' ? <p role="status">Loading local workspace…</p> : null}
      {snapshot.status === 'saving' ? <p className="preview-save-status" role="status">Saving to the local database…</p> : null}
      {actionError && !snapshot.error && !snapshot.dirty && <div role="alert">Input rejected · {actionError}</div>}
      {(snapshot.error || (actionError && snapshot.dirty)) && <div role="alert">Database save needs attention · {actionError || snapshot.error}
        <button type="button" onClick={() => {
          setActionError('');
          setComparison(null);
          const action = snapshot.dirty ? controller.retrySave() : controller.hydrate();
          void action.catch(error => setActionError(error instanceof Error ? error.message : String(error)));
        }}>Retry</button>
        {snapshot.workspace && <>
          <button type="button" onClick={() => {
            setActionError('');
            setComparison(null);
            void controller.compareServer().then(result => { if (result) setComparison(result); })
              .catch(error => setActionError(error instanceof Error ? error.message : String(error)));
          }}>Compare</button>
          <button type="button" onClick={() => {
            if (snapshot.dirty && !window.confirm('Reload the database and discard unsaved changes?')) return;
            setComparison(null);
            setActionError('');
            void controller.hydrate({ discardUnsaved: snapshot.dirty })
              .then(() => focusTarget.current?.focus({ preventScroll: true }))
              .catch(error => setActionError(error instanceof Error ? error.message : String(error)));
          }}>Reload database</button>
        </>}
      </div>}
      {comparison && <section className="workspace-comparison" role="region" aria-label="Workspace comparison">
        <h2>Local draft versus database</h2>
        <p>Local revision {comparison.localRevision} · Database revision {comparison.serverRevision}</p>
        <p>Active project: local {comparison.localActiveProjectId} · database {comparison.serverActiveProjectId ?? 'none'}</p>
        {comparison.differences.length ? <ul>{comparison.differences.map(item =>
          <li key={item.id}>{item.localName ?? 'Not in local draft'} / {item.serverName ?? 'Not in database'} · {item.kind}
            {item.changedPaths.length > 0 && <small> · Changed fields: {item.changedPaths.join(', ')}</small>}
          </li>)}</ul>
          : <p>No project differences in this snapshot.</p>}
        <p>Comparison is read-only; no draft has been overwritten.</p>
      </section>}
      {route === 'projects' ? <ProjectsPreviewLeaf controller={controller} onNavigate={navigate} />
        : route === 'overview' ? <MissionControlPage controller={controller} onNavigate={navigate} />
        : active && (route === 'stack' ? <StackPreviewLeaf controller={controller} record={active} />
        : route === 'ab' ? <AbPreviewLeaf controller={controller} record={active} onExport={() => { void exportUseCase('ab'); }} />
        : route === 'data' ? <DataPreviewLeaf controller={controller} record={active} onExport={() => { void exportUseCase('data'); }} />
        : route === 'schedule' ? <SchedulePreviewLeaf controller={controller} record={active} />
        : route === 'artifacts' ? <ArtifactsPreviewLeaf controller={controller} record={active} onNavigate={navigate} />
        : route === 'ues' ? <VirtualUeFleetLeaf controller={controller} record={active} onSiteSelect={selectSite} onError={setActionError} />
        : route === 'drive'
        ? <DrivePreviewLeaf controller={controller} record={active} onError={setActionError} />
        : route === 'hardware' ? <HardwarePreviewLeaf controller={controller} record={active} onError={setActionError} />
        : route === 'planner' ? <SitePlannerPreviewLeaf controller={controller} record={active} session={sitePlannerSession}
          onError={setActionError} onNavigate={navigate} />
        : route === 'radio' ? <RadioPreviewLeaf controller={controller} record={active} session={radioSession}
          onError={setActionError} onNavigate={navigate} />
        : route === 'map' ? <RadioMapPreview controller={controller} record={active} session={radioSession}
          onError={setActionError} onComplete={() => navigate('radio')} onNavigate={navigate} />
        : route === 'ray' ? <RayTracingPreviewLeaf controller={controller} record={active} onNavigate={navigate} />
        : route === 'software' ? <SoftwarePreviewLeaf controller={controller} record={active} />
        : route === 'monitoring' ? <MonitoringPreviewLeaf controller={controller} record={active} />
        : route === 'activity' ? <ActivityPreviewLeaf record={active} onExport={exportManifest} />
        : route === 'tasks' ? <>
          <TaskBoardPreviewLeaf controller={controller} record={active} />
          <RunRecordsPanel controller={controller} record={active} />
        </> : <p role="alert">This preview route is not available.</p>)}
      </PreviewWorkspaceShell>
    </section>
  );
}
