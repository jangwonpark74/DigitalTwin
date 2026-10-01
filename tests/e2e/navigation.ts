import { type Page } from '@playwright/test';

export async function openMobileNavigation(page: Page) {
  const button = page.getByRole('button', { name: 'Navigation +' });
  if (await button.isVisible()) await button.click();
}

export async function clickWorkspaceButton(page: Page, name: string | RegExp) {
  await openMobileNavigation(page);
  await page.getByRole('navigation', { name: 'Application workspaces' }).getByRole('button', { name, exact: typeof name === 'string' }).click();
}
