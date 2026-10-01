import { expect, test } from '@playwright/test';
import { clickWorkspaceButton } from './navigation';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceArtifactIndex } from '../../artifacts.mjs';

test('product workspaces keep readable headings, usable layouts and planning context', async ({ page }, testInfo) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const workspace = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111' });
  const artifacts = workspaceArtifactIndex(workspace)[workspace.activeProjectId]
    .map((file: Record<string, unknown>) => ({ ...file, updatedAt: workspace.projects[0].updatedAt }));
  await page.route(url => url.pathname.startsWith('/api/'), async route => {
    const path = new URL(route.request().url()).pathname;
    const body = path === '/api/workspace' ? { revision: 1, workspace }
      : path.endsWith('/artifacts') ? { artifacts }
      : path.endsWith('/runs') ? { runs: [], total: 0, nextOffset: null }
      : path === '/api/rt/capability' ? { available: false, platform: 'browser-test', message: 'No local solver connected.' }
      : null;
    expect(route.request().method(), `read-only tour: ${path}`).toBe('GET');
    expect(body, `Unexpected API request: ${path}`).not.toBeNull();
    await route.fulfill({ json: body });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '5G RAN twin mission control' })).toBeVisible();
  const routes: [string | null, string, string][] = [
    [null, 'Mission control', 'overview'], [null, 'Projects', 'projects'], [null, 'RAN topology', 'topology'],
    [null, 'Project artifacts', 'artifacts'], [null, 'Virtual UE fleet', 'ues'], [null, 'City map', 'map'],
    [null, 'Site & cell planner', 'planner'], [null, 'Radio planner', 'radio'], [null, 'Ray tracing lab', 'ray'],
    ['USE CASES', 'Virtual drive test', 'drive'], ['USE CASES', 'Package A/B test', 'ab'], ['USE CASES', 'AI-RAN data generation', 'data'],
    ['SYSTEM', 'Hardware inventory', 'hardware'], ['SYSTEM', 'Software management', 'software'], ['SYSTEM', 'Monitoring', 'monitoring'],
    ['TASKS & SCHEDULE', 'Task board', 'tasks'], ['TASKS & SCHEDULE', 'Schedule', 'schedule'], [null, 'Activity', 'activity'],
  ];
  for (const [group, route, id] of routes) {
    const nav = page.getByRole('navigation', { name: 'Application workspaces' });
    if (group && !await nav.getByRole('button', { name: route, exact: true }).isVisible()) await clickWorkspaceButton(page, group);
    await clickWorkspaceButton(page, route);
    await expect(page.locator('main h1').first()).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText(route);
    const contrast = await page.locator('main').evaluate(main => {
      const rgb = (value: string) => (value.match(/[\d.]+/g) ?? []).map(Number).slice(0, 3);
      const luminance = (values: number[]) => values.map(value => {
        const channel = value / 255;
        return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
      }).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i], 0);
      return [...main.querySelectorAll('h1,h2,h3')].filter(element => element.getBoundingClientRect().height > 0).map(element => {
        let parent: Element | null = element;
        let background = 'rgb(255, 255, 255)';
        while (parent) {
          const candidate = getComputedStyle(parent).backgroundColor;
          if (candidate !== 'rgba(0, 0, 0, 0)' && candidate !== 'transparent') { background = candidate; break; }
          parent = parent.parentElement;
        }
        const a = luminance(rgb(getComputedStyle(element).color)), b = luminance(rgb(background));
        return { title: element.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
      });
    });
    expect(contrast.filter(heading => heading.ratio < 4.5), `${route} heading contrast`).toEqual([]);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`${id}-desktop.png`), fullPage: true });
  }
  expect(errors).toEqual([]);
});
