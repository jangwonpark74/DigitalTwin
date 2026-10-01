import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createManifest } from '../../../model.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import ArtifactsPreviewLeaf from './ArtifactsPreviewLeaf';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

function setup() {
  const api = { read: vi.fn().mockResolvedValue({ revision: 0, workspace }), write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
  const content = JSON.stringify(workspace.projects[0].project, null, 2);
  const queries = { artifacts: vi.fn().mockResolvedValue([
    { id: 'project-readme', path: 'README.md', name: 'README.md', mimeType: 'text/markdown', description: 'Scope', updatedAt: '', content: '# Project' },
    { id: 'project-config', path: 'configuration/project.json', name: 'project.json', mimeType: 'application/json', description: 'Config', updatedAt: '', content },
    { id: 'planning-manifest', path: 'reports/planning-manifest.json', name: 'planning-manifest.json', mimeType: 'application/json', description: 'Generated', updatedAt: '', content: '{}' },
  ]), runs: vi.fn(), run: vi.fn() };
  const controller = new AppController(api, queries);
  return { api, controller };
}

describe('ArtifactsPreviewLeaf', () => {
  it('imports a manifest as a new active project and strips runtime readiness claims', async () => {
    const { controller } = setup();
    await controller.hydrate();
    const record = controller.getSnapshot().workspace!.projects[0];
    render(<ArtifactsPreviewLeaf controller={controller} record={record} onNavigate={vi.fn()} />);
    await screen.findByText('project.json');
    const manifest = JSON.parse(createManifest(record.project));
    manifest.integration.connected = true;
    manifest.runtime.status = 'connected';
    manifest.readiness = { ready: true };
    const raw = JSON.stringify(manifest);
    const file = { name: 'handoff.json', size: raw.length, text: vi.fn(async () => raw) } as unknown as File;
    fireEvent.change(screen.getByLabelText('Import planning manifest'), { target: { files: [file] } });
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects).toHaveLength(2));
    const imported = controller.getSnapshot().workspace!.projects.find(item => item.id ===
      controller.getSnapshot().workspace!.activeProjectId)!;
    expect(imported.name).not.toBe(record.name);
    expect(imported.project.integration).toMatchObject({ connected: false });
    expect(imported.project.runtime).toMatchObject({ status: 'not-connected' });
  });

  it('browses the project tree, edits validated JSON, and keeps generated reports read-only', async () => {
    const { api, controller } = setup();
    await controller.hydrate();
    const record = controller.getSnapshot().workspace!.projects[0];
    render(<ArtifactsPreviewLeaf controller={controller} record={record} onNavigate={vi.fn()} />);
    expect(await screen.findByText('project.json')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'planning-manifest.json' }));
    expect(screen.queryByRole('button', { name: 'Edit JSON' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'project.json' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit JSON' }));
    const editor = screen.getByRole('textbox', { name: 'Artifact JSON editor' });
    const value = JSON.parse((editor as HTMLTextAreaElement).value);
    value.integration.vCoreEndpoint = 'https://core.example.test';
    fireEvent.change(editor, { target: { value: JSON.stringify(value) } });
    fireEvent.click(screen.getByRole('button', { name: 'Save to project' }));
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('JSON artifact saved'));
    expect(controller.getSnapshot().workspace!.projects[0].project.integration).toMatchObject({ vCoreEndpoint: 'https://core.example.test' });
    expect(api.write).toHaveBeenCalledTimes(2);
  });
});
