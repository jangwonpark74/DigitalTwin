import { expect, test } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';
import { clickWorkspaceButton } from './navigation';

test('KPI trend labels its metric and exact axes and starts at the left on wide and mobile screens', async ({ page }) => {
  const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z' });
  await page.route('**/api/workspace', route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ revision: 2, workspace }) }));
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 2560, height: 1000 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Virtual drive test');
  const chart = page.locator('.dm-trend');
  const svg = chart.locator('svg');
  await expect(chart.getByText('KPI category · Signal power')).toBeVisible();
  await expect(svg).toHaveAccessibleName(/RSRP \/ SS-RSRP trend by sample number, scale -\d+ to -\d+ dBm/);
  await expect(chart.locator('.dm-trend-x-ticks text').first()).toHaveText('1');
  await expect(chart.locator('.dm-trend-x-ticks text').last()).toHaveText('48');
  await expect(svg).toHaveAttribute('preserveAspectRatio', 'xMinYMid meet');
  const inset = await svg.evaluate(element => {
    const observation = element.querySelector('circle')!;
    return observation.getBoundingClientRect().left - element.getBoundingClientRect().left;
  });
  expect(inset).toBeLessThan(80);
  await chart.screenshot({ path: 'docs/design-review/kpi-trend/rsrp-wide.png' });
  for (const [metric, category, unit] of [['rsrq', 'Signal quality', 'dB'], ['sinr', 'Signal quality', 'dB'],
    ['dl', 'Downlink throughput', 'Mbps'], ['ul', 'Uplink throughput', 'Mbps']]) {
    await page.getByRole('combobox', { name: 'Color route by' }).selectOption(metric);
    await expect(chart.getByText(`KPI category · ${category}`)).toBeVisible();
    await expect(chart.getByText(new RegExp(`Scale .+ ${unit} · .+ ${unit} / division`))).toBeVisible();
    const ticks = (await chart.locator('.dm-trend-y-ticks text').allTextContents()).map(Number);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    for (let index = 2; index < ticks.length; index++) expect(ticks[index] - ticks[index - 1]).toBe(ticks[1] - ticks[0]);
    if (unit === 'Mbps') expect(ticks[0]).toBe(0);
  }
  await page.getByRole('combobox', { name: 'Color route by' }).selectOption('sinr');
  await chart.screenshot({ path: 'docs/design-review/kpi-trend/sinr-wide.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(chart.getByText('KPI category · Signal quality')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(await chart.evaluate(element => element.scrollWidth > element.clientWidth)).toBe(true);
  await chart.screenshot({ path: 'docs/design-review/kpi-trend/sinr-mobile.png' });
  expect(errors).toEqual([]);
});
