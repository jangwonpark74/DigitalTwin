import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState, renameWorkspaceProject } from '../../workspaces.mjs';
import { AppController } from './AppController';
import { WorkspaceConflictError } from '../api/workspaceApi';
import type { WorkspaceSnapshot } from '../api/schemas';

const initial = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

beforeEach(() => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    clear: () => values.clear(),
  };
  Object.defineProperty(window, 'localStorage', { configurable: true, value: storage });
  vi.stubGlobal('localStorage', storage);
});

describe('canonical workspace controller', () => {
  it('hydrates database first, notifies subscribers, and backs up only confirmed saves', async () => {
    window.localStorage.setItem('atlas-ran-twin-workspaces', JSON.stringify({ stale: true }));
    const api = { read: vi.fn().mockResolvedValue({ revision: 3, workspace: initial }), write: vi.fn().mockResolvedValue(4) };
    const controller = new AppController(api);
    const listener = vi.fn();
    controller.subscribe(listener);
    await controller.hydrate();
    expect(controller.getSnapshot()).toMatchObject({ revision: 3, workspace: initial, status: 'ready' });
    expect(listener).toHaveBeenCalled();
    const renamed = renameWorkspaceProject(initial, initial.activeProjectId, 'Pilot B') as WorkspaceSnapshot;
    await controller.dispatch(() => renamed);
    expect(api.write).toHaveBeenCalledWith(renamed, 3);
    expect(controller.getSnapshot()).toMatchObject({ revision: 4, workspace: renamed, status: 'ready' });
    expect(JSON.parse(window.localStorage.getItem('atlas-ran-twin-workspaces')!)).toEqual(renamed);
  });

  it('serializes consecutive drafts, advances only confirmed revisions and leaves conflict draft intact', async () => {
    const first = deferred<number>();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace: initial }), write: vi.fn()
      .mockReturnValueOnce(first.promise)
      .mockRejectedValueOnce(new WorkspaceConflictError('Workspace changed in another browser tab')) };
    const controller = new AppController(api);
    await controller.hydrate();
    const one = controller.dispatch(state => renameWorkspaceProject(state, state.activeProjectId, 'First') as WorkspaceSnapshot);
    const two = controller.dispatch(state => renameWorkspaceProject(state, state.activeProjectId, 'Second') as WorkspaceSnapshot);
    await Promise.resolve();
    expect(api.write).toHaveBeenCalledTimes(1);
    first.resolve(3);
    await one;
    await expect(two).rejects.toThrow(/another browser tab/i);
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    expect(controller.getSnapshot()).toMatchObject({ revision: 3, status: 'conflict' });
    expect(controller.getSnapshot().workspace?.projects[0].name).toBe('Second');
    expect(JSON.parse(window.localStorage.getItem('atlas-ran-twin-workspaces')!).projects[0].name).toBe('First');
  });

  it('requires explicit reload and a confirmation to discard an unsaved conflict draft', async () => {
    const api = { read: vi.fn().mockResolvedValueOnce({ revision: 2, workspace: initial })
      .mockResolvedValueOnce({ revision: 9, workspace: initial }), write: vi.fn().mockRejectedValue(new Error('save failed')) };
    const controller = new AppController(api);
    await controller.hydrate();
    await expect(controller.dispatch(state => renameWorkspaceProject(state, state.activeProjectId, 'Draft') as WorkspaceSnapshot)).rejects.toThrow('save failed');
    await expect(controller.hydrate()).rejects.toThrow(/unsaved/i);
    expect(controller.getSnapshot().workspace?.projects[0].name).toBe('Draft');
    await controller.hydrate({ discardUnsaved: true });
    expect(controller.getSnapshot()).toMatchObject({ revision: 9, status: 'ready', workspace: initial });
  });

  it('migrates browser storage only for an empty database, then hydrates the confirmed database on reload', async () => {
    window.localStorage.setItem('atlas-ran-twin-workspaces', JSON.stringify(initial));
    const api = { read: vi.fn().mockResolvedValueOnce({ revision: 0, workspace: null })
      .mockResolvedValueOnce({ revision: 1, workspace: initial }), write: vi.fn().mockResolvedValue(1) };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(api.write).toHaveBeenCalledWith(initial, 0);
    await controller.hydrate();
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().revision).toBe(1);
  });

  it('retries a failed draft only on explicit request and tolerates blocked browser storage', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 4, workspace: initial }), write: vi.fn()
      .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(5) };
    const controller = new AppController(api);
    await controller.hydrate();
    const draft = renameWorkspaceProject(initial, initial.activeProjectId, 'Local draft') as WorkspaceSnapshot;
    await expect(controller.dispatch(() => draft)).rejects.toThrow('offline');
    expect(api.write).toHaveBeenCalledTimes(1);
    window.localStorage.setItem = () => { throw new Error('Storage disabled'); };
    await controller.retrySave();
    expect(api.write).toHaveBeenLastCalledWith(draft, 4);
    expect(controller.getSnapshot()).toMatchObject({ revision: 5, status: 'ready', dirty: false, workspace: draft });
  });

  it('deduplicates concurrent hydration so StrictMode cannot initialize SQLite twice', async () => {
    const first = deferred<{ revision: number; workspace: null }>();
    const api = { read: vi.fn().mockReturnValue(first.promise), write: vi.fn().mockResolvedValue(1) };
    const controller = new AppController(api);
    const a = controller.hydrate();
    const b = controller.hydrate();
    first.resolve({ revision: 0, workspace: null });
    await Promise.all([a, b]);
    expect(api.read).toHaveBeenCalledTimes(1);
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ revision: 1, status: 'ready' });
  });

  it('compares a conflicted local draft with SQLite without replacing it or advancing its revision', async () => {
    const server = structuredClone(initial);
    server.projects[0].name = 'Server edit';
    server.projects[0].project.name = 'Server edit';
    const api = { read: vi.fn().mockResolvedValueOnce({ revision: 2, workspace: initial })
      .mockResolvedValueOnce({ revision: 3, workspace: server }),
    write: vi.fn().mockRejectedValue(new WorkspaceConflictError('Workspace changed in another browser tab')) };
    const controller = new AppController(api);
    await controller.hydrate();
    await expect(controller.dispatch(state => renameWorkspaceProject(state, state.activeProjectId, 'Local draft') as WorkspaceSnapshot)).rejects.toBeInstanceOf(WorkspaceConflictError);
    const before = controller.getSnapshot();
    const comparison = await controller.compareServer();
    expect(comparison).toMatchObject({ localRevision: 2, serverRevision: 3,
      localActiveProjectId: initial.activeProjectId, serverActiveProjectId: initial.activeProjectId,
      differences: [{ id: initial.activeProjectId, localName: 'Local draft', serverName: 'Server edit', kind: 'changed' }] });
    expect(comparison?.differences[0].changedPaths).toContain('name');
    expect(comparison?.differences[0].changedPaths).toContain('project.name');
    expect(controller.getSnapshot()).toBe(before);
    expect(controller.getSnapshot()).toMatchObject({ revision: 2, dirty: true, status: 'conflict' });
    expect(api.write).toHaveBeenCalledTimes(1);
  });

  it('ignores a comparison response that arrives after an explicit reload', async () => {
    const stale = deferred<{ revision: number; workspace: WorkspaceSnapshot }>();
    const api = { read: vi.fn().mockResolvedValueOnce({ revision: 2, workspace: initial })
      .mockReturnValueOnce(stale.promise).mockResolvedValueOnce({ revision: 3, workspace: initial }),
    write: vi.fn().mockRejectedValue(new WorkspaceConflictError('changed')) };
    const controller = new AppController(api);
    await controller.hydrate();
    await expect(controller.dispatch(state => renameWorkspaceProject(state, state.activeProjectId, 'Local draft') as WorkspaceSnapshot)).rejects.toThrow();
    const comparison = controller.compareServer();
    await vi.waitFor(() => expect(api.read).toHaveBeenCalledTimes(2));
    await controller.hydrate({ discardUnsaved: true });
    stale.resolve({ revision: 2, workspace: initial });
    expect(await comparison).toBeNull();
    expect(controller.getSnapshot()).toMatchObject({ revision: 3, dirty: false, status: 'ready' });
  });
});
