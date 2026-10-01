import { beforeEach, describe, expect, it, vi } from 'vitest';
import { activateWorkspaceProject, createWorkspaceState, renameWorkspaceProject } from '../../workspaces.mjs';
import { AppController } from './AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../api/schemas';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
const seed = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' });
const second = structuredClone(seed.projects[0]);
second.id = secondId;
second.name = 'Second';
second.project.name = 'Second';
const workspace = workspaceSchema.parse({ ...seed, projects: [...seed.projects, second] });
const pending = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const file = (name: string) => ({ id: 'project-config', path: `${name}/configuration/project.json`,
  name: 'project.json', mimeType: 'application/json', description: 'Configuration',
  updatedAt: '2026-01-01', size: 2, content: '{}' });
const run = (projectId: string) => ({ id: 'run-1', projectId, taskId: null, kind: 'sionna-rt',
  status: 'queued' as const, createdAt: '2026-01-01', completedAt: null, totalPaths: null, error: null });
const queryApi = () => ({ artifacts: vi.fn(), runs: vi.fn(), run: vi.fn() });
const workspaceApi = () => ({ read: vi.fn().mockResolvedValue({ workspace, revision: 1 }),
  write: vi.fn().mockResolvedValue(2) });

beforeEach(() => {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { storage.set(key, value); },
  });
});

describe('project-scoped application queries', () => {
  it('returns a stable, immutable snapshot to subscribers and a new identity on publication', async () => {
    const controller = new AppController(workspaceApi(), queryApi());
    const before = controller.getSnapshot();
    expect(controller.getSnapshot()).toBe(before);
    await controller.hydrate();
    const after = controller.getSnapshot();
    expect(after).not.toBe(before);
    expect(controller.getSnapshot()).toBe(after);
    expect(() => { (after.workspace as WorkspaceSnapshot).projects[0].name = 'spoofed'; }).toThrow();
    expect(controller.getSnapshot().workspace?.projects[0].name).toBe(workspace.projects[0].name);
  });

  it('ignores late artifacts from a previous project while accepting the current project', async () => {
    const old = pending<ReturnType<typeof file>[]>();
    const queries = queryApi();
    queries.artifacts.mockReturnValueOnce(old.promise).mockResolvedValueOnce([file('Second')]);
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    const first = controller.refreshArtifacts();
    await vi.waitFor(() => expect(queries.artifacts).toHaveBeenCalledWith(firstId, workspace.projects[0].name, { content: true }));
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    expect(controller.getSnapshot().artifacts).toMatchObject({ status: 'idle', data: null });
    old.resolve([file(workspace.projects[0].name)]);
    expect(await first).toBeNull();
    expect(controller.getSnapshot().artifacts.data).toBeNull();
    expect(await controller.refreshArtifacts()).toEqual([file('Second')]);
    expect(controller.getSnapshot().artifacts.data).toEqual([file('Second')]);
  });

  it('ignores stale errors and older same-project requests without replacing newer results', async () => {
    const old = pending<ReturnType<typeof file>[]>();
    const queries = queryApi();
    queries.artifacts.mockReturnValueOnce(old.promise).mockResolvedValueOnce([file(workspace.projects[0].name)]);
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    const first = controller.refreshArtifacts();
    const second = controller.refreshArtifacts();
    await second;
    old.reject(new Error('stale network failure'));
    expect(await first).toBeNull();
    expect(controller.getSnapshot().artifacts).toMatchObject({ status: 'ready', error: null });
  });

  it('guards paginated runs, selected-run scope and late run details on project switch', async () => {
    const delayed = pending<ReturnType<typeof run> & { input: Record<string, unknown>; result: null }>();
    const queries = queryApi();
    queries.runs.mockResolvedValueOnce({ runs: [run(firstId)], total: 1, nextOffset: null })
      .mockResolvedValueOnce({ runs: [], total: 0, nextOffset: null });
    queries.run.mockReturnValueOnce(delayed.promise)
      .mockResolvedValueOnce({ ...run(secondId), input: {}, result: null });
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    expect(await controller.refreshRuns({ limit: 20, offset: 0 })).toMatchObject({ total: 1 });
    const oldDetail = controller.selectRun('run-1');
    await vi.waitFor(() => expect(queries.run).toHaveBeenCalledWith(firstId, 'run-1'));
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    delayed.resolve({ ...run(firstId), input: {}, result: null });
    expect(await oldDetail).toBeNull();
    expect(controller.getSnapshot().selectedRun.data).toBeNull();
    await controller.refreshRuns();
    await controller.selectRun('run-1');
    expect(controller.getSnapshot().selectedRun.data?.projectId).toBe(secondId);
    expect(controller.getSnapshot().runs.data?.total).toBe(0);
  });

  it('rejects an adapter that returns a foreign run without publishing it', async () => {
    const queries = queryApi();
    queries.run.mockResolvedValue({ ...run(secondId), input: {}, result: null });
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    await expect(controller.selectRun('run-1')).rejects.toThrow(/different project/i);
    expect(controller.getSnapshot().selectedRun).toMatchObject({ status: 'error', data: null });
  });

  it('waits for a new project save before querying its database artifacts', async () => {
    const save = pending<number>();
    const api = workspaceApi();
    api.write.mockReturnValueOnce(save.promise);
    const queries = queryApi();
    queries.artifacts.mockResolvedValue([file('Second')]);
    const controller = new AppController(api, queries);
    await controller.hydrate();
    const switchProject = controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    const refresh = controller.refreshArtifacts();
    await Promise.resolve();
    expect(queries.artifacts).not.toHaveBeenCalled();
    save.resolve(2);
    await switchProject;
    expect(await refresh).toEqual([file('Second')]);
    expect(queries.artifacts).toHaveBeenCalledWith(secondId, 'Second', { content: true });
  });

  it('does not query stale scope or publish a foreign run identifier', async () => {
    const save = pending<number>();
    const api = workspaceApi();
    api.write.mockReturnValueOnce(save.promise);
    const queries = queryApi();
    queries.run.mockResolvedValue({ ...run(firstId), id: 'wrong', input: {}, result: null });
    const controller = new AppController(api, queries);
    await controller.hydrate();
    const switching = controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    const oldRefresh = controller.refreshRuns();
    const switchingBack = controller.dispatch(state => activateWorkspaceProject(state, firstId) as WorkspaceSnapshot);
    save.resolve(2);
    await Promise.all([switching, switchingBack]);
    expect(await oldRefresh).toBeNull();
    expect(queries.runs).not.toHaveBeenCalled();
    await expect(controller.selectRun('run-1')).rejects.toThrow(/different run/i);
    expect(controller.getSnapshot().selectedRun.data).toBeNull();
  });

  it('appends older project runs once, preserves detail, and stops at the final page', async () => {
    const queries = queryApi();
    const first = { runs: [run(firstId), { ...run(firstId), id: 'run-2' }], total: 3, nextOffset: 2 };
    const older = { runs: [{ ...run(firstId), id: 'run-3' }], total: 3, nextOffset: null };
    queries.runs.mockResolvedValueOnce(first).mockResolvedValueOnce(older);
    queries.run.mockResolvedValue({ ...run(firstId), input: {}, result: null });
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    await controller.refreshRuns({ limit: 2 });
    await controller.selectRun('run-1');
    expect(await controller.loadOlderRuns({ limit: 2 })).toMatchObject({ total: 3, nextOffset: null });
    expect(queries.runs).toHaveBeenLastCalledWith(firstId, { limit: 2, offset: 2 });
    expect(controller.getSnapshot().runs.data?.runs.map(item => item.id)).toEqual(['run-1', 'run-2', 'run-3']);
    expect(controller.getSnapshot().selectedRun.data?.id).toBe('run-1');
    expect(await controller.loadOlderRuns()).toBeNull();
    expect(queries.runs).toHaveBeenCalledTimes(2);
    queries.runs.mockResolvedValueOnce({ runs: [], total: 3, nextOffset: null });
    await controller.refreshRuns();
    expect(controller.getSnapshot().selectedRun.data).toBeNull();
  });

  it('ignores duplicate older-page requests and stale responses after a project switch', async () => {
    const older = pending<{ runs: ReturnType<typeof run>[]; total: number; nextOffset: null }>();
    const queries = queryApi();
    queries.runs.mockResolvedValueOnce({ runs: [run(firstId)], total: 2, nextOffset: 1 })
      .mockReturnValueOnce(older.promise);
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    await controller.refreshRuns({ limit: 1 });
    const firstRequest = controller.loadOlderRuns({ limit: 1 });
    await vi.waitFor(() => expect(queries.runs).toHaveBeenCalledTimes(2));
    expect(controller.getSnapshot().runs).toMatchObject({ status: 'loading', data: { total: 2, nextOffset: 1 } });
    expect(await controller.loadOlderRuns({ limit: 1 })).toBeNull();
    expect(queries.runs).toHaveBeenCalledTimes(2);
    await controller.dispatch(state => activateWorkspaceProject(state, secondId) as WorkspaceSnapshot);
    older.resolve({ runs: [{ ...run(firstId), id: 'run-2' }], total: 2, nextOffset: null });
    expect(await firstRequest).toBeNull();
    expect(controller.getSnapshot().runs).toMatchObject({ status: 'idle', data: null });
  });

  it('retains loaded run rows when the next page fails', async () => {
    const queries = queryApi();
    queries.runs.mockResolvedValueOnce({ runs: [run(firstId)], total: 2, nextOffset: 1 })
      .mockRejectedValueOnce(new Error('Run page unavailable'));
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    await controller.refreshRuns({ limit: 1 });
    await expect(controller.loadOlderRuns({ limit: 1 })).rejects.toThrow('Run page unavailable');
    expect(controller.getSnapshot().runs).toMatchObject({ status: 'error', error: 'Run page unavailable', data: { total: 2, nextOffset: 1 } });
  });

  it('keeps confirmed run rows and detail across same-project edits while discarding stale in-flight reads', async () => {
    const pendingPage = pending<{ runs: ReturnType<typeof run>[]; total: number; nextOffset: null }>();
    const queries = queryApi();
    queries.runs.mockResolvedValueOnce({ runs: [run(firstId)], total: 1, nextOffset: null })
      .mockReturnValueOnce(pendingPage.promise);
    queries.run.mockResolvedValue({ ...run(firstId), input: {}, result: null });
    const controller = new AppController(workspaceApi(), queries);
    await controller.hydrate();
    await controller.refreshRuns();
    await controller.selectRun('run-1');
    await controller.dispatch(state => renameWorkspaceProject(state, firstId, 'Edited pilot') as WorkspaceSnapshot);
    expect(controller.getSnapshot().runs).toMatchObject({ status: 'ready', data: { total: 1 } });
    expect(controller.getSnapshot().selectedRun.data?.id).toBe('run-1');
    const stale = controller.refreshRuns();
    await vi.waitFor(() => expect(queries.runs).toHaveBeenCalledTimes(2));
    await controller.dispatch(state => renameWorkspaceProject(state, firstId, 'Edited again') as WorkspaceSnapshot);
    pendingPage.resolve({ runs: [run(firstId)], total: 1, nextOffset: null });
    expect(await stale).toBeNull();
    expect(controller.getSnapshot().runs).toMatchObject({ status: 'ready', data: { total: 1 } });
    expect(controller.getSnapshot().selectedRun.data?.id).toBe('run-1');
  });
});
