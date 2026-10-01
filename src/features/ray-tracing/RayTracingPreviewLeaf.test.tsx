import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { addWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { parseGeoJsonScene } from '../../../scene.mjs';
import { AppController } from '../../app/AppController';
import RayTracingPreviewLeaf from './RayTracingPreviewLeaf';

const rtApi = vi.hoisted(() => ({
  getRtCapability: vi.fn(), submitRtJob: vi.fn(), getRtJob: vi.fn(),
}));
vi.mock('../../api/rtJobsApi', () => rtApi);
vi.mock('../site-planner/OpenSiteScene', () => ({ default: () => <div data-testid="open-rf-map" /> }));

function runnableWorkspace(projectId: `${string}-${string}-${string}-${string}-${string}`) {
  const workspace = createWorkspaceState(defaultProject(), { id: projectId, now: () => '2026-01-01T00:00:00Z' });
  const project = workspace.projects[0].project as Record<string, unknown>;
  const map = project.map as Record<string, unknown>;
  const sites = project.sites as { radioLocation: Record<string, unknown> }[];
  map.scene = parseGeoJsonScene({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { height: 20 },
    geometry: { type: 'Polygon', coordinates: [[[126.9779, 37.5664], [126.9781, 37.5664],
      [126.9781, 37.5666], [126.9779, 37.5666], [126.9779, 37.5664]]] } }] });
  map.geometryValidated = true;
  map.coordinateAligned = true;
  map.materialAssigned = true;
  sites[0].radioLocation = { latitude: 37.5665, longitude: 126.978, source: 'manual' };
  return workspace;
}

function priorImportedRay() {
  return { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'old', fileName: 'old.json',
    importedAt: '2026-01-01T00:00:00Z', solver: 'external', totalPaths: 1, provenance: 'imported-unverified',
    paths: [{ id: 'old-ray', pathLossDb: 80, points: [
      { latitude: 37.5665, longitude: 126.978, heightM: 20 }, { latitude: 37.5666, longitude: 126.9781, heightM: 2 },
    ] }] };
}

describe('RayTracingPreviewLeaf', () => {
  beforeEach(() => vi.resetAllMocks());

  it('retains the GPS overlay when a replacement CSV has no geographic coordinates', async () => {
    const workspace = runnableWorkspace('11111111-1111-4111-8111-111111111111');
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api); await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: false });
    render(<RayTracingPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onNavigate={vi.fn()} />);
    const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,NR,SITE-01-C1,37.566,126.978,-90,-9,18,120,30\n1,NR,SITE-01-C1,37.566,126.9781,-115,-16,-2,3,1';
    const file = (name: string, text: string) => { const file = new File([text], name); Object.defineProperty(file, 'text', { value: async () => text }); return file; };
    fireEvent.change(screen.getByLabelText('Import drive test CSV'), { target: { files: [file('gps.csv', csv)] } });
    await screen.findByText(/gps.csv · 2\/2 GPS samples/);
    await waitFor(() => expect(controller.getSnapshot().dirty).toBe(false));
    const prior = structuredClone(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements);
    const schematic = csv.replace('latitude,longitude', 'x_pct,y_pct').replace('37.566,126.9781', '20,30').replace('37.566,126.978', '10,20');
    fireEvent.change(screen.getByLabelText('Import drive test CSV'), { target: { files: [file('schematic.csv', schematic)] } });
    await screen.findByText(/latitude and longitude for every sample/);
    expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toEqual(prior);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('Beam steering controls')).toBeNull();
  });

  it('does not save GPS data when the active project changes during file reading', async () => {
    const firstId = '11111111-1111-4111-8111-111111111111';
    const nextId = '22222222-2222-4222-8222-222222222222';
    const workspace = addWorkspaceProject(runnableWorkspace(firstId), defaultProject(), { id: nextId, uniqueName: true });
    workspace.activeProjectId = firstId;
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api); await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: false });
    render(<RayTracingPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onNavigate={vi.fn()} />);
    let finish: (text: string) => void = () => {};
    const file = new File([], 'late.csv'); Object.defineProperty(file, 'text', { value: () => new Promise<string>(resolve => { finish = resolve; }) });
    fireEvent.change(screen.getByLabelText('Import drive test CSV'), { target: { files: [file] } });
    await act(async () => { await controller.dispatch(current => ({ ...current, activeProjectId: nextId })); });
    await act(async () => finish('time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,NR,SITE-01-C1,37.566,126.978,-90,-9,18,120,30\n1,NR,SITE-01-C1,37.566,126.9781,-115,-16,-2,3,1'));
    expect(controller.getSnapshot().workspace!.projects.every(item => item.project.driveMeasurements === null)).toBe(true);
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('saves the active project before submission and persists local uncalibrated paths after guarded polling', async () => {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const workspace = runnableWorkspace(projectId);
    const api = { read: vi.fn().mockResolvedValue({ revision: 3, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: true, message: 'Sionna-RT available' });
    rtApi.submitRtJob.mockResolvedValue({ id: 'job-1', status: 'queued', createdAt: '2026-01-01T00:00:00Z' });
    rtApi.getRtJob.mockResolvedValueOnce({ id: 'job-1', status: 'running', createdAt: '2026-01-01T00:00:00Z' })
      .mockResolvedValueOnce({ id: 'job-1', status: 'complete', createdAt: '2026-01-01T00:00:00Z',
        result: { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'job-1',
          fileName: 'job-1.json', importedAt: '2026-01-01T00:00:01Z', solver: 'Sionna-RT', totalPaths: 1,
          assumptions: 'Concrete buildings and isotropic antennas',
          job: { siteId: 'SITE-01', frequencyGhz: 3.5, samplesPerSrc: 10000, maxDepth: 2,
            reflections: true, diffraction: false, footprints: 1,
            transmitter: { latitude: 37.5665, longitude: 126.978, heightM: 28 },
            receiver: { latitude: 37.5666, longitude: 126.9781, heightM: 2 } },
          paths: [{ id: 'path-1', pathLossDb: 83.2, points: [
            { latitude: 37.5665, longitude: 126.978, heightM: 28 },
            { latitude: 37.5666, longitude: 126.9781, heightM: 2 },
          ] }] } });
    const record = controller.getSnapshot().workspace!.projects[0];
    render(<RayTracingPreviewLeaf controller={controller} record={record} onNavigate={vi.fn()} pollIntervalMs={1} />);

    await screen.findByText('Sionna-RT available');
    fireEvent.click(screen.getByRole('button', { name: 'Run Sionna-RT paths' }));
    await waitFor(() => expect(rtApi.submitRtJob).toHaveBeenCalled());
    expect(api.write.mock.invocationCallOrder[0]).toBeLessThan(rtApi.submitRtJob.mock.invocationCallOrder[0]);
    expect(rtApi.submitRtJob).toHaveBeenCalledWith(projectId, expect.objectContaining({
      siteId: 'SITE-01', frequencyGhz: 3.5, samplesPerSrc: 10000, maxDepth: 2,
    }));
    await screen.findByText(/Job job-1 completed · 1 valid paths/);
    await waitFor(() => expect(controller.getSnapshot().workspace?.projects[0].project.rayResults)
      .toMatchObject({ provenance: 'sionna-rt-local', runId: 'job-1', assumptions: 'Concrete buildings and isotropic antennas',
        job: { siteId: 'SITE-01', frequencyGhz: 3.5, footprints: 1 }, paths: [{ id: 'path-1' }] }));
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Sionna-RT job completed');
  });

  it('imports WGS84 ray files as unverified results and records them on the active project', async () => {
    const projectId = '22222222-2222-4222-8222-222222222222';
    const workspace = createWorkspaceState(defaultProject(), { id: projectId, now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: false, platform: 'Darwin', message: 'No local RT runtime' });
    const input = { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'external-run',
      solver: 'External solver', totalPaths: 1, paths: [{ id: 'imported-path', pathLossDb: 91,
        points: [{ latitude: 37.5665, longitude: 126.978, heightM: 30 }, { latitude: 37.5666, longitude: 126.9781, heightM: 2 }] }] };
    const file = new File([JSON.stringify(input)], 'external-rays.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => JSON.stringify(input) });
    render(<RayTracingPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      onNavigate={vi.fn()} />);

    const picker = await screen.findByLabelText('Import ray path JSON');
    fireEvent.change(picker, { target: { files: [file] } });
    await screen.findByText('Imported · unverified');
    expect(controller.getSnapshot().workspace?.projects[0].project.rayResults)
      .toMatchObject({ provenance: 'imported-unverified', runId: 'external-run', paths: [{ id: 'imported-path' }] });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Ray paths imported');
  });

  it('keeps completed jobs with no paths distinct and clears any previous path result', async () => {
    const projectId = '44444444-4444-4444-8444-444444444444';
    const workspace = runnableWorkspace(projectId);
    workspace.projects[0].project.rayResults = priorImportedRay() as never;
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: true, message: 'Sionna-RT available' });
    rtApi.submitRtJob.mockResolvedValue({ id: 'job-empty', status: 'queued', createdAt: '2026-01-01T00:00:00Z' });
    rtApi.getRtJob.mockResolvedValue({ id: 'job-empty', status: 'complete', createdAt: '2026-01-01T00:00:00Z',
      result: { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'job-empty',
        fileName: 'job-empty.json', importedAt: '2026-01-01T00:00:01Z', solver: 'Sionna-RT', totalPaths: 0, paths: [] } });
    const controllerWorkspace = controller.getSnapshot().workspace!;
    render(<RayTracingPreviewLeaf controller={controller} record={controllerWorkspace.projects[0]}
      onNavigate={vi.fn()} pollIntervalMs={1} />);

    await screen.findByText('Sionna-RT available');
    fireEvent.click(screen.getByRole('button', { name: 'Run Sionna-RT paths' }));
    await screen.findByText(/Job job-empty completed · 0 valid paths/);
    await waitFor(() => expect(controller.getSnapshot().workspace?.projects[0].project.rayResults).toBeNull());
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].detail).toContain('no valid paths');
  });

  it.each(['failed', 'interrupted'] as const)('surfaces a %s poll result without mutating saved paths', async status => {
    const projectId = '55555555-5555-4555-8555-555555555555';
    const workspace = runnableWorkspace(projectId);
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: true, message: 'Sionna-RT available' });
    rtApi.submitRtJob.mockResolvedValue({ id: `job-${status}`, status: 'queued', createdAt: '2026-01-01T00:00:00Z' });
    rtApi.getRtJob.mockResolvedValue({ id: `job-${status}`, status, error: 'Worker exited', createdAt: '2026-01-01T00:00:00Z' });
    const record = controller.getSnapshot().workspace!.projects[0];
    render(<RayTracingPreviewLeaf controller={controller} record={record} onNavigate={vi.fn()} pollIntervalMs={1} />);

    await screen.findByText('Sionna-RT available');
    fireEvent.click(screen.getByRole('button', { name: 'Run Sionna-RT paths' }));
    await screen.findByText(new RegExp(`Job job-${status} ${status}`));
    expect(controller.getSnapshot().workspace?.projects[0].project.rayResults).toBeNull();
    expect(controller.getSnapshot().workspace?.projects[0].activity).toHaveLength(0);
  });

  it('rejects an invalid ray file without saving a result or activity', async () => {
    const projectId = '66666666-6666-4666-8666-666666666666';
    const workspace = createWorkspaceState(defaultProject(), { id: projectId, now: () => '2026-01-01T00:00:00Z' });
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: false, message: 'No local RT runtime' });
    const file = new File(['{"kind":"wrong"}'], 'bad-rays.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: async () => '{"kind":"wrong"}' });
    render(<RayTracingPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      onNavigate={vi.fn()} />);

    fireEvent.change(await screen.findByLabelText('Import ray path JSON'), { target: { files: [file] } });
    await screen.findByText(/Ray file must contain/);
    expect(api.write).not.toHaveBeenCalled();
    expect(controller.getSnapshot().workspace?.projects[0].project.rayResults).toBeNull();
    expect(controller.getSnapshot().workspace?.projects[0].activity).toHaveLength(0);
  });

  it('ignores a completed poll after the preview switches to another project', async () => {
    const projectId = '77777777-7777-4777-8777-777777777777';
    const secondProjectId = '88888888-8888-4888-8888-888888888888';
    const first = runnableWorkspace(projectId);
    const workspace = addWorkspaceProject(first, defaultProject(), { id: secondProjectId, uniqueName: true,
      now: () => '2026-01-01T00:00:00Z' });
    workspace.activeProjectId = projectId;
    const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: vi.fn().mockResolvedValue(2) };
    const controller = new AppController(api);
    await controller.hydrate();
    rtApi.getRtCapability.mockResolvedValue({ available: true, message: 'Sionna-RT available' });
    rtApi.submitRtJob.mockResolvedValue({ id: 'stale-job', status: 'queued', createdAt: '2026-01-01T00:00:00Z' });
    let finishPoll: ((job: any) => void) | undefined;
    rtApi.getRtJob.mockImplementation(() => new Promise(resolve => { finishPoll = resolve; }));
    const view = render(<RayTracingPreviewLeaf controller={controller} record={controller.getSnapshot().workspace!.projects[0]}
      onNavigate={vi.fn()} pollIntervalMs={1} />);

    await screen.findByText('Sionna-RT available');
    fireEvent.click(screen.getByRole('button', { name: 'Run Sionna-RT paths' }));
    await waitFor(() => expect(rtApi.getRtJob).toHaveBeenCalled());
    await act(async () => {
      await controller.dispatch(current => ({ ...current, activeProjectId: secondProjectId }));
    });
    view.rerender(<RayTracingPreviewLeaf controller={controller}
      record={controller.getSnapshot().workspace!.projects.find(item => item.id === secondProjectId)!}
      onNavigate={vi.fn()} pollIntervalMs={1} />);
    await act(async () => finishPoll?.({ id: 'stale-job', status: 'complete', createdAt: '2026-01-01T00:00:00Z',
      result: { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'stale-job',
        fileName: 'stale-job.json', importedAt: '2026-01-01T00:00:01Z', solver: 'Sionna-RT', totalPaths: 1,
        paths: [{ id: 'stale-ray', pathLossDb: 83, points: [{ latitude: 37.5665, longitude: 126.978, heightM: 28 },
          { latitude: 37.5666, longitude: 126.9781, heightM: 2 }] }] } }));

    expect(controller.getSnapshot().workspace?.projects.find(item => item.id === projectId)?.project.rayResults).toBeNull();
    expect(controller.getSnapshot().workspace?.projects.find(item => item.id === secondProjectId)?.project.rayResults).toBeNull();
    expect(controller.getSnapshot().workspace?.projects.find(item => item.id === projectId)?.activity).toHaveLength(0);
  });
});
