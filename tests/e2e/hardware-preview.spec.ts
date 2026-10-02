import { clickWorkspaceButton, openMobileNavigation } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../src/api/schemas';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
async function stubWorkspace(page: Page, database: { revision: number; workspace: WorkspaceSnapshot }) {
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(database) });
      return;
    }
    const payload = route.request().postDataJSON() as { revision: number; workspace: WorkspaceSnapshot };
    if (payload.revision !== database.revision) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Revision conflict' }) });
      return;
    }
    database.workspace = payload.workspace;
    database.revision++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: database.revision }) });
  });
}

test('hardware preview stays planning-only across keyboard selection, scoped edits and narrow layout', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second hardware pilot';
  second.project.name = second.name;
  const database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspace(page, database);
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Hardware inventory');
  const hardware = page.getByRole('region', { name: 'Hardware preview route' });
  await expect(hardware.getByRole('heading', { name: 'Hardware topology & inventory' })).toBeVisible();
  await expect(hardware.getByText('No live hardware connected')).toBeVisible();
  await expect(hardware.getByText('0 verified · Ethernet design links')).toBeVisible();
  const edge = hardware.locator('[data-hw-link]').first();
  await edge.focus();
  await expect(edge).toBeFocused();
  await edge.press('Enter');
  await expect(hardware.getByText('UNVERIFIED · NOT WIRED')).toBeVisible();
  const networkTab = hardware.getByRole('tab', { name: 'Fronthaul topology' });
  await networkTab.focus();
  await networkTab.press('ArrowRight');
  const racksTab = hardware.getByRole('tab', { name: 'Rack & server bays' });
  await expect(racksTab).toBeFocused();
  await hardware.locator('[data-hw-slot="GH-POOL-02-S06"]').first().click();
  await expect(hardware.getByText('SERVER BAY · NO DISCOVERY')).toBeVisible();
  await hardware.locator('#hw-rotate').click();
  await expect(hardware.locator('#hw-rotate')).toHaveAttribute('aria-pressed', 'false');
  await hardware.getByRole('tab', { name: 'Capacity & registry' }).click();
  const count = hardware.locator('[data-pool-count="GH-POOL-02"]');
  await count.fill('3');
  await count.press('Tab');
  await expect.poll(() => (database.workspace.projects[0].project.management as {
    topology: { gh200Pools: { plannedServers: number }[] };
  }).topology.gh200Pools[1].plannedServers).toBe(3);
  expect((database.workspace.projects[1].project.management as {
    topology: { gh200Pools: { plannedServers: number }[] };
  }).topology.gh200Pools[1].plannedServers).toBe(6);
  await count.fill('7');
  await count.press('Tab');
  await expect(count).toHaveValue('3');
  await expect(page.getByRole('alert')).toContainText('supports up to six planned servers');
  const registry = hardware.locator('.hwx-registry');
  await registry.locator('summary').click();
  const alias = hardware.locator('[data-hw-alias="vdu-pool"]');
  await alias.fill('Lab vDU host');
  await alias.press('Tab');
  await expect.poll(() => (database.workspace.projects[0].project.management as {
    hardware: { alias: string }[];
  }).hardware[0].alias).toBe('Lab vDU host');
  await expect(registry).toHaveAttribute('open', '');
  await expect(hardware.getByText('0 · NOT DISCOVERED').first()).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Hardware inventory');
  await hardware.getByRole('tab', { name: 'Capacity & registry' }).click();
  await expect(hardware.locator('[data-pool-count="GH-POOL-02"]')).toHaveValue('3');
  await hardware.locator('.hwx-registry summary').click();
  await expect(hardware.locator('[data-hw-alias="vdu-pool"]')).toHaveValue('Lab vDU host');
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(hardware.getByRole('tab', { name: 'Fronthaul topology' })).toHaveAttribute('aria-selected', 'true');
  await hardware.getByRole('tab', { name: 'Capacity & registry' }).click();
  await expect(hardware.locator('[data-pool-count="GH-POOL-02"]')).toHaveValue('6');
  await page.setViewportSize({ width: 390, height: 844 });
  await hardware.getByRole('tab', { name: 'Fronthaul topology' }).click();
  const graph = hardware.getByRole('region', { name: /Hardware topology diagram/i });
  expect(await graph.evaluate(element => element.scrollWidth)).toBeGreaterThan(await graph.evaluate(element => element.clientWidth));
  await graph.focus();
  await graph.press('ArrowRight');
  await expect.poll(() => graph.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await clickWorkspaceButton(page, 'Activity');
  await expect(hardware).toHaveCount(0);
  expect(errors).toEqual([]);
});
