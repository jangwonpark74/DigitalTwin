import { expect, test } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';
import { clickWorkspaceButton } from './navigation';

test('records React route, typing, OpenMap and repeated-navigation performance on one fixture', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1280, height: 577 });
  const workspace = createWorkspaceState(undefined, {
    id: '11111111-1111-4111-8111-111111111111', now: () => '2026-09-01T00:00:00.000Z',
  });
  let revision = 1;
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision, workspace }) });
      return;
    }
    revision += 1;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision }) });
  });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Application workspaces' });
  const routeMs: number[] = [];
  const changeRoute = async (name: string, ready: () => Promise<unknown>) => {
    const started = await page.evaluate(() => performance.now());
    await clickWorkspaceButton(page, name);
    await ready();
    routeMs.push(await page.evaluate(start => performance.now() - start, started));
  };

  await changeRoute('City map', () => expect(page.getByRole('region', { name: 'Radio map preview route' })).toBeVisible());
  const firstOpenMapStarted = await page.evaluate(() => performance.now());
  await page.getByRole('button', { name: 'Project 3D' }).click();
  await expect(page.getByText(/3D RF scene ready/)).toBeVisible();
  const firstOpenMapMs = await page.evaluate(start => performance.now() - start, firstOpenMapStarted);

  await clickWorkspaceButton(page, 'Virtual drive test');
  await expect(page.getByRole('region', { name: 'Drive preview route' })).toBeVisible();
  await page.getByRole('tab', { name: 'Route & simulation plan' }).click();
  const samples = page.getByRole('spinbutton', { name: 'Samples along route' });
  await page.evaluate(() => {
    const field = document.querySelector<HTMLInputElement>('[data-uc-field="drive.samples"]')!;
    field.dataset.typingStarted = String(performance.now());
    field.addEventListener('input', () => requestAnimationFrame(() => {
      field.dataset.typingRendered = String(performance.now());
    }), { once: true });
  });
  await samples.fill('49');
  await expect(samples).toHaveValue('49');
  await expect(samples).toHaveAttribute('data-typing-rendered', /.+/);
  const typingFrameMs = await samples.evaluate(field =>
    Number(field.dataset.typingRendered) - Number(field.dataset.typingStarted));

  await changeRoute('Mission control', () => expect(page.getByRole('heading', { name: '5G RAN twin mission control' })).toBeVisible());
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapUsed = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const result = await cdp.send('Performance.getMetrics');
    return result.metrics.find(metric => metric.name === 'JSHeapUsedSize')?.value ?? null;
  };
  const heapBeforeBytes = await heapUsed();
  const navigationCycles = 5;
  for (let index = 0; index < navigationCycles; index += 1) {
    await changeRoute('City map', () => expect(page.getByRole('region', { name: 'Radio map preview route' })).toBeVisible());
    await page.getByRole('button', { name: 'Project 3D' }).click();
    await expect(page.getByText(/3D RF scene ready/)).toBeVisible();
    await changeRoute('Mission control', () => expect(page.getByRole('heading', { name: '5G RAN twin mission control' })).toBeVisible());
  }
  const heapAfterBytes = await heapUsed();
  await changeRoute('City map', () => expect(page.getByRole('region', { name: 'Radio map preview route' })).toBeVisible());
  await page.getByRole('button', { name: 'Project 3D' }).click();
  await expect(page.getByText(/3D RF scene ready/)).toBeVisible();
  const finalOpenMapViewers = await page.locator('.open-rf-host canvas').count();
  const sortedTransitions = [...routeMs].sort((left, right) => left - right);
  const medianRouteTransitionMs = sortedTransitions[Math.floor(sortedTransitions.length / 2)] ?? 0;
  console.log('FRONTEND_PERF', JSON.stringify({
    browser: 'Playwright Chromium', viewport: '1280x577', fixture: 'default project',
    routeTransitionSamplesMs: routeMs.map(value => Number(value.toFixed(2))),
    medianRouteTransitionMs: Number(medianRouteTransitionMs.toFixed(2)),
    firstOpenMapViewMs: Number(firstOpenMapMs.toFixed(2)),
    typingToNextFrameMs: Number(typingFrameMs.toFixed(2)),
    navigationCycles,
    heapUsedAfterGcBeforeBytes: heapBeforeBytes,
    heapUsedAfterGcAfterBytes: heapAfterBytes,
    heapDeltaBytes: heapBeforeBytes === null || heapAfterBytes === null ? null : heapAfterBytes - heapBeforeBytes,
    finalOpenMapViewers,
  }));
  expect(finalOpenMapViewers).toBe(1);
  expect(errors).toEqual([]);
  await cdp.detach();
});
