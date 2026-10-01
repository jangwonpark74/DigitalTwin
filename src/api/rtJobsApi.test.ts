import { describe, expect, it, vi } from 'vitest';
import { getRtCapability, getRtJob, submitRtJob } from './rtJobsApi';

const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { 'Content-Type': 'application/json' },
});
const job = { map: { latitude: 37, longitude: 127, radiusMeters: 500 },
  scene: { coordinateSystem: 'EPSG:4326', footprints: [] }, siteId: 'site-1',
  transmitter: { latitude: 37, longitude: 127, heightM: 10 },
  receiver: { latitude: 37, longitude: 127, heightM: 1.5 },
  frequencyGhz: 3.5, samplesPerSrc: 10000, maxDepth: 2, reflections: true, diffraction: false };

const queued = { id: 'run-1', status: 'queued', createdAt: '2026-01-01' };

describe('RT job transport adapters', () => {
  it('keeps capability unavailable distinct from a completed job', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ available: false, platform: 'Darwin', message: 'Not installed' }));
    expect(await getRtCapability(fetcher)).toEqual({ available: false, platform: 'Darwin', message: 'Not installed' });
    expect(fetcher).toHaveBeenCalledWith('/api/rt/capability', { cache: 'no-store' });
  });

  it('submits the domain-built job with project ID and rejects an unavailable worker', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(queued, 202))
      .mockResolvedValueOnce(reply({ error: 'Sionna-RT is unavailable' }, 503));
    expect(await submitRtJob('pilot', job, fetcher)).toEqual(queued);
    const [path, options] = fetcher.mock.calls[0] as [string, RequestInit];
    expect(path).toBe('/api/rt/jobs');
    expect(options).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(JSON.parse(options.body as string)).toEqual({ ...job, projectId: 'pilot' });
    await expect(submitRtJob('pilot', job, fetcher)).rejects.toThrow('Sionna-RT is unavailable');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('parses queued/failed/completed-empty without silently treating invalid results as success', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(reply(queued))
      .mockResolvedValueOnce(reply({ ...queued, status: 'failed', error: 'Worker stopped', completedAt: '2026-01-01' }))
      .mockResolvedValueOnce(reply({ ...queued, status: 'complete', result: { totalPaths: 0, paths: [] }, completedAt: '2026-01-01' }))
      .mockResolvedValueOnce(reply({ ...queued, status: 'complete', result: null }))
      .mockResolvedValueOnce(reply({ ...queued, status: 'unknown' }));
    expect((await getRtJob('run-1', fetcher)).status).toBe('queued');
    expect(fetcher).toHaveBeenCalledWith('/api/rt/jobs/run-1', { cache: 'no-store' });
    expect((await getRtJob('run-1', fetcher)).status).toBe('failed');
    expect((await getRtJob('run-1', fetcher)).status).toBe('complete');
    await expect(getRtJob('run-1', fetcher)).rejects.toThrow();
    await expect(getRtJob('run-1', fetcher)).rejects.toThrow();
  });

  it('rejects malformed job identifiers and mismatched response IDs before accepting a record', async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ ...queued, id: 'other-run' }));
    await expect(getRtJob('../escape', fetcher)).rejects.toThrow(/job ID/i);
    await expect(submitRtJob('../escape', job, fetcher)).rejects.toThrow(/project ID/i);
    expect(fetcher).not.toHaveBeenCalled();
    await expect(getRtJob('run-1', fetcher)).rejects.toThrow(/different job/i);
  });
});
