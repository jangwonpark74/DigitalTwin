import { type Page } from '@playwright/test';
import { previewRoutes } from '../../src/app/routeRegistry';
import { sectionForRoute } from '../../src/app/workflowNavigation';

export async function openMobileNavigation(page: Page) {
  const button = page.getByRole('button', { name: 'Navigation +' });
  if (await button.isVisible()) await button.click();
}

export async function clickWorkspaceButton(page: Page, name: string | RegExp) {
  await openMobileNavigation(page);
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  const route = Object.entries(previewRoutes).find(([, item]) => typeof name === 'string' ? item.label === name : name.test(item.label));
  if (route && route[0] !== 'projects') {
    const section = sectionForRoute(route[0] as keyof typeof previewRoutes)!;
    const toggle = sidebar.getByRole('button', { name: section.label, exact: true });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  }
  await sidebar.getByRole('button', { name, exact: typeof name === 'string' }).click();
}
