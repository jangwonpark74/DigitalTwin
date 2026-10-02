import { clickWorkspaceButton } from './navigation';
import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

test('Gangnam example imports registered SKT positions and renders synthetic street KPIs', async ({ page }) => {
  test.setTimeout(90_000);
  const root = process.cwd();
  const example = join(root, 'examples/gangnam-drive-test');
  const sources = JSON.parse(await readFile(join(example, 'sources.json'), 'utf8'));
  const manifestPath = join(example, 'gangnam-skt-drive-planning-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const temporary = await mkdtemp(join(process.env.ATLAS_TEST_TMPDIR ?? '/private/tmp', 'atlas-gangnam-example-'));
  let server: ChildProcess | null = null;
  try {
    runToolSync('vite', ['build'], { cwd: root, stdio: 'ignore' });
    const socket = createServer();
    socket.listen(0, '127.0.0.1');
    await once(socket, 'listening');
    const address = socket.address();
    if (!address || typeof address === 'string') throw new Error('No loopback port');
    await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
    const origin = `http://127.0.0.1:${address.port}`;
    server = spawnPython(['serve.py', '--host', '127.0.0.1', '--port', String(address.port)], {
      cwd: root, env: { ...process.env, ATLAS_DB_PATH: join(temporary, 'workspace.sqlite3') }, stdio: 'ignore',
    });
    await expect.poll(async () => {
      try { return (await fetch(`${origin}/api/workspace`)).ok; } catch { return false; }
    }).toBe(true);
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setViewportSize({ width: 1600, height: 1150 });
    await page.goto(origin);
    await clickWorkspaceButton(page, 'Project artifacts');
    await page.getByLabel('Import planning manifest', { exact: true }).setInputFiles(manifestPath);
    await expect(page.getByRole('status').filter({ hasText: 'Imported gangnam-skt-drive-planning-manifest.json' })).toBeVisible();
    const saved = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
    expect(saved.projects).toHaveLength(2);
    const imported = saved.projects.find((record: { id: string }) => record.id === saved.activeProjectId).project;
    expect(imported.sites).toHaveLength(9);
    expect(imported.driveMeasurements.samples).toHaveLength(676);
    imported.sites.forEach((site: { radioLocation: { latitude: number; longitude: number }; locationProvenance: { permitUid: string } }, index: number) => {
      const record = sources.sites.records[index];
      expect(site.radioLocation).toMatchObject({ longitude: record.position[0], latitude: record.position[1] });
      expect(site.locationProvenance.permitUid).toBe(record.uid);
    });
    await clickWorkspaceButton(page, 'Ray tracing lab');
    const lab = page.getByRole('region', { name: 'Ray tracing lab preview route' });
    await expect(lab.getByText(/676\/676 GPS samples/)).toBeVisible();
    await expect(lab.locator('.rf-map-marker.tx')).toHaveCount(9);
    await expect(lab.getByRole('checkbox', { name: 'Cell sites', exact: true })).toBeChecked();
    await expect(lab.locator('.open-rf-host')).toHaveAttribute('data-drive-height-m', '1.5');
    await expect(lab.getByText('9 / 9 sites positioned', { exact: true })).toBeVisible();
    await expect(lab.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30_000 });
    await lab.getByRole('button', { name: 'Fit drive route', exact: true }).click();
    await expect(lab.locator('.rf-map-marker.tx:not([hidden])')).toHaveCount(9);
    await lab.getByRole('checkbox', { name: 'Cell sites', exact: true }).uncheck();
    await expect(lab.locator('.rf-map-marker.tx:not([hidden])')).toHaveCount(0);
    await lab.getByRole('button', { name: 'Fit cell sites', exact: true }).click();
    await expect(lab.getByRole('checkbox', { name: 'Cell sites', exact: true })).toBeChecked();
    await expect(lab.locator('.rf-map-marker.tx:not([hidden])')).toHaveCount(9);
    await lab.getByRole('button', { name: 'Fit drive route', exact: true }).click();
    await lab.locator('.open-rf-host canvas').scrollIntoViewIfNeeded();
    const pixelColors = () => lab.locator('.open-rf-host canvas').evaluate(canvas => {
      const source = canvas as HTMLCanvasElement;
      const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
      const context = copy.getContext('2d')!; context.drawImage(source, 0, 0);
      const pixels = context.getImageData(0, 0, copy.width, copy.height).data;
      const counts = { good: 0, fair: 0, poor: 0 };
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 21 && pixels[i + 1] === 149 && pixels[i + 2] === 111) counts.good++;
        if (pixels[i] === 230 && pixels[i + 1] === 171 && pixels[i + 2] === 40) counts.fair++;
        if (pixels[i] === 220 && pixels[i + 1] === 82 && pixels[i + 2] === 97) counts.poor++;
      }
      return counts.good > 10 && counts.fair > 10 && counts.poor > 10;
    });
    await expect.poll(pixelColors).toBe(true);
    await expect(lab.getByLabel('Selected drive sample')).toContainText('SYNTHETIC_START');
    const screenshots = join(root, 'docs/design-review/gangnam-drive-example');
    await mkdir(screenshots, { recursive: true });
    await lab.screenshot({ path: join(screenshots, 'rsrp-desktop.png') });
    await lab.getByRole('group', { name: 'Drive test KPI' }).getByRole('button', { name: 'SINR dB', exact: true }).click();
    await expect.poll(pixelColors).toBe(true);
    await lab.screenshot({ path: join(screenshots, 'sinr-desktop.png') });
    // Confirm the standalone CSV is accepted without moving the site inventory.
    await lab.getByLabel('Import drive test CSV', { exact: true }).setInputFiles(join(example, sources.drive.fileName));
    await page.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(page.getByRole('region', { name: 'Import quality preview' })).toBeVisible();
    await page.getByRole('button', { name: 'Save GPS dataset' }).click();
    await expect(lab.getByText(/676\/676 GPS samples/)).toBeVisible();
    await expect.poll(async () => {
      const workspace = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
      return workspace.projects.find((record: { id: string }) => record.id === workspace.activeProjectId).activity[0]?.title;
    }).toBe('DM trace imported');
    const afterCsv = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
    const active = afterCsv.projects.find((record: { id: string }) => record.id === afterCsv.activeProjectId).project;
    expect(active.sites).toEqual(imported.sites);
    expect(active.driveMeasurements.samples).toEqual(manifest.driveMeasurements.samples);

    // The two project maps share geographic view and drive selections.
    await lab.getByRole('button', { name: 'Top-down view', exact: true }).click();
    const rayHost = lab.locator('.open-rf-host');
    await expect(rayHost).toHaveAttribute('data-map-pitch', '0');
    await lab.getByRole('slider', { name: 'Drive sample position' }).fill('340');
    const rayViewport = await rayHost.evaluate(element => ({ longitude: element.getAttribute('data-map-longitude'),
      latitude: element.getAttribute('data-map-latitude'), zoom: element.getAttribute('data-map-zoom'), bearing: element.getAttribute('data-map-bearing') }));
    await clickWorkspaceButton(page, 'City map');
    const city = page.getByRole('region', { name: 'Radio map preview route' });
    const cityHost = city.locator('.open-rf-host');
    await expect(cityHost).toHaveAttribute('data-map-pitch', '0');
    for (const [field, value] of Object.entries(rayViewport))
      await expect.poll(async () => Number(await cityHost.getAttribute(`data-map-${field}`))).toBeCloseTo(Number(value), 6);
    await expect(city.getByRole('button', { name: 'SINR dB', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(city.getByLabel('Selected drive sample')).toContainText('Sample 341');
    await expect(city.locator('.rf-map-marker.tx:not([hidden])')).toHaveCount(9);
    await city.screenshot({ path: join(screenshots, 'city-2d-desktop.png') });
    await city.getByRole('group', { name: 'Map camera controls' }).getByRole('button', { name: 'Zoom in', exact: true }).click();
    const zoomed = Number(rayViewport.zoom) + .5;
    await expect.poll(async () => Number(await cityHost.getAttribute('data-map-zoom'))).toBeCloseTo(zoomed, 6);
    await city.getByRole('checkbox', { name: 'Cell sites', exact: true }).uncheck();
    await city.getByRole('button', { name: 'Open ray tracing lab ↗', exact: true }).click();
    await expect.poll(async () => Number(await rayHost.getAttribute('data-map-pitch'))).toBeCloseTo(52, 6);
    await expect.poll(async () => Number(await rayHost.getAttribute('data-map-zoom'))).toBeCloseTo(zoomed, 6);
    await expect(lab.getByRole('checkbox', { name: 'Cell sites', exact: true })).not.toBeChecked();
    await expect(lab.getByRole('slider', { name: 'Drive sample position' })).toHaveValue('340');
    await expect(lab.getByRole('button', { name: 'SINR dB', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await lab.getByRole('checkbox', { name: 'Cell sites', exact: true }).check();

    await clickWorkspaceButton(page, 'Sites and Cells');
    const planner = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await expect(planner.getByText('All sites positioned', { exact: true })).toBeVisible();
    await expect(planner.getByRole('button', { name: '2D map', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(planner.locator('.open-rf-host')).toHaveAttribute('data-map-pitch', '0');
    await planner.getByRole('searchbox', { name: 'Search sites' }).fill('SITE-07');
    const inventory = planner.getByRole('group', { name: 'Select a site' });
    await expect(inventory.getByRole('button')).toHaveCount(1);
    await inventory.getByRole('button').click();
    await expect(planner.getByLabel('Site name', { exact: true })).toHaveValue(imported.sites[6].name);
    await planner.getByRole('tab', { name: /SITE-07-C2/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(planner.getByRole('tab', { name: /SITE-07-C3/ })).toHaveAttribute('aria-selected', 'true');
    await planner.getByRole('searchbox', { name: 'Search sites' }).fill('');
    await planner.getByRole('button', { name: 'Fit sites', exact: true }).click();
    await expect(planner.locator('.rf-map-marker.tx:not([hidden])')).toHaveCount(9);
    await expect(planner.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30_000 });
    await expect(planner.locator('.open-rf-host')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
    const plannerScreenshots = join(root, 'docs/design-review/planner-commercial');
    await mkdir(plannerScreenshots, { recursive: true });
    await planner.screenshot({ path: join(plannerScreenshots, 'gangnam-2d-desktop.png') });
    await planner.getByRole('button', { name: '3D scene', exact: true }).click();
    await expect.poll(async () => Number(await planner.locator('.open-rf-host').getAttribute('data-map-pitch'))).toBeCloseTo(52, 6);
    await expect(planner.locator('.open-rf-host')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
    await planner.screenshot({ path: join(plannerScreenshots, 'gangnam-3d-desktop.png') });
    await clickWorkspaceButton(page, 'City map');
    await expect(city.getByRole('button', { name: 'Project 3D', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => Number(await cityHost.getAttribute('data-map-pitch'))).toBeCloseTo(52, 6);
    await clickWorkspaceButton(page, 'Sites and Cells');
    await expect(planner.getByRole('button', { name: '3D scene', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(planner.locator('.open-rf-host')).toHaveAttribute('data-map-ready', 'true', { timeout: 30_000 });
    await planner.screenshot({ path: join(plannerScreenshots, 'gangnam-mobile.png') });
    const afterViews = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
    expect(afterViews).toEqual(afterCsv);
    expect(errors).toEqual([]);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped;
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
