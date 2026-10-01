import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { buildRtJob } from '../../../rt-job.mjs';
import { parseDmCsv } from '../../../dm.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import { parseGeoJsonScene, parseRayPaths, sceneFit } from '../../../scene.mjs';
import { appendWorkspaceLog, updateWorkspaceProject } from '../../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import { getRtCapability, getRtJob, submitRtJob } from '../../api/rtJobsApi';
import OpenSiteScene, { type SceneCamera, type SiteSceneProject } from '../site-planner/OpenSiteScene';
import MapScopeControls from '../city-map/MapScopeControls';
import { tracePreview, validPoint, type GeoPoint } from './propagationGeometry';
import type { CapturedBuildings } from './openMapCapture';
import DriveKpiControls, { DriveKpiInspector } from './DriveKpiControls';
import type { DriveMeasurements, DriveMetric, DriveTechnology } from './driveKpi';
import './ray-tracing.css';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type JobState = { id: string; status: 'submitting' | 'queued' | 'running' | 'complete' | 'failed' | 'interrupted'; pathCount?: number; error?: string };
type Props = { controller: AppController; record: ProjectRecord; onNavigate: (route: string) => void; pollIntervalMs?: number };
type RayResults = { provenance: string; paths: { id: string; pathLossDb: number; points: unknown[] }[]; totalPaths: number; fileName: string };
type RtProject = {
  map: { latitude: number; longitude: number; scene: unknown };
  sites: { id: string; name: string; heightM: number; radioLocation: { latitude: number | null; longitude: number | null }; cells?: { azimuthDeg: number; downtiltDeg: number }[] }[];
  channel: { reflections: boolean; diffraction: boolean };
};

export default function RayTracingPreviewLeaf({ controller, record, onNavigate, pollIntervalMs = 1500 }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const project = record.project as unknown as RtProject;
  const [capability, setCapability] = useState<{ status: 'loading' | 'ready' | 'error'; available?: boolean; message?: string }>({ status: 'loading' });
  const [siteId, setSiteId] = useState(project.sites[0]?.id ?? '');
  const [receiver, setReceiver] = useState({ latitude: String(project.map.latitude), longitude: String(project.map.longitude), heightM: '2' });
  const [frequencyGhz, setFrequencyGhz] = useState('3.5');
  const [samplesPerSrc, setSamplesPerSrc] = useState('10000');
  const [maxDepth, setMaxDepth] = useState('2');
  const [camera, setCamera] = useState<SceneCamera>({ yaw: 35, pitch: 48, zoom: 1 });
  const [previewEnabled, setPreviewEnabled] = useState(false);
  const [viewMode, setViewMode] = useState<'preview' | 'saved'>('preview');
  const [pickMode, setPickMode] = useState<'receiver' | 'transmitter' | null>(null);
  const [layers, setLayers] = useState({ direct: true, reflections: true, context: true });
  const [driveMetric, setDriveMetric] = useState<DriveMetric>('rsrp');
  const [driveTechnology, setDriveTechnology] = useState<DriveTechnology>('ALL');
  const [driveVisible, setDriveVisible] = useState(true);
  const [driveIndex, setDriveIndex] = useState<number | null>(null);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveError, setDriveError] = useState('');
  const [fitDriveRequest, setFitDriveRequest] = useState(0);
  const [selectedRayId, setSelectedRayId] = useState<string | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const rayFileInput = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const projectId = record.id;
  const savedRays = (record.project as { rayResults?: RayResults | null }).rayResults;
  const driveMeasurements = (record.project as { driveMeasurements?: DriveMeasurements | null }).driveMeasurements ?? null;
  const driveSamples = useMemo(() => driveMeasurements?.samples.filter(sample => driveTechnology === 'ALL' || sample.technology === driveTechnology) ?? [], [driveMeasurements, driveTechnology]);
  const selectedDriveIndex = driveSamples.some(sample => sample.index === driveIndex) ? driveIndex : driveSamples[0]?.index ?? null;
  useEffect(() => { if (!savedRays) { setViewMode('preview'); setSelectedRayId(null); } }, [savedRays]);
  const selectedSite = project.sites.find(site => site.id === siteId) ?? project.sites[0];
  const located = Number.isFinite(selectedSite?.radioLocation.latitude) && Number.isFinite(selectedSite?.radioLocation.longitude);
  const hasScene = Boolean((project.map.scene as { footprints?: unknown[] } | null)?.footprints?.length);

  useEffect(() => {
    const ticket = ++generation.current;
    let active = true;
    setJob(null);
    setPreviewEnabled(false);
    setViewMode(savedRays ? 'saved' : 'preview');
    setPickMode(null);
    setDriveMetric('rsrp'); setDriveTechnology('ALL'); setDriveVisible(true); setDriveIndex(null);
    setDriveBusy(false); setDriveError(''); setFitDriveRequest(value => value + 1);
    setCamera({ yaw: 35, pitch: 52, zoom: 1 });
    setBusy(false);
    setError('');
    setSiteId(project.sites[0]?.id ?? '');
    setReceiver({ latitude: String(project.map.latitude), longitude: String(project.map.longitude), heightM: '2' });
    setFrequencyGhz('3.5');
    setSamplesPerSrc('10000');
    setMaxDepth('2');
    setSelectedRayId(null);
    setCapability({ status: 'loading' });
    void getRtCapability().then(result => {
      if (active && generation.current === ticket) setCapability({ status: 'ready', ...result });
    }).catch(cause => {
      if (active && generation.current === ticket) setCapability({ status: 'error', available: false,
        message: cause instanceof Error ? cause.message : String(cause) });
    });
    return () => { active = false; generation.current++; };
  }, [projectId]);

  useEffect(() => {
    if (!job || !['queued', 'running'].includes(job.status)) return;
    const ticket = generation.current;
    const timer = window.setTimeout(() => {
      void getRtJob(job.id).then(async current => {
        if (ticket !== generation.current || controller.getSnapshot().workspace?.activeProjectId !== projectId) return;
        if (current.status === 'failed' || current.status === 'interrupted') {
          setJob({ id: current.id, status: current.status, error: current.error ?? 'The local RT worker failed.' });
          void controller.refreshRuns({ limit: 50 }).catch(() => {});
          return;
        }
        if (current.status === 'complete') {
          const result = current.result;
          const rays = result?.paths.length
            ? parseRayPaths(result, { fileName: String(result.fileName), importedAt: String(result.importedAt), provenance: 'sionna-rt-local' })
            : null;
          const detail = rays ? `${current.id} · ${rays.totalPaths} paths · uncalibrated` : `${current.id} · no valid paths`;
          await controller.dispatch(workspace => appendWorkspaceLog(
            updateWorkspaceProject(workspace, projectId, (target: { rayResults: unknown }) => { target.rayResults = rays; }), projectId,
            { title: 'Sionna-RT job completed', detail }) as WorkspaceSnapshot);
          if (ticket !== generation.current || controller.getSnapshot().workspace?.activeProjectId !== projectId) return;
          setViewMode(rays ? 'saved' : 'preview');
          setSelectedRayId(null);
          setJob({ id: current.id, status: 'complete', pathCount: rays?.totalPaths ?? 0 });
          void controller.refreshRuns({ limit: 50 }).catch(() => {});
          return;
        }
        setJob({ id: current.id, status: current.status });
      }).catch(cause => {
        if (ticket === generation.current) setJob({ id: job.id, status: 'failed',
          error: cause instanceof Error ? cause.message : String(cause) });
      });
    }, pollIntervalMs);
    return () => window.clearTimeout(timer);
  }, [controller, job, pollIntervalMs, projectId]);

  const run = async () => {
    setError('');
    const initial = controller.getSnapshot();
    if (!initial.workspace || initial.workspace.activeProjectId !== projectId) {
      setError('Select this project before starting an RT job.');
      return;
    }
    const ticket = generation.current;
    try {
      const input = { latitude: Number(receiver.latitude), longitude: Number(receiver.longitude), heightM: Number(receiver.heightM) };
      const options = { frequencyGhz: Number(frequencyGhz), samplesPerSrc: Number(samplesPerSrc), maxDepth: Number(maxDepth) };
      buildRtJob(project as Parameters<typeof buildRtJob>[0], siteId, input, options);
      setBusy(true);
      setJob({ id: 'saving', status: 'submitting' });
      await controller.dispatch(workspace => workspace);
      if (ticket !== generation.current) return;
      const saved = controller.getSnapshot();
      if (!saved.workspace || saved.dirty || saved.status !== 'ready' || saved.workspace.activeProjectId !== projectId) {
        throw new Error('Save the active project to the database before starting an RT run.');
      }
      const savedRecord = saved.workspace.projects.find(item => item.id === projectId);
      if (!savedRecord) throw new Error('The active project is no longer available.');
      const payload = buildRtJob(savedRecord.project as Parameters<typeof buildRtJob>[0], siteId, input, options);
      const submitted = await submitRtJob(projectId, payload);
      if (ticket !== generation.current || controller.getSnapshot().workspace?.activeProjectId !== projectId) return;
      setJob({ id: submitted.id, status: submitted.status });
      void controller.refreshRuns({ limit: 50 }).catch(() => {});
    } catch (cause) {
      if (ticket === generation.current) {
        setJob(null);
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  };

  const importRayFile = async (file?: File) => {
    if (!file) return;
    const ticket = generation.current;
    setError('');
    setBusy(true);
    try {
      if (file.size > 3_000_000) throw new Error('Ray file must be smaller than 3 MB.');
      const rays = parseRayPaths(await file.text(), { fileName: file.name });
      if (ticket !== generation.current || controller.getSnapshot().workspace?.activeProjectId !== projectId) {
        throw new Error('Project changed while the ray file was being read. Select the project again and retry.');
      }
      const detail = `${rays.runId} · ${rays.paths.length}/${rays.totalPaths} paths · imported and unverified`;
      await controller.dispatch(workspace => appendWorkspaceLog(
        updateWorkspaceProject(workspace, projectId, (target: { rayResults: unknown }) => { target.rayResults = rays; }), projectId,
        { title: 'Ray paths imported', detail }) as WorkspaceSnapshot);
      if (ticket === generation.current && controller.getSnapshot().workspace?.activeProjectId === projectId) {
        setSelectedRayId(null);
        setViewMode('saved');
      }
    } catch (cause) {
      if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (ticket === generation.current) setBusy(false);
      if (rayFileInput.current) rayFileInput.current.value = '';
    }
  };

  const downloadRayFile = () => {
    if (!savedRays) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(savedRays, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'atlas-ray-paths.json';
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importDriveFile = async (file: File) => {
    const ticket = generation.current;
    setDriveBusy(true); setDriveError('');
    try {
      if (file.size > 1_000_000) throw new Error('Drive CSV must be smaller than 1 MB.');
      const measurements = buildDriveMeasurements(parseDmCsv(await file.text()), file.name);
      if (ticket !== generation.current || controller.getSnapshot().workspace?.activeProjectId !== projectId)
        throw new Error('Project changed while the drive CSV was being read. Retry in the active project.');
      await controller.dispatch(workspace => appendWorkspaceLog(updateWorkspaceProject(workspace, projectId,
        (target: { driveMeasurements: unknown }) => { target.driveMeasurements = measurements; }), projectId,
      { title: 'DM trace imported', detail: `${file.name} · ${measurements.samples.length} unverified GPS rows` }) as WorkspaceSnapshot);
      if (ticket === generation.current && controller.getSnapshot().workspace?.activeProjectId === projectId) {
        setDriveTechnology('ALL'); setDriveVisible(true); setDriveIndex(null); setFitDriveRequest(value => value + 1);
      }
    } catch (cause) { if (ticket === generation.current) setDriveError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (ticket === generation.current) setDriveBusy(false); }
  };

  const setReceiverField = (field: keyof typeof receiver, value: string) => setReceiver(current => ({ ...current, [field]: value }));
  const active = snapshot.status === 'ready' && !snapshot.dirty && snapshot.workspace?.activeProjectId === projectId;
  const canRun = capability.status === 'ready' && capability.available === true && active && hasScene && located && !busy && Object.values(receiver).every(value => value.trim() !== '') &&
    (!job || !['queued', 'running'].includes(job.status));

  const receiverPoint = { latitude: Number(receiver.latitude), longitude: Number(receiver.longitude), heightM: Number(receiver.heightM) };
  const validReceiver = Object.values(receiver).every(value => value.trim() !== '') && validPoint(receiverPoint);
  const transmitter = located ? { latitude: selectedSite.radioLocation.latitude!, longitude: selectedSite.radioLocation.longitude!, heightM: selectedSite.heightM } : null;
  const beam = useMemo(() => ({ azimuthDeg: selectedSite?.cells?.[0]?.azimuthDeg ?? 60,
    downtiltDeg: selectedSite?.cells?.[0]?.downtiltDeg ?? 6, widthDeg: 65 }), [selectedSite]);
  const previewPaths = useMemo(() => previewEnabled && transmitter && validReceiver
    ? tracePreview(transmitter, receiverPoint, (project.map.scene as SiteSceneProject['map']['scene'])?.footprints ?? [], beam) : [],
    [previewEnabled, selectedSite, receiver.latitude, receiver.longitude, receiver.heightM, validReceiver, project.map.scene, beam]);
  const selectedPreview = previewPaths.find(path => path.id === selectedRayId);
  const sceneProject: SiteSceneProject = { ...record.project as unknown as SiteSceneProject, selectedRayId,
    driveView: { samples: driveSamples, metric: driveMetric, selectedIndex: selectedDriveIndex, visible: driveVisible, interactive: !pickMode },
    radioView: { receiver: viewMode === 'saved' ? savedRays?.paths[0]?.points.at(-1) as GeoPoint ?? null : validReceiver ? receiverPoint : null, siteId, beam,
      previewPaths: viewMode === 'preview' ? previewPaths : [], showBeam: false,
      showDirect: layers.direct, showReflections: layers.reflections, showContext: layers.context, showSaved: viewMode === 'saved' } };
  const pickPoint = async (point: GeoPoint) => {
    if (!pickMode) return;
    setViewMode('preview'); setSelectedRayId(null);
    if (pickMode === 'receiver') {
      setReceiver(current => ({ ...current, latitude: point.latitude.toFixed(6), longitude: point.longitude.toFixed(6) }));
      setPickMode(null); return;
    }
    const ticket = generation.current;
    setPickMode(null);
    try {
      await controller.dispatch(workspace => appendWorkspaceLog(updateWorkspaceProject(workspace, projectId,
        (target: RtProject) => { const site = target.sites.find(item => item.id === siteId);
          if (!site) throw new Error('Select a transmitter site first.');
          site.radioLocation = { latitude: point.latitude, longitude: point.longitude, source: 'manual' } as typeof site.radioLocation;
        }), projectId, { title: 'Transmitter placed on open map', detail: siteId }) as WorkspaceSnapshot);
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
  };

  const adoptBuildings = async (capture: CapturedBuildings) => {
    const ticket = generation.current;
    if (controller.getSnapshot().workspace?.activeProjectId !== projectId) throw new Error('Select the active project again before importing buildings.');
    setBusy(true); setError('');
    try {
      const scene = parseGeoJsonScene(capture.geojson, { fileName: 'open-map-visible-uncalibrated.geojson' });
      scene.footprints.forEach(footprint => { footprint.assumedHeight = true; });
      scene.assumedHeightCount = scene.footprints.length;
      await controller.dispatch(workspace => appendWorkspaceLog(updateWorkspaceProject(workspace, projectId,
        (target: { map: Record<string, unknown>; rayResults: unknown }) => {
          Object.assign(target.map, sceneFit(target.map as Parameters<typeof sceneFit>[0], scene), { scene,
            sceneFile: scene.fileName, source: 'GeoJSON', geometryValidated: false, coordinateAligned: false, materialAssigned: false });
          target.rayResults = null;
        }), projectId, { title: 'Open map footprints adopted',
          detail: `${scene.footprints.length} visible tile footprints · ${capture.skipped} skipped · all heights assumed · may be tile-clipped · © OpenStreetMap / OpenMapTiles` }) as WorkspaceSnapshot);
      if (ticket === generation.current) { setPreviewEnabled(false); setViewMode('preview'); setSelectedRayId(null); }
    } finally { if (ticket === generation.current) setBusy(false); }
  };

  return <section className="ray-tracing-preview" role="region" aria-label="Ray tracing lab preview route">
    <header className="rt-heading"><div><p className="rt-eyebrow">RADIO PROPAGATION / 5G NR</p><h1>Ray-tracing lab</h1>
      <p>Explore propagation and street-level radio quality.</p></div><span className="rt-project-tag">{record.name} <span>· WGS84</span></span></header>
    <div className="rt-summary" aria-label="Propagation scene summary">
      <div><span>CARRIER</span><strong>{frequencyGhz || '—'} <small>GHz</small></strong><p>5G radio propagation</p></div>
      <div><span>TRANSMITTER</span><strong>{selectedSite?.id ?? '—'}</strong><p>{located ? `${selectedSite.heightM} m antenna height` : 'Place a radio on the map'}</p></div>
      <div><span>RF GEOMETRY</span><strong>{(project.map.scene as SiteSceneProject['map']['scene'])?.footprints.length ?? 0} <small>buildings</small></strong><p>Imported project footprints</p></div>
      <div><span>PATH SOURCE</span><strong>{viewMode === 'preview' ? 'Geometric preview' : 'Saved results'}</strong><p>{viewMode === 'preview' ? 'LOS + single wall reflection' : savedRays?.provenance === 'sionna-rt-local' ? 'Sionna-RT paths · uncalibrated' : 'External ray file · unverified'}</p></div>
    </div>
    <div className="rt-workspace">
      <section className="rt-map-panel" aria-label="5G propagation map">
        <header><div><h2>Open 3D propagation scene</h2><p>Street-level drive-test KPIs, buildings &amp; radio paths</p></div>
          <span className="rt-open-badge">MAPLIBRE / OPEN MAP</span></header>
        <DriveKpiControls measurements={driveMeasurements} samples={driveSamples} metric={driveMetric} technology={driveTechnology}
          visible={driveVisible} busy={driveBusy || !active} error={driveError}
          onImport={importDriveFile} onMetric={setDriveMetric} onTechnology={value => { setDriveTechnology(value); setDriveIndex(null); }}
          onVisible={setDriveVisible} onFit={() => { setCamera({ yaw: 35, pitch: 52, zoom: 1 }); setFitDriveRequest(value => value + 1); }} />
        <div className="rt-map-toolbar">
          <div className="rt-segment" role="group" aria-label="Path source">
            <button type="button" aria-pressed={viewMode === 'preview'} onClick={() => { setViewMode('preview'); setSelectedRayId(null); }}>Geometric preview</button>
            <button type="button" aria-pressed={viewMode === 'saved'} disabled={!savedRays} onClick={() => { setViewMode('saved'); setSelectedRayId(null); }}>Saved solver paths</button>
          </div>
          <div className="rt-placement"><button type="button" aria-pressed={pickMode === 'transmitter'} disabled={!selectedSite || busy || !active}
            onClick={() => setPickMode(value => value === 'transmitter' ? null : 'transmitter')}>Place transmitter</button>
            <button type="button" aria-pressed={pickMode === 'receiver'} onClick={() => setPickMode(value => value === 'receiver' ? null : 'receiver')}>Place receiver</button>
            <button type="button" className="rt-trace-button" disabled={!hasScene || !located || !validReceiver}
              onClick={() => { setPreviewEnabled(true); setViewMode('preview'); setSelectedRayId(null); }}>Trace geometric paths ↗</button></div>
        </div>
        <div className="rt-layer-list" role="group" aria-label="Propagation layers">{[{ key: 'direct' as const, label: 'Direct & blocked paths' },
          { key: 'reflections' as const, label: 'Wall reflections' }, { key: 'context' as const, label: 'Open map context' }].map(layer =>
          <label key={layer.key}><input type="checkbox" checked={layers[layer.key]} onChange={event => setLayers(current => ({ ...current, [layer.key]: event.target.checked }))} /><span>{layer.label}</span></label>)}</div>
        {pickMode && <p className="rt-pick-note" role="status">Click the map to place the {pickMode}. <button type="button" onClick={() => setPickMode(null)}>Cancel placement</button></p>}
        <OpenSiteScene project={sceneProject} camera={camera} onCapture={adoptBuildings} captureBusy={busy || !active} onPick={point => { void pickPoint(point); }}
          onSelectDriveSample={setDriveIndex} fitDriveRequest={fitDriveRequest} />
        <div className="rt-map-footer"><div className="rt-legend"><span><i className="direct" />Direct / LOS</span><span><i className="reflection" />Reflection</span><span><i className="blocked" />Blocked</span><span><i className="saved" />Solver / imported</span></div>
          <div className="rt-camera" role="group" aria-label="Ray scene camera controls">
            <button type="button" aria-label="Rotate left" onClick={() => setCamera(value => ({ ...value, yaw: (value.yaw + 345) % 360 }))}>↶</button>
            <button type="button" aria-label="Rotate right" onClick={() => setCamera(value => ({ ...value, yaw: (value.yaw + 15) % 360 }))}>↷</button>
            <button type="button" aria-label="Top-down view" aria-pressed={camera.pitch === 0} onClick={() => setCamera(value => ({ ...value, pitch: value.pitch === 0 ? 52 : 0 }))}>2D / 3D</button>
            <button type="button" onClick={() => { setCamera({ yaw: 35, pitch: 52, zoom: 1 });
              if (driveSamples.length) setFitDriveRequest(value => value + 1); }}>Reset view</button></div></div>
        {driveMeasurements && <DriveKpiInspector samples={driveSamples} metric={driveMetric} selectedIndex={selectedDriveIndex} onSelect={setDriveIndex} />}
        <p className="rt-map-note">Use visible map buildings replaces the RF scene and saved paths with captured footprints. Tile edges may clip buildings; all source heights are assumed. Tracing uses adopted or imported footprints on flat ground.</p>
      </section>
    </div>
    <section className="rt-path-panel" aria-label="Geometric path inspector"><header><div><p className="rt-eyebrow">02 / INSPECT PROPAGATION</p><h2>Path inspector</h2></div><span>{previewPaths.length} geometric candidates</span></header>
      {previewEnabled && previewPaths.length ? <div className="rt-path-grid"><ul className="ray-result-list" aria-label="Geometric paths">{previewPaths.map(path =>
        <li key={path.id}><button type="button" aria-pressed={selectedRayId === path.id} onClick={() => { setViewMode('preview'); setSelectedRayId(path.id); }}>
          <span className={`rt-path-kind ${path.kind}`}>{path.kind === 'direct' ? 'LOS' : path.kind === 'reflection' ? 'REFLECTION' : 'BLOCKED'}</span>
          {path.distanceM.toFixed(1)} m · {path.delayNs.toFixed(1)} ns <small>{path.inBeam ? 'In beam' : 'Outside beam'}</small></button></li>)}</ul>
        <div className="rt-path-detail"><h3>{selectedPreview ? selectedPreview.id : 'Select a path to inspect'}</h3><p>{selectedPreview?.kind === 'blocked' ? `Stopped at ${selectedPreview.buildingId}; this path does not reach RX.` : selectedPreview?.buildingId ? `Single specular bounce on ${selectedPreview.buildingId}.` : 'Direct and single-bounce candidates use imported geometry.'}</p>
          <p>Delay is geometric travel time. No diffraction, material losses, terrain, or measured radio power.</p></div></div>
        : <p className="rt-empty">{previewEnabled ? 'No outdoor candidate paths. Check terminal positions and building heights.' : 'Load building geometry, place TX and RX, then trace to inspect line of sight, blockage, and wall reflections.'}</p>}
    </section>
    <details className="rt-geometry-details"><summary>Scene inputs · imported building geometry</summary><MapScopeControls controller={controller} record={record} /></details>
    <p className="artifacts-boundary">Drive-test KPIs come from imported GPS data and remain unverified. Ray paths are separate, uncalibrated geometry; the local solver uses isotropic antennas and does not predict these KPIs.</p>
    <section className="panel" aria-labelledby="rt-job-title">
      <header className="panel-header"><div><h2 id="rt-job-title">Run a local Sionna-RT path job</h2>
        <p className="panel-caption">Selected radio site to one WGS84 receiver · assumed concrete buildings and isotropic antennas</p></div>
        <span className="mini-pill">{capability.available ? 'LOCAL SOLVER' : 'RUNTIME STATUS'}</span></header>
      <div className="pad">
        {capability.status === 'loading' && <p role="status">Checking local RT runtime…</p>}
        {capability.message && <p role={capability.available ? 'status' : 'alert'}>{capability.message}</p>}
        {!hasScene && <p>Load valid GeoJSON footprints in the map before running Sionna-RT.</p>}
        {!located && <p>Set WGS84 coordinates for a radio site in Radio planner before running.</p>}
        <div className="scene-job-grid">
          <label>Transmitter site<select aria-label="Transmitter site" value={siteId} onChange={event => setSiteId(event.target.value)}>
            {project.sites.map(site => <option key={site.id} value={site.id}>{site.name} · {site.id}</option>)}
          </select></label>
          <label>Receiver latitude<input aria-label="Receiver latitude" type="number" step="any" value={receiver.latitude}
            onChange={event => setReceiverField('latitude', event.target.value)} /></label>
          <label>Receiver longitude<input aria-label="Receiver longitude" type="number" step="any" value={receiver.longitude}
            onChange={event => setReceiverField('longitude', event.target.value)} /></label>
          <label>Receiver height (m)<input aria-label="Receiver height (m)" type="number" step="0.1" min="0" max="300" value={receiver.heightM}
            onChange={event => setReceiverField('heightM', event.target.value)} /></label>
          <label>Frequency (GHz)<input aria-label="Frequency (GHz)" type="number" step="0.1" min="0.5" max="100" value={frequencyGhz}
            onChange={event => setFrequencyGhz(event.target.value)} /></label>
          <label>Samples per source<input aria-label="Samples per source" type="number" step="1000" min="1000" max="200000" value={samplesPerSrc}
            onChange={event => setSamplesPerSrc(event.target.value)} /></label>
          <label>Maximum path depth<input aria-label="Maximum path depth" type="number" step="1" min="0" max="4" value={maxDepth}
            onChange={event => setMaxDepth(event.target.value)} /></label>
        </div>
        <div className="scene-job-actions"><button type="button" className="button primary" onClick={() => void run()} disabled={!canRun}>
          {busy ? 'Working…' : 'Run Sionna-RT paths'}
        </button><button type="button" className="button outline" onClick={() => onNavigate('radio')}>Set radio coordinates</button></div>
        {error && <p role="alert">Ray action failed · {error}</p>}
        {job?.id === 'saving' && <p role="status">Saving active project before submission…</p>}
        {job && job.id !== 'saving' && (job.status === 'failed' || job.status === 'interrupted') && <p role="alert">Job {job.id} {job.status} · {job.error}</p>}
        {job && job.id !== 'saving' && ['queued', 'running'].includes(job.status) &&
          <p role="status">Sionna-RT job {job.id} {job.status}…</p>}
        {job?.status === 'complete' && <p role="status">Job {job.id} completed · {job.pathCount} valid paths. Geometry and materials remain uncalibrated.</p>}
        <p className="muted">The localhost server runs one bounded job at a time (180 s limit). The result is not a calibrated RF measurement.</p>
      </div>
    </section>
    <section className="panel" aria-label="Saved ray results">
      <header className="panel-header"><div><h2>Saved ray results</h2><p className="panel-caption">Import WGS84 ray paths or inspect project-saved RT output.</p></div>
        <div><button type="button" className="button outline" onClick={() => rayFileInput.current?.click()} disabled={busy}>Import ray path JSON</button>
          {savedRays && <button type="button" className="button outline" onClick={downloadRayFile}>Download ray results</button>}
          <input ref={rayFileInput} type="file" accept=".json,application/json" hidden aria-label="Import ray path JSON"
            disabled={busy} onChange={event => { void importRayFile(event.currentTarget.files?.[0]); }} /></div></header>
      {savedRays ? <>
      <p>{savedRays.provenance === 'sionna-rt-local' ? 'Local Sionna-RT · uncalibrated' : 'Imported · unverified'}</p>
      <p>{savedRays.paths.length} of {savedRays.totalPaths} paths shown · {savedRays.fileName}</p>
      <ul className="ray-result-list" aria-label="Ray paths">{savedRays.paths.map(ray =>
        <li key={ray.id}><button type="button" aria-pressed={selectedRayId === ray.id} onClick={() => { setViewMode('saved'); setSelectedRayId(ray.id); }}>
          {ray.id} · {ray.pathLossDb} dB · {ray.points.length} points</button></li>)}</ul>
      <button type="button" className="button outline" onClick={() => onNavigate('artifacts')}>Open project artifacts</button>
      </> : <>
      <p>No path results yet. Run a local job or import a compatible WGS84 ray file.</p>
      <p>Imported results stay unverified; local Sionna-RT paths stay uncalibrated.</p>
      </>}
    </section>
  </section>;
}
