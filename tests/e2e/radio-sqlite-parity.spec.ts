import { clickWorkspaceButton, openMobileNavigation } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

test.setTimeout(60_000);

test.describe.configure({ mode: 'serial' });

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
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
  const exited = once(process, 'exit');
  process.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
  clearTimeout(timer!);
  if (process.exitCode === null && process.signalCode === null) {
    process.kill('SIGKILL');
    await exited;
  }
}

async function openLegacyRadio(page: Page) {
  await clickWorkspaceButton(page, 'Sites and Cells');
  await page.getByRole('tab', { name: 'Position', exact: true }).click();
}

test('built Radio preview and React root share a saved map estimate in disposable SQLite', async ({ page }) => {
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-radio-sqlite-'));
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
    await openLegacyRadio(page);
    const preview = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await expect(preview.getByRole('tabpanel', { name: 'Position', exact: true }).getByText('Coordinates not set · Unassigned', { exact: true })).toBeVisible();
    await preview.getByRole('button', { name: /SITE-02/ }).click();
    await preview.getByRole('button', { name: '⌖ Place on map' }).click();
    const beforeCity = await (await fetch(`${origin}/api/workspace`)).json();
    await page.getByRole('button', { name: 'Explore 3D city' }).click();
    const city = page.getByRole('region', { name: 'Silicon Valley open 3D map' });
    await expect(city.getByRole('heading', { name: /Silicon Valley/i })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await city.getByRole('button', { name: 'Return to radio map' }).click();
    const afterCity = await (await fetch(`${origin}/api/workspace`)).json();
    expect(afterCity.workspace.projects[0].project).toEqual(beforeCity.workspace.projects[0].project);
    const placement = page.getByRole('form', { name: 'Radio map placement for SITE-02' });
    const x = placement.getByLabel('Map X position (%)');
    const y = placement.getByLabel('Map Y position (%)');
    await x.fill('35');
    await x.press('Tab');
    await expect(y).toBeFocused();
    await y.fill('72');
    await y.press('Tab');
    await expect(placement.getByRole('button', { name: 'Place radio at these coordinates' })).toBeFocused();
    await placement.getByRole('button', { name: 'Place radio at these coordinates' }).click();

    await expect(preview.getByText(/Schematic-map estimate/)).toBeVisible();
    await expect(preview.getByRole('tab', { name: 'Position', exact: true })).toHaveAttribute('aria-selected', 'true');
    const workspaceResponse = await fetch(`${origin}/api/workspace`);
    const workspace = await workspaceResponse.json();
    const project = workspace.workspace.projects[0];
    const site = project.project.sites.find((candidate: { id: string }) => candidate.id === 'SITE-02');
    expect(site).toMatchObject({ x: 35, y: 72, radioLocation: { source: 'map-estimate' } });
    expect(site.radioLocation.latitude).toEqual(expect.any(Number));
    expect(site.radioLocation.longitude).toEqual(expect.any(Number));
    expect(project.activity[0].title).toBe('Radio location placed on map');

    await preview.getByRole('button', { name: 'View map scope' }).click();
    const mapScope = page.getByRole('region', { name: 'Map scope and scene' });
    const cityField = mapScope.getByLabel('City / location');
    await cityField.fill('Seoul Central');
    await cityField.blur();
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`)).json()
      .then(data => data.workspace.projects[0].project.map.city)).toBe('Seoul Central');
    const geojson = JSON.stringify({ type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'Parity Block', properties: { levels: 5 },
      geometry: { type: 'Polygon', coordinates: [[[126.97, 37.55], [126.98, 37.55],
        [126.98, 37.56], [126.97, 37.56], [126.97, 37.55]]] },
    }] });
    await mapScope.locator('input[type="file"]').setInputFiles({ name: 'parity.geojson', mimeType: 'application/geo+json', buffer: Buffer.from(geojson) });
    await expect(mapScope.getByText('parity.geojson', { exact: true })).toBeVisible();
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`)).json()
      .then(data => data.workspace.projects[0].project.map.scene?.footprints?.length)).toBe(1);
    await mapScope.getByRole('button', { name: 'Fit map scope to geometry' }).click();
    await expect.poll(async () => (await fetch(`${origin}/api/workspace`)).json()
      .then(data => data.workspace.projects[0].activity[0]?.title)).toBe('Map fitted to geometry');
    const fittedMap = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace.projects[0].project.map;
    expect(fittedMap).toMatchObject({ city: 'Seoul Central', sceneFile: 'parity.geojson', source: 'GeoJSON' });
    expect(fittedMap.radiusMeters).toBeGreaterThanOrEqual(100);
    expect(fittedMap.radiusMeters).toBeLessThanOrEqual(20000);
    await page.getByRole('button', { name: 'Project 3D' }).click();
    await expect(page.getByRole('region', { name: 'Project 3D view' })).toBeVisible();
    const mapHost = page.getByRole('region', { name: 'Project 3D view' }).locator('.open-rf-host');
    await expect.poll(async () => Number(await mapHost.getAttribute('data-map-pitch'))).toBeCloseTo(52, 6);
    const originalBearing = Number(await mapHost.getAttribute('data-map-bearing'));
    await page.getByRole('group', { name: 'Map camera controls' }).getByRole('button', { name: 'Rotate left' }).click();
    await expect.poll(async () => (Number(await mapHost.getAttribute('data-map-bearing')) + 360) % 360)
      .toBeCloseTo((originalBearing + 345) % 360, 6);
    await page.getByRole('button', { name: '2D map' }).click();

    await page.reload();
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await openLegacyRadio(page);
    const reloadedPreview = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await reloadedPreview.getByRole('button', { name: /SITE-02/ }).click();
    await expect(reloadedPreview.getByText(/Schematic-map estimate/)).toBeVisible();
    await reloadedPreview.getByRole('button', { name: 'View map scope' }).click();
    await expect(page.getByRole('region', { name: 'Map scope and scene' }).getByText('parity.geojson', { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto(`${origin}/`);
    await openLegacyRadio(page);
    await clickWorkspaceButton(page, 'City map');
    await expect(page.getByRole('button', { name: 'Fit map scope to geometry' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Map scope and scene' })).toContainText('parity.geojson');
    await openLegacyRadio(page);
    const rootRadio = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await rootRadio.locator('[data-radio-site="SITE-02"]').click();
    await expect(rootRadio.getByText(/Schematic-map estimate/)).toBeVisible();
    await expect(rootRadio.locator('[data-radio-location="SITE-02"][data-prop="latitude"]')).not.toHaveValue('');
    await expect(rootRadio.locator('[data-radio-location="SITE-02"][data-prop="longitude"]')).not.toHaveValue('');
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    expect(errors).toEqual([]);
  } finally {
    if (server) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('canonical Sites and Cells and Radio bookmarks persist site, sector and RF changes in SQLite', async ({ page }, testInfo) => {
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-site-planner-sqlite-'));
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
    const persisted = async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace.projects[0];

    await page.goto(`${origin}/frontend-preview.html`);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, 'Sites and Cells');
    const planner = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await expect(planner.getByLabel('Site name', { exact: true })).toHaveValue('Civic Square');

    await planner.getByRole('button', { name: 'Select River Bridge site SITE-02' }).click();
    await planner.getByRole('tab', { name: /SITE-02-C2/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(planner.getByRole('tab', { name: /SITE-02-C3/ })).toHaveAttribute('aria-selected', 'true');
    await planner.getByRole('tab', { name: /SITE-02-C2/ }).click();
    await planner.getByRole('tab', { name: 'Antenna', exact: true }).click();
    const azimuth = planner.getByLabel('Azimuth (°)');
    await azimuth.fill('221');
    await azimuth.press('Tab');
    await expect.poll(async () => (await persisted()).project.sites[1].cells[1].azimuthDeg).toBe(221);
    await expect.poll(async () => (await persisted()).activity?.[0]?.title).toBe('Cell setting changed');

    await planner.getByRole('tab', { name: 'Summary', exact: true }).click();
    const siteName = planner.getByLabel('Site name', { exact: true });
    await siteName.fill('River Park');
    await expect(siteName).toHaveValue('River Park');
    await siteName.blur();
    await expect.poll(async () => (await persisted()).project.sites[1].name).toBe('River Park');
    await planner.getByRole('tab', { name: 'Position', exact: true }).click();
    const mapX = planner.getByLabel('Map X position (%)');
    await planner.getByText('Project scope position', { exact: true }).click();
    await mapX.fill('40');
    await mapX.blur();
    await expect.poll(async () => (await persisted()).project.sites[1]).toMatchObject({
      name: 'River Park', x: 40, radioLocation: { source: 'map-estimate' },
    });

    const add = page.getByRole('form', { name: 'Add planned site' });
    await add.getByLabel('New site name').fill('North Tower');
    await add.getByLabel('New site X position (%)').fill('43');
    await add.getByLabel('New site Y position (%)').fill('49');
    await add.getByRole('button', { name: 'Add site' }).click();
    await expect.poll(async () => (await persisted()).project.sites).toHaveLength(4);
    await expect.poll(async () => (await persisted()).activity?.[0]?.title).toBe('Site created');
    expect((await persisted()).project.sites[3]).toMatchObject({ id: 'SITE-04', name: 'North Tower', x: 43, y: 49 });

    await page.setViewportSize({ width: 390, height: 844 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await planner.getByRole('button', { name: '3D scene', exact: true }).click();
    const scene = planner.getByRole('region', { name: 'Three-dimensional project RF scene' });
    await expect(scene.getByRole('status')).toContainText('3D RF scene ready', { timeout: 15000 });
    await expect(planner.getByLabel('Site configuration')).toContainText('Coordinates not set');
    await expect(planner.locator('.rf-map-marker.tx').filter({ hasText: 'SITE-04' })).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await planner.getByRole('button', { name: '2D map', exact: true }).click();
    await expect(scene).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, 'Sites and Cells');
    const reloaded = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await reloaded.getByRole('button', { name: 'Select North Tower site SITE-04' }).click();
    await expect(reloaded.getByLabel('Site name', { exact: true })).toHaveValue('North Tower');

    await page.goto(`${origin}/`);
    await clickWorkspaceButton(page, 'Sites and Cells');
    const rootPlanner = page.getByRole('region', { name: 'Site & cell planner preview route' });
    await rootPlanner.getByRole('button', { name: 'Select North Tower site SITE-04' }).click();
    await expect(rootPlanner.getByLabel('Site name', { exact: true })).toHaveValue('North Tower');
    await rootPlanner.getByRole('button', { name: 'Select River Park site SITE-02' }).click();
    await expect(rootPlanner.getByLabel('Site name', { exact: true })).toHaveValue('River Park');
    await expect.poll(async () => (await (await fetch(origin + '/api/workspace')).json())
      .workspace.projects[0].project.sites.find((site: { id: string }) => site.id === 'SITE-02')
      .cells.find((cell: { id: string }) => cell.id === 'SITE-02-C2').azimuthDeg).toBe(221);
    await page.goto(`${origin}/?workspace=radio`);
    const compatibility = page.getByRole('region', { name: 'Radio planner preview route' });
    await expect(compatibility.getByRole('heading', { name: 'Sites and Cells', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: 'Radio planner', exact: true })).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('Sites and Cells');
    await expect(compatibility.getByRole('tab', { name: 'RF', exact: true })).toHaveAttribute('aria-selected', 'true');
    await compatibility.getByRole('button', { name: 'Select River Park site SITE-02' }).click();
    await compatibility.getByRole('tab', { name: /SITE-02-C2/ }).click();
    const ruModel = compatibility.getByLabel('RU model / part number');
    await ruModel.fill('Reviewed RU reference'); await ruModel.blur();
    await expect.poll(async () => (await persisted()).project.sites[1].radio.ruModel).toBe('Reviewed RU reference');
    const rf = compatibility.getByRole('tab', { name: 'RF', exact: true });
    await rf.focus(); await page.keyboard.press('ArrowRight');
    await expect(compatibility.getByRole('tab', { name: 'Antenna', exact: true })).toBeFocused();
    await expect(compatibility.getByRole('tab', { name: /SITE-02-C2/ })).toHaveAttribute('aria-selected', 'true');
    await compatibility.getByLabel('RF front end').selectOption('MMU');
    await expect.poll(async () => (await persisted()).project.sites[1].frontEnd).toBe('MMU');
    const elements = compatibility.getByLabel('Array elements');
    await elements.fill('0'); await elements.blur();
    await expect(page.getByRole('alert')).toContainText('Input rejected');
    await expect(elements).toHaveValue('');
    await elements.fill('64'); await elements.blur();
    await expect.poll(async () => (await persisted()).project.sites[1].radio.mmuElements).toBe(64);
    await expect(page.getByRole('alert')).toHaveCount(0);
    const sectorAzimuth = compatibility.getByLabel('Azimuth (°)');
    await sectorAzimuth.fill(''); await sectorAzimuth.blur();
    await expect(page.getByRole('alert')).toContainText('requires a number');
    await expect(sectorAzimuth).toHaveValue('221');
    expect((await persisted()).project.sites[1].cells[1].azimuthDeg).toBe(221);
    await sectorAzimuth.fill('0'); await sectorAzimuth.blur();
    await expect.poll(async () => (await persisted()).project.sites[1].cells[1].azimuthDeg).toBe(0);
    await sectorAzimuth.fill('221'); await sectorAzimuth.blur();
    await expect.poll(async () => (await persisted()).project.sites[1].cells[1].azimuthDeg).toBe(221);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await expect.poll(async () => (await elements.boundingBox())?.width ?? 0).toBeGreaterThan(200);
    const sectorList = compatibility.getByRole('tablist', { name: 'River Park sectors' });
    await expect.poll(() => sectorList.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    await compatibility.screenshot({ path: testInfo.outputPath('sites-cells-antenna-desktop.png') });
    await page.setViewportSize({ width: 390, height: 844 });
    await compatibility.screenshot({ path: testInfo.outputPath('sites-cells-antenna-mobile.png') });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    if (server) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});
