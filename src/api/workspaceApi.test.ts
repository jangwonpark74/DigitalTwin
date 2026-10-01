import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../workspaces.mjs';
import { WorkspaceConflictError, readWorkspace, writeWorkspace } from './workspaceApi';
import { workspaceSchema } from './schemas';

const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z' }));
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => vi.unstubAllGlobals());

describe('revisioned workspace API', () => {
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
