import { expect, test } from '@playwright/test';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { clickWorkspaceButton } from './navigation';

test('Jobs & runs cancels an active job and retries its frozen inputs after working-network edits', async ({ page }) => {
  test.setTimeout(90_000);
  const temporary = await mkdtemp(join(tmpdir(), 'atlas-run-recovery-'));
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
    const projectId = fixture.workspace.activeProjectId;
    expect((await page.request.put(`${origin}/api/workspace`, { data: { revision: 0, workspace: fixture.workspace, artifacts: fixture.artifacts } })).status()).toBe(200);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/?workspace=ray`);
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.getByLabel('Propagation input version').selectOption('working');
    await page.getByLabel('Samples per source').fill('3000');
    await page.getByRole('button', { name: 'Run Sionna-RT paths' }).click();
    await expect(page.getByRole('button', { name: 'Cancel path job' })).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel path job' }).click();
    await expect(page.getByRole('button', { name: 'Cancellation requested' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Run Sionna-RT paths' })).toBeDisabled();
    await expect(page.getByText(/Worker stopped; output discarded/)).toBeVisible({ timeout: 10_000 });
    expect(await page.request.get(`${origin}/api/projects/${projectId}/runs`).then(response => response.status())).toBe(200);
    const runs = await (await page.request.get(`${origin}/api/projects/${projectId}/runs`)).json();
    const parent = await (await page.request.get(`${origin}/api/runs/${runs.runs[0].id}`)).json();
    expect(parent.status).toBe('cancelled'); expect(parent.result).toBeNull();
    expect(parent.cancelRequestedAt).toBeTruthy();
    expect(parent.events.map((event: { status: string }) => event.status)).toEqual(['queued', 'running', 'cancelling', 'cancelled']);
    const saved = await (await page.request.get(`${origin}/api/workspace`)).json();
    saved.workspace.projects[0].project.sites[0].heightM = 99;
    expect((await page.request.put(`${origin}/api/workspace`, { data: { ...saved, artifacts: fixture.artifacts } })).status()).toBe(200);
    await clickWorkspaceButton(page, 'Jobs & runs');
    await page.reload();
    const records = page.getByRole('region', { name: 'Run records' });
    await records.getByRole('button', { name: new RegExp(parent.id) }).click();
    await expect(records.getByRole('region', { name: 'Run input identity' })).toContainText('Network inputs changed');
    await records.getByText('Run lifecycle · 4 events').click();
    const directory = 'docs/design-review/ran-runs'; await mkdir(directory, { recursive: true });
    await page.screenshot({ path: `${directory}/recovery-desktop.png` });
    let retryRequests = 0, failNextList = true;
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith(`/api/rt/jobs/${parent.id}/retry`)) retryRequests++; });
    await page.route(`**/api/projects/${projectId}/runs?*`, async route => {
      if (failNextList) {
        failNextList = false;
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture list connection lost' }) });
      } else await route.continue();
    });
    await records.getByRole('button', { name: 'Retry frozen inputs' }).click();
    await expect(records.getByText(/Request accepted for run/)).toBeVisible();
    await expect(records.getByRole('button', { name: 'Retry frozen inputs' })).toBeDisabled();
    await records.getByRole('button', { name: 'Refresh accepted run' }).click();
    await expect(records.locator('p').filter({ hasText: /^Exact-input retry of/ })).toBeVisible();
    expect(retryRequests).toBe(1);
    const updated = await (await page.request.get(`${origin}/api/projects/${projectId}/runs`)).json();
    const child = await (await page.request.get(`${origin}/api/runs/${updated.runs[0].id}`)).json();
    expect(child.id).not.toBe(parent.id); expect(child.retryOf).toBe(parent.id);
    expect(child.input).toEqual(parent.input);
    expect(child.input.transmitter.heightM).not.toBe(99);
    expect((await (await page.request.get(`${origin}/api/runs/${parent.id}`)).json())).toEqual(parent);
    await expect(records.getByText('0 paths returned')).toBeVisible({ timeout: 10_000 });
    await page.reload();
    await records.getByRole('button', { name: new RegExp(child.id) }).click();
    await expect(records.locator('p').filter({ hasText: /^Exact-input retry of/ })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await records.getByRole('region', { name: 'Run input identity' }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${directory}/recovery-mobile.png` });
    expect(errors).toEqual([]);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await rm(temporary, { recursive: true, force: true });
  }
});
