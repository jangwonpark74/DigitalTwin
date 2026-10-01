import { expect, test } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/workspace', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ revision: 1, workspace: createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111' }) }) }));
});

test('real Silicon Valley tiles render in 3D; camera, inspection, locations and layers work without project edits', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  const tiles: string[] = [];
  const writes: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.ok() && /tiles\.openfreemap\.org.*\.pbf/.test(response.url()) && !response.url().includes('/fonts/')) tiles.push(response.url());
  });
  page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'City map', exact: true }).click();
  await page.getByRole('button', { name: 'Explore 3D city' }).click();
  const city = page.getByRole('region', { name: 'Silicon Valley open 3D map' });
  await expect(city.getByRole('status')).toHaveText('Open map connected', { timeout: 45_000 });
  expect(tiles.length).toBeGreaterThan(0);
  const canvas = city.locator('canvas');
  const dimensions = await canvas.boundingBox();
  expect(dimensions!.width).toBeGreaterThan(450);
  expect(dimensions!.height).toBeGreaterThan(400);
  await expect(city.getByLabel('Silicon Valley location')).toHaveValue('palo-alto');
  await expect(city.locator('.open-city-stat strong')).not.toHaveText('—');
  await page.screenshot({ path: testInfo.outputPath('palo-alto-3d.png'), fullPage: true });

  // Exercise actual picking against delivered footprints; the sample points
  // cover the central city blocks and avoid map controls and overlays.
  const map = city.locator('.open-city-map');
  let picked = false;
  for (const y of [0.5, 0.6, 0.4]) {
    for (const x of [0.5, 0.4, 0.6, 0.3, 0.7]) {
      await map.click({ position: { x: dimensions!.width * x, y: dimensions!.height * y } });
      if (await city.getByRole('heading', { name: 'Building footprint', exact: true }).count()) { picked = true; break; }
    }
    if (picked) break;
  }
  expect(picked).toBe(true);
  await expect(city.getByText('Rendered height', { exact: true })).toBeVisible();
  await city.getByRole('button', { name: '2D plan' }).click();
  await expect(city.getByRole('button', { name: '2D plan' })).toHaveAttribute('aria-pressed', 'true');
  await city.getByRole('button', { name: '3D perspective' }).click();
  await city.getByLabel('3D buildings', { exact: true }).uncheck();
  await expect(city.getByRole('status')).toHaveText('Building layer hidden');
  await city.getByLabel('3D buildings', { exact: true }).check();
  await expect(city.getByRole('status')).toHaveText('Open map connected');
  for (const id of ['mountain-view', 'san-jose']) {
    await city.getByLabel('Silicon Valley location').selectOption(id);
    await expect(city.getByRole('status')).toHaveText('Open map connected', { timeout: 30_000 });
    await city.getByRole('button', { name: 'Reset city camera' }).click();
    await expect(city.getByRole('status')).toHaveText('Open map connected');
    await page.screenshot({ path: testInfo.outputPath(`${id}-3d.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await city.getByRole('button', { name: 'Reset city camera' }).click();
  await expect(city.getByRole('status')).toHaveText('Open map connected');
  await page.screenshot({ path: testInfo.outputPath('silicon-valley-mobile.png'), fullPage: true });
  await city.getByRole('button', { name: 'Return to radio map' }).click();
  await expect(page.getByRole('region', { name: 'Map scope and scene' })).toBeVisible();
  expect(writes).toEqual([]);
  expect(errors).toEqual([]);
  await testInfo.attach('tile-evidence', { body: JSON.stringify({ successfulGeometryTiles: tiles, projectWrites: writes, errors }, null, 2), contentType: 'application/json' });
});

test('failed open tiles show an actionable error and return path', async ({ page }) => {
  await page.route('https://tiles.openfreemap.org/**', route => route.abort());
  await page.goto('/');
  await page.getByRole('button', { name: 'City map', exact: true }).click();
  await page.getByRole('button', { name: 'Explore 3D city' }).click();
  const city = page.getByRole('region', { name: 'Silicon Valley open 3D map' });
  await expect(city.getByRole('status')).toContainText('could not load', { timeout: 15_000 });
  await expect(city.getByRole('button', { name: 'Retry open map' })).toBeVisible();
  await city.getByRole('button', { name: 'Return to radio map' }).click();
  await expect(page.getByRole('region', { name: 'Map scope and scene' })).toBeVisible();
});

test('mobile navigation opens, changes workspace and collapses', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Application workspaces' })).toBeHidden();
  await page.getByRole('button', { name: 'Navigation +' }).click();
  await page.getByRole('button', { name: 'City map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'City & network' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Application workspaces' })).toBeHidden();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
