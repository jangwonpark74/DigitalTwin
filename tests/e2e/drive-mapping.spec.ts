import { expect, test } from '@playwright/test';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { clickWorkspaceButton } from './navigation';

test('vendor GPS mapping preserves unavailable KPIs, unit provenance and frozen evidence through SQLite reload', async ({ page }) => {
  test.setTimeout(90_000);
  const temporary = await mkdtemp(join(tmpdir(), 'atlas-drive-mapping-'));
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const address = socket.address(); if (!address || typeof address === 'string') throw new Error('No port');
  const port = address.port; await new Promise<void>(resolve => socket.close(() => resolve()));
  runToolSync('vite', ['build'], { stdio: 'ignore' });
  const server = spawnPython(['serve.py', '--port', String(port)], {
    env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'mapped.sqlite3') }, stdio: 'ignore',
  });
  try {
    const origin = `http://127.0.0.1:${port}`;
    await expect.poll(async () => { try { return (await page.request.get(`${origin}/api/workspace`)).status(); } catch { return 0; } }).toBe(200);
    const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/drive-import.mjs'], { encoding: 'utf8' }));
    const project = fixture.workspace.projects[0].project;
    const baseline = structuredClone(project.study.baselines[0]);
    const raw = project.driveMeasurements.evidence.rawCsv;
    project.driveMeasurements = null;
    expect((await page.request.put(`${origin}/api/workspace`, { data: { revision: 0, workspace: fixture.workspace, artifacts: fixture.artifacts } })).status()).toBe(200);
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(`${origin}/?workspace=drive`);
    await page.locator('#dm-csv').setInputFiles({ name: 'vendor.csv', mimeType: 'text/csv', buffer: Buffer.from(raw) });
    const review = page.getByRole('region', { name: 'Drive CSV import review' });
    for (const [field, column] of [['Elapsed time', 'Elapsed'], ['Radio technology', 'RAT'], ['Serving cell', 'Cell'], ['Latitude', 'Lat'], ['Longitude', 'Lon'], ['RSRP / SS-RSRP', 'Power'], ['DL throughput', 'Download']]) {
      await review.getByLabel(`${field} source column`).selectOption(column);
    }
    await review.getByLabel('Elapsed time source unit').selectOption('ms');
    await review.getByLabel('DL throughput source unit').selectOption('bps');
    const directory = 'docs/design-review/drive-mapping'; await mkdir(directory, { recursive: true });
    await review.getByText('2. Column and unit mapping').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/mapping-desktop.png` });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await review.getByLabel('DL throughput source column').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${directory}/mapping-mobile.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await review.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(review.getByRole('table', { name: 'KPI availability' })).toContainText('2 / 3');
    await expect(review.getByRole('row').filter({ hasText: 'SINR / SS-SINR' })).toContainText('0 / 3');
    await review.getByRole('button', { name: 'Save GPS dataset' }).click();
    await expect(review).toHaveCount(0);
    await expect(page.getByText('2 available · 1 missing · 3 selected')).toBeVisible();
    const trend = page.getByRole('img', { name: /^RSRP \/ SS-RSRP trend by sample number, scale .* dBm, with illustrative quality thresholds$/ });
    await expect(trend).toBeVisible();
    await expect(trend.locator('line[stroke-width="3"]')).toHaveCount(0);
    await expect(trend.locator('circle')).toHaveCount(2);
    await page.getByLabel('Color route by').selectOption('sinr');
    await expect(page.getByText(/No available SINR/)).toBeVisible();
    await clickWorkspaceButton(page, 'City map');
    await expect(page.getByText('0 poor / 0 available · — · 3 missing')).toBeVisible();
    await expect(page.getByLabel('Selected drive sample')).toContainText('Unavailable');
    await page.reload();
    await page.getByRole('button', { name: 'SINR dB', exact: true }).click();
    await expect(page.getByLabel('Selected drive sample')).toContainText('Unavailable');
    const first = await (await page.request.get(`${origin}/api/workspace`)).json();
    const saved = first.workspace.projects[0].project.driveMeasurements;
    expect(saved.schemaVersion).toBe(2); expect(saved.samples[1]).toMatchObject({ rsrpDbm: null, dlMbps: 0, timeS: 1.5 });
    expect(saved.evidence.rawCsv).toBe(raw);
    expect(first.workspace.projects[0].project.study.baselines[0]).toEqual(baseline);
    const forged = structuredClone(first); forged.workspace.projects[0].project.driveMeasurements.samples[0].rsrpDbm = -90;
    expect((await page.request.put(`${origin}/api/workspace`, { data: { ...forged, artifacts: fixture.artifacts } })).status()).toBe(400);
    expect((await (await page.request.get(`${origin}/api/workspace`)).json()).revision).toBe(first.revision);
    await clickWorkspaceButton(page, 'Ray tracing lab');
    await page.getByLabel('Propagation input version').selectOption('working');
    await page.getByLabel('Import drive test CSV').setInputFiles({ name: 'vendor.csv', mimeType: 'text/csv', buffer: Buffer.from(raw) });
    for (const [field, entry] of Object.entries(saved.evidence.transformations[0].mapping) as [string, { column: string | null; unit: string | null }][]) {
      if (!entry.column || ['x_pct', 'y_pct'].includes(field)) continue;
      const labels: Record<string, string> = { time_s: 'Elapsed time', technology: 'Radio technology', serving_cell: 'Serving cell', latitude: 'Latitude', longitude: 'Longitude', rsrp_dbm: 'RSRP / SS-RSRP', dl_mbps: 'DL throughput' };
      await review.getByLabel(`${labels[field]} source column`).selectOption(entry.column);
    }
    await review.getByLabel('Elapsed time source unit').selectOption('ms');
    await review.getByLabel('DL throughput source unit').selectOption('kbps');
    await review.getByRole('button', { name: 'Validate and preview' }).click();
    await review.getByRole('button', { name: 'Save GPS dataset' }).click();
    await expect(review).toHaveCount(0);
    const second = await (await page.request.get(`${origin}/api/workspace`)).json();
    const replacement = second.workspace.projects[0].project.driveMeasurements;
    expect(replacement.samples[0].dlMbps).toBe(7500);
    expect(replacement.evidence.sha256).toBe(saved.evidence.sha256);
    expect(replacement.evidence.datasetId).not.toBe(saved.evidence.datasetId);
    expect(second.workspace.projects[0].project.study.baselines[0]).toEqual(baseline);
    await clickWorkspaceButton(page, 'Virtual drive test');
    await page.getByLabel('Color route by').selectOption('dl');
    await page.locator('.dm-table button[data-dm-jump="1"]').click();
    await expect(page.locator('#dm-selected .dm-value')).toContainText('0.0 Mbps');
    await page.locator('.dm-table button[data-dm-jump="2"]').click();
    await expect(page.locator('#dm-selected .dm-value')).toContainText('— Mbps');
    await page.screenshot({ path: `${directory}/partial-analysis-desktop.png` });
    expect(errors).toEqual([]);
  } finally {
    if (server.exitCode === null && server.signalCode === null) { const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped; }
    await rm(temporary, { recursive: true, force: true });
  }
});
