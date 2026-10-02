import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../workspaces.mjs';
import { WorkspaceConflictError, readWorkspace, writeWorkspace } from './workspaceApi';
import { workspaceSchema } from './schemas';
import { prepareDriveImport } from '../features/drive/driveImport';
import { webcrypto } from 'node:crypto';
import { retainMeasurementDataset } from '../../measurement-library.mjs';

const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z' }));
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => vi.unstubAllGlobals());

describe('revisioned workspace API', () => {
  it('verifies inactive library content before sending or accepting a workspace', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const incoming = await prepareDriveImport({ name: 'partial.csv', rawCsv: 'time_s,technology,serving_cell,latitude,longitude,sinr_db\n0,NR,A,37.5,127,-2\n1,NR,A,37.501,127.001,', origin: 'unknown', knownCellIds: [] });
    const draft = structuredClone(workspace);
    let project = await retainMeasurementDataset(draft.projects[0].project, incoming.measurements);
    project = await retainMeasurementDataset(project, { ...incoming.measurements, fileName: 'second.csv' });
    const row = project.measurementLibrary.records[0]; row.sha256 = '0'.repeat(64); row.id = `dataset-${row.sha256}`;
    draft.projects[0].project = project;
    const fetcher = vi.fn().mockResolvedValue(reply({ revision: 1, workspace: draft }));
    await expect(writeWorkspace(draft, 0, fetcher)).rejects.toThrow(/digest/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readWorkspace(fetcher)).rejects.toThrow(/digest/);
  });
  it('rejects a tampered source digest before sending or accepting normalized measurement evidence', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const normalized = await prepareDriveImport({ name: 'partial.csv', rawCsv: 'time_s,technology,serving_cell,latitude,longitude,sinr_db\n0,NR,A,37.5,127,-2\n1,NR,A,37.501,127.001,', origin: 'unknown', knownCellIds: [] });
    const draft = structuredClone(workspace); draft.projects[0].project.driveMeasurements = normalized.measurements;
    normalized.measurements.evidence.sha256 = 'a'.repeat(64);
    draft.projects[0].project.driveMeasurements = normalized.measurements;
    const fetcher = vi.fn().mockResolvedValue(reply({ revision: 1, workspace: draft }));
    await expect(writeWorkspace(draft, 0, fetcher)).rejects.toThrow(/digest/);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(readWorkspace(fetcher)).rejects.toThrow(/digest/);
  });
  it('parses valid snapshots, rejects wrong envelopes and invalid project semantics', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ revision: 4, workspace }))
      .mockResolvedValueOnce(reply({ revision: '4', workspace }))
      .mockResolvedValueOnce(reply({ revision: 4, workspace: { ...workspace, activeProjectId: 'missing' } }));
    expect(await readWorkspace(fetcher)).toEqual({ revision: 4, workspace });
    expect(fetcher).toHaveBeenCalledWith('/api/workspace', { cache: 'no-store' });
    await expect(readWorkspace(fetcher)).rejects.toThrow();
    await expect(readWorkspace(fetcher)).rejects.toThrow(/selected project/i);
  });

  it('accepts the empty database envelope without treating it as invalid persisted data', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ revision: 0, workspace: null }));
    expect(await readWorkspace(fetcher)).toEqual({ revision: 0, workspace: null });
  });

  it('submits the existing artifact index at the given revision and exposes 409 without retry', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ revision: 8 }))
      .mockResolvedValueOnce(reply({ error: 'Workspace changed in another browser tab' }, 409));
    expect(await writeWorkspace(workspace, 7, fetcher)).toBe(8);
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/workspace');
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body as string)).toMatchObject({
      revision: 7, workspace, artifacts: { '11111111-1111-4111-8111-111111111111': expect.any(Array) },
    });
    await expect(writeWorkspace(workspace, 7, fetcher)).rejects.toBeInstanceOf(WorkspaceConflictError);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('rejects missing revision confirmations and preserves server errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ ok: true }))
      .mockResolvedValueOnce(reply({ error: 'Invalid workspace revision' }, 400));
    await expect(writeWorkspace(workspace, 0, fetcher)).rejects.toThrow(/revision/i);
    await expect(writeWorkspace(workspace, 0, fetcher)).rejects.toThrow('Invalid workspace revision');
  });
});
