import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema } from '../../api/schemas';
import { applyMonitoringThreshold } from './monitoringCommands';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

describe('project-scoped monitoring thresholds', () => {
  it('saves valid thresholds without enabling telemetry', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    await applyMonitoringThreshold(controller, projectId, 'gpuUtilizationPct', '92');
    const monitoring = (controller.getSnapshot().workspace!.projects[0].project.management as {
      monitoring: { connected: boolean; lastSample: null; thresholds: { gpuUtilizationPct: number } };
    }).monitoring;
    expect(monitoring).toMatchObject({ connected: false, lastSample: null, thresholds: { gpuUtilizationPct: 92 } });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Monitoring threshold changed');
  });

  it('rejects out-of-range and unknown thresholds before writing', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn() };
    const controller = new AppController(api);
    await controller.hydrate();
    expect(() => applyMonitoringThreshold(controller, projectId, 'fronthaulLatencyMs', '501'))
      .toThrow('Invalid monitoring threshold fronthaulLatencyMs');
    expect(applyMonitoringThreshold(controller, projectId, '__proto__', '20')).toBeNull();
    expect(api.write).not.toHaveBeenCalled();
  });
});
