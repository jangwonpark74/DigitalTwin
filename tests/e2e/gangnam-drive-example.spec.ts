import { expect, test } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { spawnPython, runToolSync } from '../../scripts/runtime.mjs';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';

test('Gangnam example imports registered SKT positions and renders synthetic street KPIs', async ({ page }) => {
  test.setTimeout(60_000);
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
    await page.getByRole('button', { name: 'Project artifacts', exact: true }).click();
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
    await page.getByRole('button', { name: 'Ray tracing lab', exact: true }).click();
    const lab = page.getByRole('region', { name: 'Ray tracing lab preview route' });
    await expect(lab.getByText(/676\/676 GPS samples/)).toBeVisible();
    await expect(lab.locator('.rf-map-marker.tx')).toHaveCount(9);
    await expect(lab.locator('.rf-source-footer [role=status]')).toContainText('open map context connected', { timeout: 30_000 });
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
    await expect(lab.getByText(/676\/676 GPS samples/)).toBeVisible();
    await expect.poll(async () => {
      const workspace = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
      return workspace.projects.find((record: { id: string }) => record.id === workspace.activeProjectId).activity[0]?.title;
    }).toBe('DM trace imported');
    const afterCsv = (await fetch(`${origin}/api/workspace`).then(response => response.json())).workspace;
    const active = afterCsv.projects.find((record: { id: string }) => record.id === afterCsv.activeProjectId).project;
    expect(active.sites).toEqual(imported.sites);
    expect(active.driveMeasurements.samples).toEqual(manifest.driveMeasurements.samples);
    expect(errors).toEqual([]);
  } finally {
    if (server && server.exitCode === null && server.signalCode === null) {
      const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped;
    }
    await rm(temporary, { recursive: true, force: true });
  }
});
