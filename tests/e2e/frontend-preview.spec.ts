import { clickWorkspaceButton } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import { createWorkspaceState } from '../../workspaces.mjs';

const projectId = '11111111-1111-4111-8111-111111111111';

async function stubWorkspaceApi(page: Page) {
  const database = {
    revision: 1,
    workspace: createWorkspaceState(undefined, {
      id: projectId,
      now: () => '2026-09-01T00:00:00.000Z',
    }),
  };
  await page.route('**/api/workspace', async route => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(database) });
      return;
    }
    if (request.method() === 'PUT') {
      const body = request.postDataJSON() as { revision: number; workspace: typeof database.workspace };
      if (body.revision !== database.revision) {
        await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Workspace revision conflict' }) });
        return;
      }
      database.workspace = body.workspace;
      database.revision += 1;
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: database.revision }) });
      return;
    }
    await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: 'Method not allowed' }) });
  });
}

test('the root serves the React workspace and project lifecycle stays scoped and durable', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
  page.on('requestfailed', request => {
    // Leaving a map destroys its viewer and deliberately cancels outstanding tile requests.
    if (request.url().startsWith('https://tiles.openfreemap.org/') && request.failure()?.errorText === 'net::ERR_ABORTED') return;
    errors.push(`request failed: ${request.url()} · ${request.failure()?.errorText}`);
  });
  await stubWorkspaceApi(page);
  await page.goto('/');

  expect(errors).toEqual([]);
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('RAN Twin · City Pilot');
  await expect(page.getByRole('navigation', { name: 'Application workspaces' })).toBeVisible();
  await clickWorkspaceButton(page, 'Projects');
  await expect(page.getByRole('heading', { name: 'Twin Workspace projects' })).toBeVisible();

  await page.getByLabel('Project name', { exact: true }).fill('Seoul CBD pilot');
  await page.getByLabel('City / location').fill('Seoul');
  await page.getByLabel('Cluster').fill('Central business district');
  await page.getByRole('button', { name: 'Create project' }).click();
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('Seoul CBD pilot');

  await clickWorkspaceButton(page, 'Projects');
  const original = page.locator('.project-card').filter({ hasText: 'RAN Twin · City Pilot' });
  await original.getByRole('button', { name: 'Open project' }).click();
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('RAN Twin · City Pilot');

  await clickWorkspaceButton(page, 'Projects');
  const pilot = page.locator('.project-card').filter({ hasText: 'Seoul CBD pilot' });
  await pilot.getByText('Rename', { exact: true }).click();
  await pilot.locator('details input').fill('Seoul CBD phase 2');
  await pilot.getByRole('button', { name: 'Save name' }).click();
  const renamed = page.locator('.project-card').filter({ hasText: 'Seoul CBD phase 2' });
  await expect(renamed.getByRole('heading', { name: 'Seoul CBD phase 2' })).toBeVisible();
  await renamed.getByRole('button', { name: 'Archive' }).click();
  await expect(renamed.getByText('ARCHIVED', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('RAN Twin · City Pilot');

  await renamed.getByRole('button', { name: 'Restore' }).click();
  await expect(renamed.getByText('ACTIVE', { exact: true })).toBeVisible();
  await renamed.getByRole('button', { name: 'Archive' }).click();
  await expect(renamed.getByText('ARCHIVED', { exact: true })).toBeVisible();
  page.once('dialog', dialog => dialog.accept());
  await renamed.getByRole('button', { name: 'Delete permanently' }).click();
  await expect(page.getByRole('heading', { name: 'Seoul CBD phase 2' })).toHaveCount(0);
  expect(errors).toEqual([]);
});
