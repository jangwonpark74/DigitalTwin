import { expect, test } from '@playwright/test';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { workspaceArtifactIndex } from '../../artifacts.mjs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { clickWorkspaceButton } from './navigation';

test('reviewed source identities persist across maps and frozen contexts without rewriting observations', async ({ page }) => {
  test.setTimeout(90_000);
  const temporary = await mkdtemp(join(tmpdir(), 'atlas-cell-identity-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  runToolSync('vite', ['build'], { stdio: 'ignore' });
  const server = spawnPython(['serve.py', '--port', String(port)], { env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'identity.sqlite3') }, stdio: 'ignore' });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await expect.poll(async () => { try { return (await page.request.get(`${origin}/api/workspace`)).status(); } catch { return 0; } }).toBe(200);
    const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/measurement-library.mjs'], { encoding: 'utf8' }));
    expect((await page.request.put(`${origin}/api/workspace`, { data: { revision: 0, workspace: fixture.workspace, artifacts: fixture.artifacts } })).status()).toBe(200);
    const original = fixture.workspace.projects[0].project, source = original.driveMeasurements.samples[0], targetSite = original.sites[1], target = targetSite.cells[0].id;
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 }); await page.goto(`${origin}/?workspace=measurements`);
    await page.getByRole('button', { name: 'Review cell identities' }).click();
    const review = page.getByRole('region', { name: 'Cell identity review' });
    await review.getByRole('combobox', { name: `${source.technology} ${source.servingCell} project cell` }).selectOption(target);
    const directory = 'docs/design-review/cell-identity'; await mkdir(directory, { recursive: true });
    await review.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${directory}/identity-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 }); await review.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: `${directory}/identity-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await review.getByRole('button', { name: 'Save identity interpretation' }).click();
    await expect(page.getByRole('status')).toContainText('Cell identity interpretation retained and selected');
    await expect(page.getByRole('button', { name: 'Review v3 second.csv' })).toBeVisible();
    let saved = await (await page.request.get(`${origin}/api/workspace`)).json();
    let project = saved.workspace.projects[0].project;
    expect(project.measurementLibrary.records.slice(0, 2)).toEqual(original.measurementLibrary.records);
    expect(project.driveMeasurements.samples).toEqual(original.driveMeasurements.samples);
    expect(project.driveMeasurements.evidence).toEqual(original.driveMeasurements.evidence);
    expect(project.study).toEqual(original.study);
    await page.reload();
    await clickWorkspaceButton(page, 'Virtual drive test');
    await expect(page.locator('#dm-selected')).toContainText(source.servingCell);
    await expect(page.locator('#dm-selected')).toContainText(`Project cell: ${target}`);
    await page.getByRole('button', { name: 'Select associated site' }).click();
    await clickWorkspaceButton(page, 'City map');
    await expect(page.getByLabel('Selected drive sample')).toContainText(`Project cell: ${target}`);
    await expect(page.getByRole('button', { name: `${targetSite.name} in site list` })).toHaveAttribute('aria-pressed', 'true');
    await page.goto(`${origin}/?workspace=ray`);
    await page.getByLabel('Propagation input version').selectOption(`baseline:${original.study.baselines[0].id}`);
    await expect(page.getByLabel('Selected drive sample')).toContainText('Unresolved source identity');
    await page.getByLabel('Propagation input version').selectOption('working');
    await expect(page.getByLabel('Selected drive sample')).toContainText(`Project cell: ${target}`);
    // Historical associations survive inventory removal and are shown as unresolved.
    saved = await (await page.request.get(`${origin}/api/workspace`)).json();
    project = saved.workspace.projects[0].project; project.sites = project.sites.filter((site: { id: string }) => site.id !== targetSite.id);
    expect((await page.request.put(`${origin}/api/workspace`, { data: { revision: saved.revision, workspace: saved.workspace, artifacts: workspaceArtifactIndex(saved.workspace) } })).status()).toBe(200);
    await page.goto(`${origin}/?workspace=measurements`);
    await clickWorkspaceButton(page, 'City map');
    await expect(page.getByLabel('Selected drive sample')).toContainText('Target cell missing');
    await expect(page.getByRole('button', { name: 'Select associated site' })).toHaveCount(0);
    expect((await (await page.request.get(`${origin}/api/workspace`)).json()).workspace.projects[0].project.study).toEqual(original.study);
    expect(errors).toEqual([]);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await rm(temporary, { recursive: true, force: true });
  }
});
