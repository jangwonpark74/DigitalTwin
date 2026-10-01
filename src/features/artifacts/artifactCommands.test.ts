import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import { saveArtifactJson } from './artifactCommands';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

function fixture() {
  let content = JSON.stringify(workspace.projects[0].project, null, 2);
  const api = { read: vi.fn().mockResolvedValue({ revision: 0, workspace }),
    write: vi.fn().mockImplementation(async (draft: typeof workspace, revision: number) => {
      content = JSON.stringify(draft.projects[0].project, null, 2);
      return revision + 1;
    }) };
  const queries = { artifacts: vi.fn().mockImplementation(async () => [{ id: 'project-config', path: 'configuration/project.json',
    name: 'project.json', mimeType: 'application/json', description: 'Project config', updatedAt: '2026-01-01T00:00:00Z', content }]),
    runs: vi.fn(), run: vi.fn() };
  return { api, queries, controller: new AppController(api, queries) };
}

describe('artifact JSON commands', () => {
  it('validates, saves, logs and refreshes an editable project artifact', async () => {
    const { api, controller } = fixture();
    await controller.hydrate();
    await controller.refreshArtifacts();
    const original = controller.getSnapshot().artifacts.data![0].content!;
    const value = JSON.parse(original);
    value.integration.vCoreEndpoint = 'https://core.example.test';
    await saveArtifactJson(controller, projectId, 'project-config', original, JSON.stringify(value));
    expect(controller.getSnapshot().workspace!.projects[0].project.integration).toMatchObject({ vCoreEndpoint: 'https://core.example.test' });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('JSON artifact saved');
    expect(controller.getSnapshot().artifacts.data![0].content).toContain('https://core.example.test');
    expect(api.write).toHaveBeenCalledTimes(2);
  });

  it('rejects invalid JSON and stale files without writing', async () => {
    const { api, controller } = fixture();
    await controller.hydrate();
    await controller.refreshArtifacts();
    const original = controller.getSnapshot().artifacts.data![0].content!;
    await expect(saveArtifactJson(controller, projectId, 'project-config', original, '{broken')).rejects.toThrow(/invalid json/i);
    await expect(saveArtifactJson(controller, projectId, 'project-config', 'stale', original)).rejects.toThrow(/changed while/i);
    expect(api.write).not.toHaveBeenCalled();
  });
});
