import { clickWorkspaceButton, openMobileNavigation } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Both parity flows build the same dist tree; run them serially within this file.
test.describe.configure({ mode: 'serial', timeout: 60_000 });

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
async function openLegacyDrive(page: Page) {
  await openMobileNavigation(page);
  const navigation = page.getByRole('button', { name: 'Virtual drive test' });
  const group = page.getByRole('button', { name: 'USE CASES' });
  await expect(group).toBeVisible();
  if (!(await navigation.isVisible())) await group.click();
  await navigation.click();
}
async function openLegacyHardware(page: Page) {
  await openMobileNavigation(page);
  const navigation = page.getByRole('button', { name: 'Hardware inventory' });
  const group = page.getByRole('button', { name: 'SYSTEM' });
  await expect(group).toBeVisible();
  if (!(await navigation.isVisible())) await group.click();
  await navigation.click();
}

async function loadLegacyRoot(page: Page, origin: string, preview = false) {
  const url = `${origin}/${preview ? 'frontend-preview.html' : ''}`;
  const ready = preview ? page.getByRole('button', { name: 'Preview activity route' })
    : page.getByRole('navigation', { name: 'Application workspaces' });
  await page.goto(url, { waitUntil: 'networkidle' });
  await expect(ready).toBeVisible();
}

test('built Drive preview and React root share one disposable SQLite project and export contracts', async ({ page }) => {
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-drive-sqlite-'));
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
    await loadLegacyRoot(page, origin, true);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, /USE CASES/i);
    await clickWorkspaceButton(page, 'Virtual drive test');
    const preview = page.getByRole('region', { name: 'Drive preview route' });
    await expect(preview.getByText('SYNTHETIC DEMO · NOT MEASURED')).toBeVisible();
    await preview.getByRole('tab', { name: 'Route & simulation plan' }).click();
    const samples = preview.getByRole('spinbutton', { name: 'Samples along route' });
    await samples.fill('32');
    await samples.press('Tab');
    await expect(samples).toHaveValue('32');
    await expect.poll(async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace?.projects[0]?.project?.useCases?.drive?.samples).toBe(32);
    const previewDownload = page.waitForEvent('download');
    await preview.getByRole('button', { name: /Export drive job plan/ }).click();
    const previewPlan = JSON.parse(await readFile(await (await previewDownload).path(), 'utf8'));
    expect(previewPlan).toMatchObject({ mode: 'PLANNING_ONLY', useCase: 'drive', config: { samples: 32 } });
    await expect.poll(async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace?.projects[0]?.activity[0]?.title).toBe('Use-case plan exported');
    await preview.getByRole('tab', { name: '4G/5G DM analysis' }).click();
    await preview.getByRole('combobox', { name: 'Radio access' }).selectOption('NR');
    await preview.getByRole('combobox', { name: 'Color route by' }).selectOption('sinr');
    const previewAnalysisDownload = page.waitForEvent('download');
    await preview.getByRole('button', { name: /Analysis JSON/ }).click();
    const previewAnalysis = JSON.parse(await readFile(await (await previewAnalysisDownload).path(), 'utf8'));
    expect(previewAnalysis).toMatchObject({ source: 'synthetic-demo', provenance: 'illustrative-not-measured',
      filters: { technology: 'NR', metric: 'sinr' } });
    expect(previewAnalysis.samples).toBeUndefined();
    const csv = `time_s,technology,serving_cell,x_pct,y_pct,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event
0,LTE,SITE-01-C1,10,20,-90,-9,17,35,8,
1,NR,SITE-02-C1,20,25,-115,-16,-2,3,1,handover
`;
    await preview.locator('#dm-csv').setInputFiles({ name: 'field.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await expect(preview.getByText('IMPORTED CSV · UNVERIFIED')).toBeVisible();
    await expect.poll(async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace?.projects[0]?.activity[0]?.title).toBe('DM trace imported');
    const persisted = (await (await fetch(`${origin}/api/workspace`)).json()).workspace.projects[0].project;
    expect(persisted.useCases.drive.trace).toBeUndefined();

    await loadLegacyRoot(page, origin);
    await openLegacyDrive(page);
    await expect(page.getByText('SYNTHETIC DEMO · NOT MEASURED')).toBeVisible();
    await page.locator('[data-drive-tab="plan"]').click();
    await expect(page.locator('[data-uc-field="drive.samples"]')).toHaveValue('32');
    const legacyDownload = page.waitForEvent('download');
    await page.getByRole('button', { name: /Export drive job plan/ }).click();
    const legacyPlan = JSON.parse(await readFile(await (await legacyDownload).path(), 'utf8'));
    expect(legacyPlan).toEqual(previewPlan);
    await page.locator('[data-drive-tab="analysis"]').click();
    await expect(page.getByText('NO ACCEPTANCE VERDICT')).toBeVisible();
    await page.locator('#dm-technology').selectOption('NR');
    await page.locator('#dm-metric').selectOption('sinr');
    const legacyAnalysisDownload = page.waitForEvent('download');
    await page.locator('#dm-export').click();
    const legacyAnalysis = JSON.parse(await readFile(await (await legacyAnalysisDownload).path(), 'utf8'));
    expect(legacyAnalysis).toEqual(previewAnalysis);
    await expect.poll(async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace?.projects[0]?.activity[0]?.title)
      .toBe('DM analysis exported');
    await loadLegacyRoot(page, origin);
    await openLegacyDrive(page);
    await page.locator('[data-drive-tab="plan"]').click();
    await expect(page.locator('[data-uc-field="drive.samples"]')).toHaveValue('32');
    expect(errors).toEqual([]);
  } finally {
    if (server) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});

test('built Hardware preview and React root share validated plans in disposable SQLite', async ({ page }) => {
  const root = process.cwd();
  const scratch = process.env.ATLAS_TEST_TMPDIR ?? join(root, 'test-results');
  await mkdir(scratch, { recursive: true });
  const temporary = await mkdtemp(join(scratch, 'atlas-hardware-sqlite-'));
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
    const persisted = async () => (await (await fetch(`${origin}/api/workspace`)).json()).workspace?.projects[0];

    await loadLegacyRoot(page, origin, true);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, /SYSTEM/i);
    await clickWorkspaceButton(page, 'Hardware inventory');
    const preview = page.getByRole('region', { name: 'Hardware preview route' });
    await expect(preview.getByText('No live hardware connected')).toBeVisible();
    await preview.getByRole('tab', { name: 'Capacity & registry' }).click();
    const poolAlias = preview.locator('[data-pool-alias="GH-POOL-02"]');
    await poolAlias.fill('Lab GH200 pool');
    await poolAlias.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.topology?.gh200Pools?.[1]?.alias).toBe('Lab GH200 pool');
    const poolCount = preview.locator('[data-pool-count="GH-POOL-02"]');
    await poolCount.fill('3');
    await poolCount.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.topology?.gh200Pools?.[1]?.plannedServers).toBe(3);
    const vdu = preview.locator('[data-hw-count="vdu"]');
    await vdu.fill('2');
    await vdu.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.topology?.vduServerCount).toBe(2);
    const switchPorts = preview.locator('[data-hw-count="switch"]');
    await switchPorts.fill('48');
    await switchPorts.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.topology?.switchPortCount).toBe(48);
    await preview.locator('.hwx-registry summary').click();
    const hardwareAlias = preview.locator('[data-hw-alias="vdu-pool"]');
    await hardwareAlias.fill('Lab vDU target');
    await hardwareAlias.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.hardware?.[0]?.alias).toBe('Lab vDU target');
    await expect.poll(async () => (await persisted())?.activity?.[0]?.title).toBe('Hardware target renamed');
    const management = (await persisted())?.project?.management;
    expect(management?.topology?.links.every((link: { status: string }) => link.status === 'unverified')).toBe(true);
    expect(management?.topology?.gh200Pools.every((pool: { discovery: string }) => pool.discovery === 'not-discovered')).toBe(true);
    expect(management?.hardware.every((asset: { discovery: string }) => asset.discovery === 'not-discovered')).toBe(true);

    await loadLegacyRoot(page, origin);
    await openLegacyHardware(page);
    await expect(page.getByText('No live hardware connected')).toBeVisible();
    await page.locator('#hwx-tab-inventory').click();
    await expect(page.locator('[data-pool-alias="GH-POOL-02"]')).toHaveValue('Lab GH200 pool');
    await expect(page.locator('[data-pool-count="GH-POOL-02"]')).toHaveValue('3');
    await expect(page.locator('[data-hw-count="vdu"]')).toHaveValue('2');
    await expect(page.locator('[data-hw-count="switch"]')).toHaveValue('48');
    await page.locator('.hwx-registry summary').click();
    await expect(page.locator('[data-hw-alias="vdu-pool"]')).toHaveValue('Lab vDU target');
    await expect(page.getByText('0 · NOT DISCOVERED').first()).toBeVisible();
    const legacyCount = page.locator('[data-pool-count="GH-POOL-02"]');
    await legacyCount.fill('4');
    await legacyCount.press('Tab');
    await expect.poll(async () => (await persisted())?.project?.management?.topology?.gh200Pools?.[1]?.plannedServers).toBe(4);
    await expect.poll(async () => (await persisted())?.activity?.[0]?.title).toBe('GH200 pool capacity planned');

    await page.goto(`${origin}/frontend-preview.html`);
    await page.getByRole('button', { name: 'Preview activity route' }).click();
    await clickWorkspaceButton(page, /SYSTEM/i);
    await clickWorkspaceButton(page, 'Hardware inventory');
    await preview.getByRole('tab', { name: 'Capacity & registry' }).click();
    await expect(preview.locator('[data-pool-count="GH-POOL-02"]')).toHaveValue('4');
    await expect(preview.getByText('0 · NOT DISCOVERED').first()).toBeVisible();
    expect(errors).toEqual([]);
  } finally {
    if (server) await stop(server);
    await rm(temporary, { recursive: true, force: true });
  }
});
