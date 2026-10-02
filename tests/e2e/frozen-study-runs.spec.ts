import { expect, test } from '@playwright/test';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { clickWorkspaceButton } from './navigation';

test('captured path jobs retain server-verified inputs across completion, failure and stale working edits', async ({ page }) => {
  test.setTimeout(90_000);
  const temporary = await mkdtemp(join(tmpdir(), 'atlas-frozen-run-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  runToolSync('vite', ['build'], { stdio: 'ignore' });
  const server = spawnPython(['tests/fixtures/study-server.py', '--port', String(port)], {
    env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'runs.sqlite3') }, stdio: 'ignore',
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await expect.poll(async () => { try { return (await page.request.get(`${origin}/api/workspace`)).status(); } catch { return 0; } }).toBe(200);
    const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/study-run.mjs'], { encoding: 'utf8' }));
    const seeded = await page.request.put(`${origin}/api/workspace`, { data: { revision: 0, workspace: fixture.workspace, artifacts: fixture.artifacts } });
    expect(seeded.status()).toBe(200);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?workspace=ray`);
    await page.getByLabel('Propagation input version').selectOption('candidate:candidate-1:2');
    await expect(page.getByRole('button', { name: 'Place transmitter' })).toBeDisabled();
    await expect(page.getByLabel('Import drive test CSV')).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Import drive test CSV', exact: true })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Run Sionna-RT paths' })).toBeEnabled();
    const directory = 'docs/design-review/ran-runs'; await mkdir(directory, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.screenshot({ path: `${directory}/captured-propagation-desktop.png` });
    await page.getByRole('button', { name: 'Run Sionna-RT paths' }).click();
    await expect(page.getByText(/completed · 0 valid paths/)).toBeVisible({ timeout: 10_000 });
    const projectId = fixture.workspace.activeProjectId;
    const runs = await (await page.request.get(`${origin}/api/projects/${projectId}/runs`)).json();
    const first = await (await page.request.get(`${origin}/api/runs/${runs.runs[0].id}`)).json();
    expect(first.input.transmitter.heightM).toBe(35);
    expect(first.input.runCapture.reference.version).toBe(2);
    expect(first.result.runCapture.jobSha256).toBe(first.input.runCapture.jobSha256);
    expect(first.result.runCapture.networkInputJson).toBeUndefined();
    await page.getByLabel('Propagation input version').selectOption('candidate:candidate-1:3');
    await expect(page.getByRole('button', { name: 'Run Sionna-RT paths' })).toBeDisabled();
    await expect(page.getByText(/downtiltDeg: the isotropic/)).toBeVisible();
    const bad = await page.request.post(`${origin}/api/rt/jobs`, { data: { ...fixture.unsupportedJob, projectId } });
    expect(bad.status()).toBe(400);
    await page.getByLabel('Propagation input version').selectOption('candidate:candidate-1:2');
    await page.getByLabel('Samples per source').fill('2000');
    await page.getByRole('button', { name: 'Run Sionna-RT paths' }).click();
    await expect(page.getByText(/Fixture interrupted worker/)).toBeVisible({ timeout: 10_000 });
    await clickWorkspaceButton(page, 'Task board');
    const records = page.getByRole('region', { name: 'Run records' });
    await records.getByRole('button', { name: /failed/ }).click();
    await expect(records.getByRole('region', { name: 'Run input identity' })).toContainText('Candidate candidate-1 · v2');
    await expect(records.getByRole('region', { name: 'Run input identity' })).toContainText('Historical candidate v2');
    await page.reload();
    await expect(records.getByText('2 runs recorded · showing 2')).toBeVisible();
    const working = await page.request.post(`${origin}/api/rt/jobs`, { data: { ...fixture.workingJob, projectId } });
    expect(working.status()).toBe(202);
    const submitted = await working.json();
    await expect.poll(async () => (await (await page.request.get(`${origin}/api/runs/${submitted.id}`)).json()).status).toBe('complete');
    await records.getByRole('button', { name: 'Refresh run list' }).click();
    await records.getByRole('button', { name: new RegExp(submitted.id) }).click();
    await expect(records.getByRole('region', { name: 'Run input identity' })).toContainText('identity matches');
    const saved = await (await page.request.get(`${origin}/api/workspace`)).json();
    saved.workspace.projects[0].project.sites[0].heightM = 99;
    const update = await page.request.put(`${origin}/api/workspace`, { data: { ...saved, artifacts: fixture.artifacts } });
    expect(update.status()).toBe(200);
    await page.reload();
    await records.getByRole('button', { name: new RegExp(submitted.id) }).click();
    await expect(records.getByRole('region', { name: 'Run input identity' })).toContainText('Network inputs changed');
    await records.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: `${directory}/frozen-input-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    await records.getByRole('region', { name: 'Run input identity' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${directory}/frozen-input-mobile.png` });
    expect(errors).toEqual([]);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await rm(temporary, { recursive: true, force: true });
  }
});
