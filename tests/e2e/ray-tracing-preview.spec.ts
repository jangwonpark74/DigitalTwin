import { clickWorkspaceButton } from './navigation';
import { expect, test } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../src/api/schemas';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

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

async function startServer(root: string, databasePath: string): Promise<{ process: ChildProcess; origin: string }> {
  const origin = `http://127.0.0.1:${await freePort()}`;
  const child = spawnPython(['serve.py', '--host', '127.0.0.1', '--port', new URL(origin).port], {
    cwd: root, env: { ...process.env, ATLAS_DB_PATH: databasePath }, stdio: 'ignore',
  });
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Python server exited early (${child.exitCode})`);
    try { if ((await fetch(`${origin}/api/workspace`)).ok) return { process: child, origin }; } catch { /* Listener starting. */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  child.kill('SIGTERM');
  throw new Error('Disposable Python server did not start');
}

async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGTERM');
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([exited, new Promise(resolve => { timer = setTimeout(resolve, 3000); })]);
  clearTimeout(timer!);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

test('Ray tracing React route reports unavailable runtime and blocks jobs without geometry', async ({ page }) => {
  const projectId = '11111111-1111-4111-8111-111111111111';
  const workspace = createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  let revision = 2;
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision, workspace }) });
      return;
    }
    const payload = route.request().postDataJSON() as { revision: number; workspace: WorkspaceSnapshot };
    if (payload.revision !== revision) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Workspace changed' }) });
      return;
    }
    revision++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision }) });
  });
  await page.route('**/api/rt/capability', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ available: false, platform: 'Darwin', message: 'No compatible Sionna-RT runtime is configured.' }) }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Ray tracing lab');
  const route = page.getByRole('region', { name: 'Ray tracing lab preview route' });
  await expect(route.getByRole('alert')).toContainText('No compatible Sionna-RT runtime');
  await expect(route.getByText('Load valid GeoJSON footprints in the map before running Sionna-RT.')).toBeVisible();
  await expect(route.getByRole('button', { name: 'Run Sionna-RT paths' })).toBeDisabled();
  expect(errors).toEqual([]);
});

test('Ray tracing React route saves imported paths as unverified and exports their JSON', async ({ page }) => {
  const projectId = '33333333-3333-4333-8333-333333333333';
  const created = createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const database = { revision: 4, workspace: created };
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(database) });
      return;
    }
    const payload = route.request().postDataJSON() as { revision: number; workspace: WorkspaceSnapshot };
    if (payload.revision !== database.revision) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Workspace changed' }) });
      return;
    }
    database.workspace = payload.workspace;
    database.revision++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: database.revision }) });
  });
  await page.route('**/api/rt/capability', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ available: false, platform: 'Darwin', message: 'No local RT runtime' }) }));

  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Ray tracing lab');
  const rays = { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'imported-e2e',
    solver: 'external solver', totalPaths: 1, paths: [{ id: 'path-e2e', pathLossDb: 77,
      points: [{ latitude: 37.5665, longitude: 126.978, heightM: 22 }, { latitude: 37.5667, longitude: 126.9782, heightM: 2 }] }] };
  await page.getByLabel('Import ray path JSON').setInputFiles({ name: 'ray-paths.json', mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(rays)) });
  const route = page.getByRole('region', { name: 'Ray tracing lab preview route' });
  await expect(route.getByText('Imported · unverified')).toBeVisible();
  await expect.poll(() => (database.workspace.projects[0].project.rayResults as { provenance?: string } | null)?.provenance)
    .toBe('imported-unverified');
  expect(database.workspace.projects[0].activity[0].title).toBe('Ray paths imported');
  const downloadPromise = page.waitForEvent('download');
  await route.getByRole('button', { name: 'Download ray results' }).click();
  expect((await downloadPromise).suggestedFilename()).toBe('atlas-ray-paths.json');
});

test('Ray path artifacts survive a Python server restart in disposable SQLite', async ({ page }) => {
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-ray-sqlite-'));
  const databasePath = join(temporary, 'workspace.sqlite3');
  let server: ChildProcess | null = null;
  try {
    runToolSync('vite', ['build'], { cwd: root, stdio: 'ignore' });
    let started = await startServer(root, databasePath);
    server = started.process;
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const paths = { schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326', runId: 'sqlite-ray',
      solver: 'external solver', totalPaths: 1, paths: [{ id: 'sqlite-path', pathLossDb: 64,
        points: [{ latitude: 37.5665, longitude: 126.978, heightM: 30 }, { latitude: 37.5667, longitude: 126.9782, heightM: 2 }] }] };

    await page.goto(`${started.origin}/frontend-preview.html`);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, 'Ray tracing lab');
    await expect.poll(async () => Boolean((await (await fetch(`${started.origin}/api/workspace`)).json() as { workspace?: WorkspaceSnapshot }).workspace))
      .toBe(true);
    const initial = await (await fetch(`${started.origin}/api/workspace`)).json() as { workspace: WorkspaceSnapshot };
    const projectId = initial.workspace.activeProjectId;
    const preview = page.getByRole('region', { name: 'Ray tracing lab preview route' });
    await preview.getByLabel('Import ray path JSON').setInputFiles({ name: 'sqlite-rays.json', mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(paths)) });
    await expect(preview.getByText('Imported · unverified')).toBeVisible();
    const persisted = await (await fetch(`${started.origin}/api/workspace`)).json() as { workspace: WorkspaceSnapshot };
    expect(persisted.workspace.projects.find(item => item.id === projectId)!.project.rayResults)
      .toMatchObject({ provenance: 'imported-unverified', runId: 'sqlite-ray', paths: [{ id: 'sqlite-path' }] });
    const gpsCsv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,NR,SITE-01-C1,37.566,126.978,-90,-9,18,120,30\n1,LTE,SITE-01-C1,37.566,126.9781,-115,-16,-2,3,1';
    await preview.getByLabel('Import drive test CSV', { exact: true }).setInputFiles({ name: 'sqlite-drive.csv', mimeType: 'text/csv', buffer: Buffer.from(gpsCsv) });
    await page.getByRole('button', { name: 'Validate and preview' }).click();
    await expect(page.getByRole('region', { name: 'Import quality preview' })).toBeVisible();
    await page.getByRole('button', { name: 'Save GPS dataset' }).click();
    await expect(preview.getByText(/sqlite-drive.csv · 2\/2 GPS samples/)).toBeVisible();
    await expect.poll(async () => (await (await fetch(`${started.origin}/api/workspace`)).json()).workspace?.projects[0].project.driveMeasurements?.samples[1].sinrDb).toBe(-2);
    const artifactResponse = await fetch(`${started.origin}/api/projects/${projectId}/artifacts?content=1`);
    expect(artifactResponse.ok).toBe(true);
    const artifacts = await artifactResponse.json() as { artifacts: { id: string; content?: string }[] };
    expect(JSON.parse(artifacts.artifacts.find(file => file.id === 'ray-paths')!.content!).provenance).toBe('imported-unverified');

    await stopServer(server);
    server = null;
    started = await startServer(root, databasePath);
    server = started.process;
    await page.goto(`${started.origin}/frontend-preview.html`);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, 'Ray tracing lab');
    const reloaded = page.getByRole('region', { name: 'Ray tracing lab preview route' });
    await expect(reloaded.getByText('Imported · unverified')).toBeVisible();
    await expect(reloaded.getByText('sqlite-path · 64 dB · 2 points')).toBeVisible();
    await expect(reloaded.getByText(/sqlite-drive.csv · 2\/2 GPS samples/)).toBeVisible();
    await reloaded.getByRole('group', { name: 'Drive test KPI' }).getByRole('button', { name: 'SINR dB', exact: true }).click();
    await expect(reloaded.getByLabel('Selected drive sample')).toContainText('SINR · good');
    const afterRestart = await (await fetch(`${started.origin}/api/projects/${projectId}/artifacts?content=1`)).json() as { artifacts: { id: string; content?: string }[] };
    expect(JSON.parse(afterRestart.artifacts.find(file => file.id === 'ray-paths')!.content!).provenance).toBe('imported-unverified');
    expect(errors).toEqual([]);
  } finally {
    if (server) await stopServer(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('open 3D 5G lab renders project paths and placement without a solver', async ({ page }, testInfo) => {
  const { defaultProject } = await import('../../model.mjs');
  const { parseGeoJsonScene } = await import('../../scene.mjs');
  const project = defaultProject();
  project.map.latitude = 37.5663; project.map.longitude = 126.978; project.map.radiusMeters = 400;
  const building = (id: string, west: number, south: number, east: number, north: number, height: number) => ({
    type: 'Feature', id, properties: { height }, geometry: { type: 'Polygon', coordinates: [
      [[west, south], [east, south], [east, north], [west, north], [west, south]],
    ] },
  });
  Object.assign(project.map, { scene: parseGeoJsonScene({ type: 'FeatureCollection', features: [
    building('north-office', 126.9769, 37.5666, 126.9791, 37.567, 45),
    building('east-tower', 126.9794, 37.5657, 126.9798, 37.5664, 60),
    building('west-block', 126.9763, 37.5657, 126.9767, 37.5664, 24),
  ] }) });
  Object.assign(project.sites[0].radioLocation, { latitude: 37.5660, longitude: 126.9775, source: 'manual' });
  const workspace = createWorkspaceState(project, { id: '12345678-1111-4111-8111-111111111111' }) as WorkspaceSnapshot;
  let revision = 1;
  const requests: string[] = [];
  const errors: string[] = [];
  let writes = 0;
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(request.url()));
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ workspace, revision }) });
    const payload = route.request().postDataJSON();
    Object.assign(workspace, payload.workspace); revision++; writes++;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision }) });
  });
  await page.route('**/api/rt/capability', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ available: false, platform: 'Darwin', message: 'No local RT runtime' }) }));
  await page.setViewportSize({ width: 1600, height: 1150 });
  await page.goto('/');
  await clickWorkspaceButton(page, 'Ray tracing lab');
  const lab = page.getByRole('region', { name: 'Ray tracing lab preview route' });
  await expect(lab.locator('.open-rf-host canvas')).toBeVisible();
  await lab.getByLabel('Receiver latitude', { exact: true }).fill('37.5662');
  await lab.getByLabel('Receiver longitude', { exact: true }).fill('126.9785');
  await expect(lab.getByRole('complementary', { name: 'Beam steering controls' })).toHaveCount(0);
  const mapSize = await lab.locator('.open-rf-host').boundingBox();
  expect(mapSize!.width).toBeGreaterThan(1000);
  expect(mapSize!.height).toBeGreaterThanOrEqual(680);
  await lab.getByRole('button', { name: 'Trace geometric paths' }).click();
  await expect(lab.getByRole('list', { name: 'Geometric paths' })).toContainText('LOS');
  await expect(lab.getByRole('list', { name: 'Geometric paths' })).toContainText('REFLECTION');
  await lab.getByRole('list', { name: 'Geometric paths' }).getByRole('button').first().click();
  await expect(lab.getByRole('heading', { name: 'preview-los' })).toBeVisible();
  await lab.getByLabel('Frequency (GHz)', { exact: true }).fill('26');
  await expect(lab.getByLabel('Frequency (GHz)', { exact: true })).toHaveValue('26');
  await expect(lab.getByRole('button', { name: 'Run Sionna-RT paths' })).toBeDisabled();
  // Public context tiles may load independently; imported geometry and paths
  // must render without depending on the tile source or on a solver runtime.
  await expect(lab.locator('.rf-map-marker.tx').first()).toBeVisible();
  const transmitter = lab.locator('.base-station-marker[data-station-id="SITE-01"]');
  await expect(transmitter).toHaveAttribute('data-height-m', '28');
  await expect(transmitter).toContainText('28 m');
  await expect.poll(() => transmitter.evaluate(element => Number((element as HTMLElement).dataset.groundY) -
    Number((element as HTMLElement).dataset.tipY))).toBeGreaterThan(8);
  await expect(lab.locator('.rf-map-marker.rx')).toBeVisible();
  await expect(lab.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30000 });
  const driveCsv = ['time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event',
    ...Array.from({ length: 61 }, (_, index) => `${index},${index < 40 ? 'NR' : 'LTE'},SITE-01-C1,37.5661,${126.977 + index * .00007},${[-91, -103, -119][Math.floor(index / 10) % 3]},-12,${[19, 7, -3][Math.floor(index / 10) % 3]},80,15,UI-test-fixture`),
  ].join('\n');
  await lab.getByLabel('Import drive test CSV', { exact: true }).setInputFiles({ name: 'gps-kpi-fixture.csv', mimeType: 'text/csv', buffer: Buffer.from(driveCsv) });
  await page.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(page.getByRole('region', { name: 'Import quality preview' })).toBeVisible();
  await page.getByRole('button', { name: 'Save GPS dataset' }).click();
  await expect(lab.getByText(/gps-kpi-fixture.csv · 61\/61 GPS samples/)).toBeVisible();
  await expect.poll(() => writes).toBe(1);
  await lab.getByRole('button', { name: 'Fit drive route', exact: true }).click();
  await lab.locator('.open-rf-host canvas').scrollIntoViewIfNeeded();
  // Inspect rendered WebGL pixels, so a missing MapLibre KPI layer cannot pass as UI-only success.
  const pixels = () => lab.locator('.open-rf-host canvas').evaluate(canvas => {
    const source = canvas as HTMLCanvasElement;
    const copy = document.createElement('canvas'); copy.width = source.width; copy.height = source.height;
    const context = copy.getContext('2d')!; context.drawImage(source, 0, 0);
    const data = context.getImageData(0, 0, copy.width, copy.height).data;
    const counts = { good: 0, fair: 0, poor: 0 }; let poorPoint: { x: number; y: number } | null = null;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] === 21 && data[i + 1] === 149 && data[i + 2] === 111) counts.good++;
      if (data[i] === 230 && data[i + 1] === 171 && data[i + 2] === 40) counts.fair++;
      if (data[i] === 220 && data[i + 1] === 82 && data[i + 2] === 97) {
        counts.poor++;
        // Choose a solid interior pixel, rather than the antialiased edge of a pitched circle.
        const interior = [-4, 4, -copy.width * 4, copy.width * 4].every(offset => data[i + offset] === 220 && data[i + offset + 1] === 82 && data[i + offset + 2] === 97);
        if (interior) poorPoint ??= { x: (i / 4 % copy.width) * source.clientWidth / copy.width, y: Math.floor(i / 4 / copy.width) * source.clientHeight / copy.height };
      }
    }
    return { ...counts, poorPoint };
  });
  await expect.poll(async () => { const data = await pixels(); return data.good > 10 && data.fair > 10 && data.poor > 10 && !!data.poorPoint; }).toBe(true);
  const point = (await pixels()).poorPoint!;
  await lab.locator('.open-rf-host canvas').click({ position: point });
  await expect(lab.getByLabel('Selected drive sample')).toContainText('RSRP · poor');
  await lab.getByRole('group', { name: 'Drive test KPI' }).getByRole('button', { name: 'SINR dB', exact: true }).click();
  await expect(lab.getByLabel('SINR color thresholds')).toContainText('Good ≥ 13 dB');
  await expect(lab.getByLabel('Selected drive sample')).toContainText('SINR · poor');
  await lab.getByLabel('Drive test technology').selectOption('LTE');
  await expect(lab.getByText(/gps-kpi-fixture.csv · 21\/61 GPS samples/)).toBeVisible();
  await lab.getByLabel('Drive test technology').selectOption('ALL');
  await lab.getByRole('group', { name: 'Drive test KPI' }).getByRole('button', { name: 'RSRP dBm', exact: true }).click();
  await lab.getByLabel('Drive test overlay').uncheck();
  await expect.poll(async () => (await pixels()).poor).toBe(0);
  await lab.getByLabel('Drive test overlay').check();
  await expect.poll(async () => (await pixels()).poor).toBeGreaterThan(10);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath('5g-propagation-desktop.png'), fullPage: true });
  await lab.getByLabel('Open map context', { exact: true }).uncheck();
  await expect(lab.getByRole('list', { name: 'Geometric paths' })).toBeVisible();
  await lab.getByRole('button', { name: 'Place receiver', exact: true }).click();
  const map = lab.locator('.open-rf-host canvas');
  await map.click({ position: { x: 280, y: 320 } });
  await expect(lab.getByRole('button', { name: 'Place receiver', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(lab.getByLabel('Receiver latitude', { exact: true })).not.toHaveValue('37.5662');
  expect(writes).toBe(1);
  await lab.getByRole('button', { name: 'Place transmitter', exact: true }).click();
  await map.click({ position: { x: 250, y: 330 } });
  await expect.poll(() => writes).toBe(2);
  expect((workspace.projects[0].project.sites as { radioLocation: unknown }[])[0]).toMatchObject({ radioLocation: { source: 'manual' } });
  await page.setViewportSize({ width: 390, height: 844 });
  await lab.getByLabel('Open map context', { exact: true }).check();
  await lab.getByRole('button', { name: 'Fit drive route', exact: true }).click();
  await expect(lab.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30000 });
  expect((await lab.locator('.open-rf-host').boundingBox())!.height).toBeGreaterThanOrEqual(520);
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.evaluate(() => { if (document.activeElement instanceof HTMLElement) document.activeElement.blur(); });
  await page.mouse.move(0, 0);
  await page.screenshot({ path: testInfo.outputPath('5g-propagation-mobile.png'), fullPage: true });
  await page.setViewportSize({ width: 1600, height: 1150 });
  await lab.getByLabel('Open map context', { exact: true }).check();
  await expect(lab.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30000 });
  await lab.getByRole('button', { name: 'Use visible map buildings' }).click();
  await expect.poll(() => writes).toBe(3);
  const adopted = workspace.projects[0].project.map as { scene: { footprints: unknown[]; assumedHeightCount: number; fileName: string }; geometryValidated: boolean; materialAssigned: boolean };
  expect(adopted.scene.footprints.length).toBeGreaterThan(0);
  expect(adopted.scene.assumedHeightCount).toBe(adopted.scene.footprints.length);
  expect(adopted.scene.fileName).toBe('open-map-visible-uncalibrated.geojson');
  expect(adopted.geometryValidated).toBe(false);
  expect(adopted.materialAssigned).toBe(false);
  expect(workspace.projects[0].project.rayResults).toBeNull();
  expect(requests.some(url => /cesium|ion\.cesium/i.test(url))).toBe(false);
  expect(errors).toEqual([]);
});
