import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createManifest } from '../../../model.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import { importManifestAsProject } from './manifestImport';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

function setup() {
  const api = { read: vi.fn().mockResolvedValue({ revision: 3, workspace }), write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
  const queries = { artifacts: vi.fn().mockResolvedValue([]), runs: vi.fn(), run: vi.fn() };
  return { api, controller: new AppController(api, queries) };
}

describe('manifest import', () => {
  it('imports a schema-versioned manifest as a unique sanitized project', async () => {
    const { api, controller } = setup();
    await controller.hydrate();
    const manifest = JSON.parse(createManifest(workspace.projects[0].project));
    manifest.integration.connected = true;
    manifest.runtime.status = 'connected';
    manifest.readiness = { ready: true, verified: true };
    manifest.management.hardware[0].discovery = 'discovered';

    const result = await importManifestAsProject(controller, manifest, 'handoff.json');
    const saved = controller.getSnapshot().workspace!;
    expect(saved.projects).toHaveLength(2);
    expect(saved.activeProjectId).toBe(result.id);
    expect(result.name).not.toBe(workspace.projects[0].name);
    expect(result.project).toMatchObject({
      integration: { connected: false }, runtime: { status: 'not-connected' },
    });
    expect(result.project.management.hardware.every((asset: { discovery: string }) => asset.discovery === 'not-discovered')).toBe(true);
    expect(saved.projects[0].name).toBe(workspace.projects[0].name);
    expect(api.write).toHaveBeenCalledOnce();
  });

  it('rejects non-object manifests without mutating the workspace', async () => {
    const { api, controller } = setup();
    await controller.hydrate();
    await expect(importManifestAsProject(controller, null, 'bad.json')).rejects.toThrow(/JSON object/i);
    expect(controller.getSnapshot().workspace!.projects).toHaveLength(1);
    expect(api.write).not.toHaveBeenCalled();
  });
});
