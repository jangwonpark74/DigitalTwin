import { clickWorkspaceButton, openMobileNavigation } from './navigation';
import { expect, test } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../src/api/schemas';

test('Virtual UE fleet React route saves bounded planning inputs and keeps runtime claims clear', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const projectId = '99999999-9999-4999-8999-999999999999';
  const workspace = createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const database = { revision: 2, workspace };
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
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));

  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Virtual UE fleet');
  const preview = page.getByRole('region', { name: 'Virtual UE fleet preview route' });
  await expect(preview.getByText('No UE processes are running in the browser')).toBeVisible();
  await expect(preview.getByText('1,200 PLANNED')).toBeVisible();
  await expect(preview.getByText(/No real or emulated 5G protocol stack is running/)).toBeVisible();

  const count = preview.getByRole('spinbutton', { name: 'UE population' });
  await count.fill('2400');
  await count.press('Tab');
  await expect.poll(() => (database.workspace.projects[0].project.ue as { count: number }).count).toBe(2400);
  await expect(preview.getByText('800 UEs').first()).toBeVisible();
  await count.fill('50001');
  await count.press('Tab');
  await expect(preview.getByRole('alert')).toContainText('Invalid UE count');
  expect((database.workspace.projects[0].project.ue as { count: number }).count).toBe(2400);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
