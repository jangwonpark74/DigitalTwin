import { restoreWorkspaceState, validateWorkspaceState } from '../../workspaces.mjs';
import { readWorkspace, writeWorkspace, WorkspaceConflictError } from '../api/workspaceApi';
import { workspaceSchema, type WorkspaceSnapshot } from '../api/schemas';
import { listArtifacts } from '../api/artifactsApi';
import { getRun, listRuns } from '../api/runsApi';

const BACKUP_KEY = 'atlas-ran-twin-workspaces';
const LEGACY_KEY = 'atlas-ran-twin-project';

type WorkspaceApi = { read: typeof readWorkspace; write: (workspace: WorkspaceSnapshot, revision: number) => Promise<number> };
type QueryApi = { artifacts: typeof listArtifacts; runs: typeof listRuns; run: typeof getRun };
type Status = 'idle' | 'loading' | 'ready' | 'saving' | 'error' | 'conflict';
type QueryState<T> = { status: 'idle' | 'loading' | 'ready' | 'error'; data: T | null; error: string | null };
const emptyQuery = <T,>(): QueryState<T> => ({ status: 'idle', data: null, error: null });
type Snapshot = { workspace: WorkspaceSnapshot | null; revision: number; status: Status; error: string | null; dirty: boolean;
  artifacts: QueryState<Awaited<ReturnType<typeof listArtifacts>>>;
  runs: QueryState<Awaited<ReturnType<typeof listRuns>>>;
  selectedRun: QueryState<Awaited<ReturnType<typeof getRun>>> };

function freezeSnapshot<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeSnapshot);
    Object.freeze(value);
  }
  return value;
}

function changedPaths(local: unknown, saved: unknown, path = '', depth = 0): string[] {
  if (JSON.stringify(local) === JSON.stringify(saved)) return [];
  const object = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);
  if (depth >= 5 || !object(local) || !object(saved)) return [path || 'record'];
  const paths: string[] = [];
  for (const key of new Set([...Object.keys(local), ...Object.keys(saved)])) {
    paths.push(...changedPaths(local[key], saved[key], path ? `${path}.${key}` : key, depth + 1));
    if (paths.length >= 20) break;
  }
  return paths.slice(0, 20);
}

function browserJson(key: string): unknown {
  try {
    const text = localStorage.getItem(key);
    return text ? JSON.parse(text) as unknown : null;
  } catch { return null; }
}

export class AppController {
  private state: Snapshot = { workspace: null, revision: 0, status: 'idle', error: null, dirty: false,
    artifacts: emptyQuery(), runs: emptyQuery(), selectedRun: emptyQuery() };
  private published: Snapshot = freezeSnapshot(structuredClone(this.state));
  private readonly listeners = new Set<() => void>();
  private queue: Promise<unknown> = Promise.resolve();
  private hydration: Promise<void> | null = null;
  private blocked = false;
  private scopeEpoch = 0;
  private artifactRequest = 0;
  private runsRequest = 0;
  private runRequest = 0;

  constructor(private readonly api: WorkspaceApi = { read: readWorkspace, write: writeWorkspace },
    private readonly queries: QueryApi = { artifacts: listArtifacts, runs: listRuns, run: getRun }) {}

  getSnapshot = (): Readonly<Snapshot> => this.published;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private publish() {
    this.published = freezeSnapshot(structuredClone(this.state));
    this.listeners.forEach(listener => listener());
  }

  private resetQueries({ keepRuns = false }: { keepRuns?: boolean } = {}) {
    this.scopeEpoch++;
    this.state.artifacts = emptyQuery();
    this.state.runs = keepRuns && this.state.runs.data
      ? { status: 'ready', data: this.state.runs.data, error: null } : emptyQuery();
    this.state.selectedRun = keepRuns && this.state.selectedRun.data
      ? { status: 'ready', data: this.state.selectedRun.data, error: null } : emptyQuery();
  }

  private activeRecord() {
    if (!this.state.workspace || this.state.status === 'loading') throw new Error('Connect to the local database first.');
    const record = this.state.workspace.projects.find(item => item.id === this.state.workspace?.activeProjectId);
    if (!record) throw new Error('Active project not found');
    return record;
  }

  private async confirmedRecord(epoch: number) {
    await this.queue;
    if (epoch !== this.scopeEpoch) return null;
    if (this.state.dirty || this.blocked) throw new Error('Confirm the database save before reading project records.');
    return this.activeRecord();
  }

  hydrate(options: { discardUnsaved?: boolean } = {}): Promise<void> {
    if (this.hydration) return this.hydration;
    const attempt = this.performHydrate(options);
    this.hydration = attempt;
    void attempt.then(() => { if (this.hydration === attempt) this.hydration = null; },
      () => { if (this.hydration === attempt) this.hydration = null; });
    return attempt;
  }

  private async performHydrate({ discardUnsaved = false }: { discardUnsaved?: boolean }) {
    if (this.state.dirty && !discardUnsaved) throw new Error('Confirm before discarding unsaved changes.');
    await this.queue;
    this.resetQueries();
    this.state.status = 'loading';
    this.publish();
    try {
      const envelope = await this.api.read();
      if (envelope.workspace) {
        this.state = { ...this.state, workspace: envelope.workspace, revision: envelope.revision, status: 'ready', error: null, dirty: false };
      } else {
        // Only an empty SQLite workspace can be initialized from the browser backup.
        const restored = restoreWorkspaceState(browserJson(BACKUP_KEY), browserJson(LEGACY_KEY));
        const workspace = workspaceSchema.parse(restored);
        const revision = await this.api.write(workspace, envelope.revision);
        this.state = { ...this.state, workspace, revision, status: 'ready', error: null, dirty: false };
        this.backup(workspace);
      }
      this.blocked = false;
      this.resetQueries();
      this.publish();
    } catch (error) {
      this.state.status = error instanceof WorkspaceConflictError ? 'conflict' : 'error';
      this.state.error = error instanceof Error ? error.message : String(error);
      this.publish();
      throw error;
    }
  }

  dispatch(command: (workspace: WorkspaceSnapshot) => WorkspaceSnapshot): Promise<void> {
    if (!this.state.workspace || this.blocked || this.state.status === 'loading') throw new Error('Reload or resolve the database before editing.');
    const next = workspaceSchema.parse(command(structuredClone(this.state.workspace)));
    const errors = validateWorkspaceState(next as Parameters<typeof validateWorkspaceState>[0]);
    if (errors.length) throw new Error(errors[0]);
    this.resetQueries({ keepRuns: next.activeProjectId === this.state.workspace.activeProjectId });
    this.state.workspace = next;
    this.state.dirty = true;
    this.state.status = 'saving';
    this.publish();
    const attempt = this.queue.then(async () => {
      if (this.blocked) throw new Error('Reload or resolve the database before saving another draft.');
      try {
        const revision = await this.api.write(next, this.state.revision);
        this.state.revision = revision;
        // An earlier confirmed write must not erase a newer unsaved local draft.
        this.state.dirty = this.state.workspace !== next;
        this.state.status = this.state.dirty ? 'saving' : 'ready';
        this.state.error = null;
        this.backup(next);
        this.publish();
      } catch (error) {
        this.blocked = true;
        this.state.status = error instanceof WorkspaceConflictError ? 'conflict' : 'error';
        this.state.error = error instanceof Error ? error.message : String(error);
        this.state.dirty = true;
        this.publish();
        throw error;
      }
    });
    this.queue = attempt.catch(() => undefined);
    return attempt;
  }

  async refreshArtifacts() {
    const epoch = this.scopeEpoch;
    const record = await this.confirmedRecord(epoch);
    if (!record) return null;
    const { id, name } = record, request = ++this.artifactRequest;
    this.state.artifacts = { status: 'loading', data: null, error: null };
    this.publish();
    const current = () => epoch === this.scopeEpoch && request === this.artifactRequest;
    try {
      const files = await this.queries.artifacts(id, name, { content: true });
      if (!current()) return null;
      this.state.artifacts = { status: 'ready', data: files, error: null };
      this.publish();
      return files;
    } catch (error) {
      if (!current()) return null;
      this.state.artifacts = { status: 'error', data: null, error: error instanceof Error ? error.message : String(error) };
      this.publish();
      throw error;
    }
  }

  async refreshRuns(options: { limit?: number; offset?: number } = {}) {
    const epoch = this.scopeEpoch;
    const record = await this.confirmedRecord(epoch);
    if (!record) return null;
    const { id } = record, request = ++this.runsRequest;
    const previous = this.state.runs.data;
    this.state.runs = { status: 'loading', data: previous, error: null };
    this.publish();
    const current = () => epoch === this.scopeEpoch && request === this.runsRequest;
    try {
      const page = await this.queries.runs(id, options);
      if (!current()) return null;
      if (page.runs.some(run => run.projectId !== id)) throw new Error('Run belongs to a different project');
      this.state.runs = { status: 'ready', data: page, error: null };
      this.runRequest++;
      this.state.selectedRun = emptyQuery();
      this.publish();
      return page;
    } catch (error) {
      if (!current()) return null;
      this.state.runs = { status: 'error', data: previous, error: error instanceof Error ? error.message : String(error) };
      this.publish();
      throw error;
    }
  }

  async loadOlderRuns({ limit = 200 }: { limit?: number } = {}) {
    const epoch = this.scopeEpoch;
    const record = await this.confirmedRecord(epoch);
    if (!record) return null;
    const previous = this.state.runs.data;
    if (!previous || previous.nextOffset === null || this.state.runs.status === 'loading') return null;
    const { id } = record, request = ++this.runsRequest;
    this.state.runs = { status: 'loading', data: previous, error: null };
    this.publish();
    const current = () => epoch === this.scopeEpoch && request === this.runsRequest;
    try {
      const page = await this.queries.runs(id, { limit, offset: previous.nextOffset });
      if (!current()) return null;
      if (page.runs.some(run => run.projectId !== id)) throw new Error('Run belongs to a different project');
      const known = new Set(previous.runs.map(run => run.id));
      const runs = [...previous.runs, ...page.runs.filter(run => !known.has(run.id))];
      if (page.total < runs.length) throw new Error('Run pagination response is inconsistent');
      const combined = { runs, total: page.total, nextOffset: page.nextOffset };
      this.state.runs = { status: 'ready', data: combined, error: null };
      this.publish();
      return combined;
    } catch (error) {
      if (!current()) return null;
      this.state.runs = { status: 'error', data: previous, error: error instanceof Error ? error.message : String(error) };
      this.publish();
      throw error;
    }
  }

  async selectRun(runId: string) {
    const epoch = this.scopeEpoch;
    const record = await this.confirmedRecord(epoch);
    if (!record) return null;
    const { id } = record, request = ++this.runRequest;
    this.state.selectedRun = { status: 'loading', data: null, error: null };
    this.publish();
    const current = () => epoch === this.scopeEpoch && request === this.runRequest;
    try {
      const run = await this.queries.run(id, runId);
      if (!current()) return null;
      if (run.projectId !== id) throw new Error('Run belongs to a different project');
      if (run.id !== runId) throw new Error('Response belongs to a different run');
      this.state.selectedRun = { status: 'ready', data: run, error: null };
      this.publish();
      return run;
    } catch (error) {
      if (!current()) return null;
      this.state.selectedRun = { status: 'error', data: null, error: error instanceof Error ? error.message : String(error) };
      this.publish();
      throw error;
    }
  }

  async retrySave(): Promise<void> {
    await this.queue;
    if (!this.state.dirty || !this.state.workspace) throw new Error('There is no unsaved draft to retry.');
    // Retry is an explicit user action; never substitute a newer server revision.
    this.blocked = false;
    return this.dispatch(workspace => workspace);
  }

  async compareServer() {
    const local = this.getSnapshot();
    if (!local.workspace) throw new Error('There is no local workspace to compare.');
    const epoch = this.scopeEpoch;
    const server = await this.api.read();
    if (epoch !== this.scopeEpoch) return null;
    const localRecords = new Map(local.workspace.projects.map(record => [record.id, record]));
    const serverRecords = new Map(server.workspace?.projects.map(record => [record.id, record]) ?? []);
    const differences = [...new Set([...localRecords.keys(), ...serverRecords.keys()])].flatMap(id => {
      const draft = localRecords.get(id), saved = serverRecords.get(id);
      const paths = draft && saved ? changedPaths(draft, saved) : [];
      if (draft && saved && !paths.length) return [];
      return [{ id, localName: draft?.name ?? null, serverName: saved?.name ?? null,
        kind: draft && saved ? 'changed' : draft ? 'local-only' : 'server-only', changedPaths: paths }];
    });
    return { localRevision: local.revision, serverRevision: server.revision,
      localActiveProjectId: local.workspace.activeProjectId,
      serverActiveProjectId: server.workspace?.activeProjectId ?? null, differences };
  }

  private backup(workspace: WorkspaceSnapshot) {
    try { localStorage.setItem(BACKUP_KEY, JSON.stringify(workspace)); }
    catch { /* SQLite confirmed the write; browser backup is best-effort. */ }
  }
}
