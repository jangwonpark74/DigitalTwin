import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

async function freePort() {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No loopback port');
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

async function waitForServer(origin: string, process: ChildProcess) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (process.exitCode !== null) throw new Error(`Python server exited early (${process.exitCode})`);
    try { if ((await fetch(`${origin}/api/workspace`)).ok) return; } catch { /* Listener starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Disposable Python server did not start');
}

async function stop(process: ChildProcess) {
  if (process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, 'exit'); process.kill('SIGTERM');
  await Promise.race([exited, new Promise(resolve => setTimeout(resolve, 3000))]);
  if (process.exitCode === null && process.signalCode === null) { process.kill('SIGKILL'); await exited; }
}

test('built artifact browser edits project JSON and shares the saved file with the React root', async ({ page }) => {
  test.setTimeout(60_000);
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-artifact-sqlite-'));
  let server: ChildProcess | null = null;
  try {
    runToolSync('vite', ['build'], { cwd: root, stdio: 'ignore' });
    const origin = `http://127.0.0.1:${await freePort()}`;
    server = spawnPython(['serve.py', '--host', '127.0.0.1', '--port', new URL(origin).port], {
      cwd: root, env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'workspace.sqlite3') }, stdio: 'ignore',
    });
    await waitForServer(origin, server);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/frontend-preview.html`);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await page.getByRole('button', { name: 'Project artifacts' }).click();
    const artifacts = page.getByRole('region', { name: 'Project artifacts preview' });
    await expect(artifacts.getByRole('heading', { name: 'Project artifacts' })).toBeVisible();
    await artifacts.getByRole('button', { name: 'project.json' }).click();
    await artifacts.getByRole('button', { name: 'Edit JSON' }).click();
    const editor = artifacts.getByRole('textbox', { name: 'Artifact JSON editor' });
    const project = JSON.parse(await editor.inputValue());
    project.integration.vCoreEndpoint = 'https://core.example.test';
    await editor.fill(JSON.stringify(project));
    await artifacts.getByRole('button', { name: 'Save to project' }).click();
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`).then(response => response.json()))
      .workspace.projects[0].project.integration.vCoreEndpoint).toBe('https://core.example.test');
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`).then(response => response.json()))
      .workspace.projects[0].activity[0]?.title).toBe('JSON artifact saved');

    await artifacts.getByRole('button', { name: 'planning-manifest.json' }).click();
    const downloadEvent = page.waitForEvent('download');
    await artifacts.getByRole('button', { name: 'Download file' }).click();
    const download = await downloadEvent;
    const manifestPath = await download.path();
    expect(manifestPath).toBeTruthy();
    const manifest = JSON.parse(await readFile(manifestPath!, 'utf8'));
    manifest.integration.connected = true;
    manifest.runtime.status = 'connected';
    manifest.readiness = { ready: true, verified: true };
    manifest.management.hardware[0].discovery = 'discovered';
    await artifacts.locator('input[aria-label="Import planning manifest"]').setInputFiles({
      name: 'handoff.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(manifest)),
    });
    await expect(artifacts.getByRole('status')).toContainText('Imported handoff.json as');
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace.projects.length)
      .toBe(2);
    const savedWorkspace = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
    expect(savedWorkspace.projects).toHaveLength(2);
    expect(savedWorkspace.projects[0].project.integration.vCoreEndpoint).toBe('https://core.example.test');
    const imported = savedWorkspace.projects.find((item: { id: string }) => item.id === savedWorkspace.activeProjectId);
    expect(imported.project.integration.connected).toBe(false);
    expect(imported.project.runtime.status).toBe('not-connected');
    expect(imported.project.management.hardware.every((asset: { discovery: string }) => asset.discovery === 'not-discovered')).toBe(true);

    await page.goto(`${origin}/`);
    await page.getByRole('button', { name: 'Projects' }).click();
    const originalProject = page.locator('.project-card').filter({ hasText: 'RAN Twin · City Pilot' });
    await originalProject.getByRole('button', { name: 'Open project' }).click();
    await page.getByRole('button', { name: 'Project artifacts' }).click();
    const rootArtifacts = page.getByRole('region', { name: 'Project artifacts preview' });
    await rootArtifacts.getByRole('button', { name: 'project.json' }).click();
    await expect(rootArtifacts.getByRole('article', { name: 'Selected artifact' })).toContainText('https://core.example.test');
    expect(errors).toEqual([]);
  } finally {
    if (server) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});
