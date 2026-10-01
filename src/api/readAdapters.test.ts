import { describe, expect, it, vi } from 'vitest';
import { listProjects } from './projectsApi';
import { getArtifact, listArtifacts } from './artifactsApi';
import { getRun, listRuns } from './runsApi';

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const project = { id: 'pilot', name: 'City Pilot', status: 'active', createdAt: '2026-01-01',
  updatedAt: '2026-01-02', taskCount: 2, artifactCount: 1, runCount: 0 };
const file = { id: 'project-config', path: 'City Pilot/configuration/project.json',
  name: 'project.json', mimeType: 'application/json', description: 'Configuration',
  updatedAt: '2026-01-02', size: 2, content: '{}' };
const run = { id: 'run-1', projectId: 'pilot', taskId: null, kind: 'sionna-rt',
  status: 'queued', createdAt: '2026-01-02', completedAt: null, totalPaths: null, error: null };

describe('read-only project/artifact/run adapters', () => {
  it('parses the project registry and preserves empty and HTTP error states', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ projects: [project] }))
      .mockResolvedValueOnce(reply({ projects: [] }))
      .mockResolvedValueOnce(reply({ projects: [{ ...project, runCount: '0' }] }))
      .mockResolvedValueOnce(reply({ error: 'Unavailable' }, 503));
    expect(await listProjects(fetcher)).toEqual([project]);
    expect(fetcher).toHaveBeenCalledWith('/api/projects', { cache: 'no-store' });
    expect(await listProjects(fetcher)).toEqual([]);
    await expect(listProjects(fetcher)).rejects.toThrow();
    await expect(listProjects(fetcher)).rejects.toThrow('Unavailable');
  });

  it('validates artifact hierarchy and content while keeping project ID in the URL', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ artifacts: [file] }))
      .mockResolvedValueOnce(reply(file))
      .mockResolvedValueOnce(reply({ artifacts: [{ ...file, path: 'Other/configuration/project.json' }] }))
      .mockResolvedValueOnce(reply({ ...file, content: 123 }));
    expect(await listArtifacts('pilot', 'City Pilot', { content: true }, fetcher)).toEqual([file]);
    expect(fetcher).toHaveBeenCalledWith('/api/projects/pilot/artifacts?content=1', { cache: 'no-store' });
    expect(await getArtifact('pilot', 'City Pilot', 'project-config', fetcher)).toEqual(file);
    expect(fetcher).toHaveBeenCalledWith('/api/projects/pilot/artifacts/project-config', { cache: 'no-store' });
    await expect(listArtifacts('pilot', 'City Pilot', { content: true }, fetcher)).rejects.toThrow(/different project/i);
    await expect(getArtifact('pilot', 'City Pilot', 'project-config', fetcher)).rejects.toThrow();
  });

  it('rejects traversal in identifiers before fetch and supports metadata-only records', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ artifacts: [{ ...file, content: undefined }] }));
    await expect(listArtifacts('../pilot', 'City Pilot', {}, fetcher)).rejects.toThrow(/project ID/i);
    await expect(getArtifact('pilot', 'City Pilot', '../secret', fetcher)).rejects.toThrow(/artifact ID/i);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await listArtifacts('pilot', 'City Pilot', {}, fetcher)).toEqual([{ ...file, content: undefined }]);
    expect(fetcher).toHaveBeenCalledWith('/api/projects/pilot/artifacts', { cache: 'no-store' });
  });

  it('preserves pagination and rejects foreign-project runs and inconsistent pages', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ runs: [run], total: 2, nextOffset: 1 }))
      .mockResolvedValueOnce(reply({ ...run, input: { map: {} }, result: null }))
      .mockResolvedValueOnce(reply({ ...run, projectId: 'other', input: {}, result: null }))
      .mockResolvedValueOnce(reply({ runs: [run], total: 1, nextOffset: 0 }));
    expect(await listRuns('pilot', { limit: 1, offset: 0 }, fetcher)).toEqual({ runs: [run], total: 2, nextOffset: 1 });
    expect(fetcher).toHaveBeenCalledWith('/api/projects/pilot/runs?limit=1&offset=0', { cache: 'no-store' });
    expect(await getRun('pilot', 'run-1', fetcher)).toMatchObject({ id: 'run-1', projectId: 'pilot' });
    await expect(getRun('pilot', 'run-1', fetcher)).rejects.toThrow(/different project/i);
    await expect(listRuns('pilot', { limit: 1, offset: 0 }, fetcher)).rejects.toThrow(/pagination/i);
  });

  it('bounds pagination before fetching and retains an explicit empty page', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply({ runs: [], total: 0, nextOffset: null }))
      .mockResolvedValueOnce(reply({ runs: [], total: 0, nextOffset: null }))
      .mockResolvedValueOnce(reply({ ...run, input: {} }));
    await expect(listRuns('pilot', { limit: 0 }, fetcher)).rejects.toThrow(/limit/i);
    await expect(listRuns('pilot', { offset: -1 }, fetcher)).rejects.toThrow(/offset/i);
    expect(fetcher).not.toHaveBeenCalled();
    expect(await listRuns('pilot', {}, fetcher)).toEqual({ runs: [], total: 0, nextOffset: null });
    expect(await listRuns('pilot', { offset: 10 }, fetcher)).toEqual({ runs: [], total: 0, nextOffset: null });
    await expect(getRun('pilot', 'run-1', fetcher)).rejects.toThrow();
  });
});
