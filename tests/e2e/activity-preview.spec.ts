import { clickWorkspaceButton, openMobileNavigation } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createWorkspaceState } from '../../workspaces.mjs';
import type { WorkspaceSnapshot } from '../../src/api/schemas';

const firstId = '11111111-1111-4111-8111-111111111111';
const secondId = '22222222-2222-4222-8222-222222222222';
type Database = { revision: number; workspace: WorkspaceSnapshot };

async function stubWorkspaceApi(page: Page, database: Database) {
  await page.route('**/api/workspace', async route => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(database) });
      return;
    }
    const payload = route.request().postDataJSON() as { revision: number; workspace: WorkspaceSnapshot };
    if (payload.revision !== database.revision) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Workspace changed in another browser tab' }) });
      return;
    }
    database.workspace = payload.workspace;
    database.revision++;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ revision: database.revision }) });
  });
}

test('React-owned activity leaf switches projects, exports, and reloads from one revisioned workspace', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second Activity Pilot';
  second.project.name = second.name;
  const database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);

  await page.goto('/frontend-preview.html');
  await expect(page.getByRole('region', { name: 'Legacy activity route' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  const host = page.getByRole('region', { name: 'Activity migration preview' });
  await expect(host.getByRole('heading', { name: 'Activity & handoff' })).toBeVisible();
  await expect(host).toBeFocused();
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect.poll(() => database.workspace.activeProjectId).toBe(secondId);
  expect(database.revision).toBe(3);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: /Export planning manifest/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('atlas-ran-twin-manifest.json');
  await expect.poll(() => database.revision).toBe(4);
  expect(database.workspace.projects[0].activity).toHaveLength(0);
  expect(database.workspace.projects[1].activity[0].title).toBe('Manifest exported');
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await expect(page.getByRole('combobox', { name: 'Active project' })).toHaveValue(secondId);
  await expect(page.getByText('Manifest exported')).toBeVisible();
  expect(errors).toEqual([]);
});

test('one stack leaf edits only the selected project and stays planning-only at narrow width', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second Activity Pilot';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'RAN topology');
  await openMobileNavigation(page);
  const sidebar = page.getByRole('complementary', { name: 'Primary navigation' });
  await expect(sidebar).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Breadcrumb' })).toContainText('RAN topology');
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('Central cluster · 2 projects');
  expect(await sidebar.evaluate(element => getComputedStyle(element).overflowY)).toBe('visible');
  const navBounds = await sidebar.evaluate(element => {
    const activity = [...element.querySelectorAll('button')].find(button => button.textContent === 'Activity')!;
    return { activityBottom: activity.getBoundingClientRect().bottom, sidebarBottom: element.getBoundingClientRect().bottom };
  });
  expect(navBounds.activityBottom).toBeLessThanOrEqual(navBounds.sidebarBottom);
  const group = sidebar.getByRole('button', { name: 'Data and Twin Setup' });
  await group.focus();
  await group.press('Enter');
  await expect(group).toHaveAttribute('aria-expanded', 'false');
  await group.press('Space');
  await expect(group).toHaveAttribute('aria-expanded', 'true');
  const stack = page.getByRole('region', { name: 'RAN topology preview route' });
  await expect(stack.getByRole('heading', { name: 'Physical-to-virtual RAN stack' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Legacy activity route' })).toHaveCount(0);
  await expect(stack.getByText('NOT CONNECTED', { exact: true })).toBeVisible();
  const diagram = stack.getByRole('region', { name: 'RAN architecture diagram' });
  expect(await diagram.evaluate(element => element.scrollWidth)).toBeGreaterThan(await diagram.evaluate(element => element.clientWidth));
  await diagram.focus();
  await diagram.press('ArrowRight');
  await expect.poll(() => diagram.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const label = stack.getByRole('textbox', { name: 'vCore endpoint label' });
  await label.fill('local-core');
  await label.press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  expect((database.workspace.projects[0].project.integration as { vCoreEndpoint: string }).vCoreEndpoint).toBe('local-core');
  expect(database.workspace.projects[0].activity[0].title).toBe('Project setting changed');
  expect((database.workspace.projects[1].project.integration as { vCoreEndpoint: string }).vCoreEndpoint).toBe('');
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(page.getByRole('region', { name: 'Active project context' })).toContainText('Second Activity Pilot');
  await expect(stack.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveValue('');
  await clickWorkspaceButton(page, 'Activity');
  await expect(stack).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Activity preview route' })).toBeVisible();
  const dimensions = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width);
  expect(errors).toEqual([]);
});

test('a stale revision keeps the draft until comparison and confirmed reload', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const database: Database = { revision: 2, workspace: initial };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'RAN topology');
  await expect(page.getByRole('textbox', { name: 'vCore endpoint label' })).toBeVisible();
  database.workspace = structuredClone(initial);
  (database.workspace.projects[0].project.integration as { vCoreEndpoint: string }).vCoreEndpoint = 'server-core';
  database.revision = 3;
  const label = page.getByRole('textbox', { name: 'vCore endpoint label' });
  await label.fill('local-draft');
  await label.press('Tab');
  await expect(page.getByRole('alert').filter({ hasText: 'Database save needs attention' }))
    .toContainText('Workspace changed in another browser tab');
  await expect(label).toHaveValue('local-draft');
  await page.getByRole('button', { name: 'Compare' }).click();
  await expect(page.getByRole('region', { name: 'Workspace comparison' })).toContainText('Local revision 2 · Database revision 3');
  await expect(page.getByRole('region', { name: 'Workspace comparison' })).toContainText('changed');
  await expect(page.getByRole('region', { name: 'Workspace comparison' })).toContainText('project.integration.vCoreEndpoint');
  expect(database.revision).toBe(3);
  await page.getByRole('button', { name: 'Retry' }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Database save needs attention' }))
    .toContainText('Workspace changed in another browser tab');
  expect(database.revision).toBe(3);
  page.once('dialog', dialog => void dialog.dismiss());
  await page.getByRole('button', { name: 'Reload database' }).click();
  await expect(label).toHaveValue('local-draft');
  page.once('dialog', dialog => void dialog.accept());
  await page.getByRole('button', { name: 'Reload database' }).click();
  await expect(page.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveValue('server-core');
  await expect(page.getByRole('region', { name: 'Workspace comparison' })).toHaveCount(0);
  expect(database.revision).toBe(3);
  const narrow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
  expect(errors).toEqual([]);
});

test('monitoring thresholds remain planned, project-scoped and validated after reload', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Other monitoring plan';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Monitoring');
  const monitoring = page.getByRole('region', { name: 'Monitoring preview route' });
  await expect(monitoring.getByRole('heading', { name: 'Monitoring' })).toBeVisible();
  await expect(monitoring.getByText('NO DATA', { exact: true })).toHaveCount(2);
  await expect(monitoring.getByText('OFFLINE', { exact: true })).toBeVisible();
  const gpu = monitoring.getByRole('spinbutton', { name: /H200 GPU utilization threshold/i });
  await gpu.fill('92');
  await gpu.press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  const firstThreshold = (database.workspace.projects[0].project.management as { monitoring: { connected: boolean; lastSample: null; thresholds: { gpuUtilizationPct: number } } }).monitoring;
  expect(firstThreshold).toMatchObject({ connected: false, lastSample: null, thresholds: { gpuUtilizationPct: 92 } });
  expect(database.workspace.projects[0].activity[0].title).toBe('Monitoring threshold changed');
  expect((database.workspace.projects[1].project.management as { monitoring: { thresholds: { gpuUtilizationPct: number } } }).monitoring.thresholds.gpuUtilizationPct).toBe(85);
  const latency = monitoring.getByRole('spinbutton', { name: /latency threshold/i });
  await latency.fill('501');
  await latency.press('Tab');
  await expect(page.getByRole('alert')).toContainText('Input rejected · Invalid monitoring threshold fronthaulLatencyMs');
  await expect(monitoring.getByRole('spinbutton', { name: /latency threshold/i })).toHaveValue('10');
  expect(database.revision).toBe(4);
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(monitoring.getByRole('spinbutton', { name: /H200 GPU utilization threshold/i })).toHaveValue('85');
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Monitoring');
  await expect(page.getByRole('combobox', { name: 'Active project' })).toHaveValue(secondId);
  await expect(page.getByRole('region', { name: 'Monitoring preview route' }).getByText('NO DATA', { exact: true })).toHaveCount(2);
  const narrow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
  expect(errors).toEqual([]);
});

test('software version targets stay project-scoped and unverified after invalid edit and reload', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Other software plan';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Software management');
  const software = page.getByRole('region', { name: 'Software preview route' });
  await expect(software.getByRole('heading', { name: 'Software management' })).toBeVisible();
  await expect(software.getByText('NOT VERIFIED', { exact: true })).toHaveCount(6);
  await expect(page.getByText('Scroll the software registry table horizontally to inspect all columns.')).toBeVisible();
  const table = software.getByRole('region', { name: /Software registry table/i });
  expect(await table.evaluate(element => element.scrollWidth)).toBeGreaterThan(await table.evaluate(element => element.clientWidth));
  await table.focus();
  await table.press('ArrowRight');
  await expect.poll(() => table.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  const version = software.getByRole('textbox', { name: 'Target version for Sionna-RT' });
  await version.fill('2.1.0');
  await version.press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  const current = (database.workspace.projects[0].project.management as { software: { id: string; targetVersion: string; installation: string }[] }).software;
  expect(current.find(item => item.id === 'sionna-rt')).toMatchObject({ targetVersion: '2.1.0', installation: 'not-verified' });
  expect(database.workspace.projects[0].activity[0].title).toBe('Software target version changed');
  expect((database.workspace.projects[1].project.management as { software: { id: string; targetVersion: string }[] }).software.find(item => item.id === 'sionna-rt')?.targetVersion).toBe('unassigned');
  await software.getByRole('textbox', { name: 'Target version for Sionna-RT' }).fill('bad version!');
  await software.getByRole('textbox', { name: 'Target version for Sionna-RT' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Input rejected · Invalid target version for sionna-rt');
  await expect(software.getByRole('textbox', { name: 'Target version for Sionna-RT' })).toHaveValue('2.1.0');
  expect(database.revision).toBe(4);
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(software.getByRole('textbox', { name: 'Target version for Sionna-RT' })).toHaveValue('unassigned');
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Software management');
  await expect(page.getByRole('combobox', { name: 'Active project' })).toHaveValue(secondId);
  await expect(page.getByRole('region', { name: 'Software preview route' }).getByText('NOT VERIFIED', { exact: true })).toHaveCount(6);
  const narrow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
  expect(errors).toEqual([]);
});

test('Schedule remains a dependency-checked project plan after edits and reload', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Other schedule';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const tasks = initial.projects[0].project.tasks as { id: string; dueDate: string; execution: string }[];
  const original = tasks.find(task => task.id === 'T-01')!.dueDate;
  const valid = tasks.find(task => task.id === 'T-02')!.dueDate;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Schedule');
  const schedule = page.getByRole('region', { name: 'Schedule preview route' });
  await expect(schedule.getByRole('heading', { name: 'Schedule' })).toBeVisible();
  await expect(schedule.getByText('NOT RUN', { exact: true })).toHaveCount(7);
  await expect(schedule.getByText(/Planning calendar only/i)).toBeVisible();
  await schedule.getByLabel('Reschedule T-01').fill(valid);
  await schedule.getByLabel('Reschedule T-01').press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  expect((database.workspace.projects[0].project.tasks as typeof tasks)[0]).toMatchObject({ dueDate: valid, execution: 'not-executed' });
  expect(database.workspace.projects[0].activity[0].title).toBe('Task date changed');
  expect((database.workspace.projects[1].project.tasks as typeof tasks)[0].dueDate).toBe(original);
  await schedule.getByLabel('Reschedule T-02').fill('2000-01-01');
  await schedule.getByLabel('Reschedule T-02').press('Tab');
  await expect(page.getByRole('alert')).toContainText('Task T-02 scheduled before dependency T-01');
  await expect(schedule.getByLabel('Reschedule T-02')).toHaveValue(valid);
  expect(database.revision).toBe(4);
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(schedule.getByLabel('Reschedule T-01')).toHaveValue(original);
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Schedule');
  await expect(page.getByRole('combobox', { name: 'Active project' })).toHaveValue(secondId);
  await expect(page.getByRole('region', { name: 'Schedule preview route' }).getByText('NOT RUN', { exact: true })).toHaveCount(7);
  const narrow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
  expect(errors).toEqual([]);
});

test('Task board adds only planned work and isolates project edits after reload', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Other task plan';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const dueDate = (initial.projects[0].project.tasks as { id: string; dueDate: string }[]).find(task => task.id === 'T-02')!.dueDate;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.route(/\/api\/projects\/[^/]+\/runs(?:\?.*)?$/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify({ runs: [], total: 0, nextOffset: null }),
  }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Task board');
  const board = page.getByRole('region', { name: 'Task board preview route' });
  await expect(board.getByRole('heading', { name: 'Task board' })).toBeVisible();
  await expect(board.getByText('NO DISPATCH', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Run records' }).getByText('No Sionna-RT run has been recorded for this project.')).toBeVisible();
  const form = board.locator('#add-task-form');
  await form.locator('[name=title]').fill('Validate antenna patterns');
  await form.locator('[name=dueDate]').fill(dueDate);
  await form.locator('[name=priority]').selectOption('high');
  await form.locator('[name=dependency]').selectOption('T-01');
  await form.getByRole('button', { name: /Add to plan/i }).click();
  await expect.poll(() => database.revision).toBe(4);
  expect((database.workspace.projects[0].project.tasks as { id: string; status: string; execution: string }[]).at(-1))
    .toMatchObject({ id: 'T-08', status: 'planned', execution: 'not-executed' });
  expect(database.workspace.projects[0].activity[0].title).toBe('Task added to plan');
  await board.locator('#add-task-form [name=title]').fill('Too early');
  await board.locator('#add-task-form [name=dueDate]').fill('2000-01-01');
  await board.locator('#add-task-form [name=dependency]').selectOption('T-01');
  await board.locator('#add-task-form').getByRole('button', { name: /Add to plan/i }).click();
  await expect(page.getByRole('alert')).toContainText('Task T-09 scheduled before dependency T-01');
  expect(database.revision).toBe(4);
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(board.getByText('Validate antenna patterns')).toHaveCount(0);
  expect((database.workspace.projects[1].project.tasks as unknown[])).toHaveLength(7);
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Task board');
  await expect(page.getByRole('combobox', { name: 'Active project' })).toHaveValue(secondId);
  const narrow = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(narrow.scrollWidth).toBeLessThanOrEqual(narrow.width);
  expect(errors).toEqual([]);
});

test('React run records separate planned work from scoped RT pages and selected detail', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Other task plan';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const run = { id: 'run-1', projectId: firstId, taskId: null, kind: 'sionna-rt',
    status: 'queued', createdAt: '2026-01-01', completedAt: null, totalPaths: null, error: null };
  let empty = false;
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.route(/\/api\/projects\/[^/]+\/runs(?:\?.*)?$/, route => {
    const url = new URL(route.request().url());
    const projectId = url.pathname.split('/')[3];
    const payload = projectId !== firstId || empty ? { runs: [], total: 0, nextOffset: null }
      : url.searchParams.get('offset') === '1'
        ? { runs: [{ ...run, id: 'run-2' }], total: 2, nextOffset: null }
        : { runs: [run], total: 2, nextOffset: 1 };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) });
  });
  await page.route(/\/api\/runs\/[^/]+$/, route => route.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify({ ...run, input: {}, result: null }) }));
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Task board');
  const board = page.getByRole('region', { name: 'Task board preview route' });
  const runs = page.getByRole('region', { name: 'Run records' });
  await expect(runs.getByRole('button', { name: /Run run-1 · queued/ })).toBeVisible();
  await expect(runs.getByRole('button', { name: 'Load older runs' })).toBeVisible();
  await expect(board.locator('[data-run-select]')).toHaveCount(0);
  expect(await board.locator('.ops-summary').textContent()).toContain('0planned tasks executed');
  await runs.getByRole('button', { name: /Run run-1 · queued/ }).click();
  await expect(runs.getByRole('article', { name: 'Run detail run-1' })).toContainText('Run run-1');
  await runs.getByRole('button', { name: 'Load older runs' }).click();
  await expect(runs.getByRole('button', { name: /Run run-2 · queued/ })).toBeVisible();
  await expect(runs.getByRole('article', { name: 'Run detail run-1' })).toBeVisible();
  empty = true;
  await runs.getByRole('button', { name: 'Refresh run list' }).click();
  await expect(runs.getByRole('button', { name: /Run run-1 · queued/ })).toHaveCount(0);
  await expect(runs.getByRole('article', { name: 'Run detail run-1' })).toHaveCount(0);
  await expect(runs.getByText('No Sionna-RT run has been recorded for this project.')).toBeVisible();
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(runs.getByText('No Sionna-RT run has been recorded for this project.')).toBeVisible();
  expect(errors).toEqual([]);
});

test('virtual UE fleet stays planned, validated and project-scoped in the narrow preview', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second UE Pilot';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Virtual UE fleet');
  const leaf = page.getByRole('region', { name: 'Virtual UE fleet preview route' });
  await expect(leaf.getByRole('heading', { name: 'Virtual UE fleet' })).toBeVisible();
  await expect(leaf.getByText('No UE processes are running in the browser')).toBeVisible();
  await expect(leaf.getByText('1,200 PLANNED')).toBeVisible();
  await leaf.getByRole('spinbutton', { name: 'UE population' }).fill('1800');
  await leaf.getByRole('spinbutton', { name: 'UE population' }).press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  await expect(leaf.getByText('1,800 PLANNED')).toBeVisible();
  await expect(leaf.getByText('600 UEs')).toHaveCount(3);
  await leaf.getByRole('combobox', { name: 'Mobility profile' }).selectOption('Vehicular cluster');
  await expect.poll(() => database.revision).toBe(6);
  await leaf.getByRole('spinbutton', { name: 'Reproducibility seed' }).fill('71');
  await leaf.getByRole('spinbutton', { name: 'Reproducibility seed' }).press('Tab');
  await expect.poll(() => database.revision).toBe(8);
  await leaf.locator('[data-site-select="SITE-02"]').click();
  expect(database.revision).toBe(8);
  await leaf.getByRole('spinbutton', { name: 'UE population' }).fill('50001');
  await leaf.getByRole('spinbutton', { name: 'UE population' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Invalid UE count');
  await expect(leaf.getByRole('spinbutton', { name: 'UE population' })).toHaveValue('1800');
  expect(database.revision).toBe(8);
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(leaf.getByText('1,200 PLANNED')).toBeVisible();
  await expect.poll(() => database.revision).toBe(9);
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();
  await clickWorkspaceButton(page, 'Virtual UE fleet');
  await expect(page.getByRole('region', { name: 'Virtual UE fleet preview route' }).getByText('1,200 PLANNED')).toBeVisible();
  expect((database.workspace.projects[0].project.ue as { count: number }).count).toBe(1800);
  expect((database.workspace.projects[1].project.ue as { count: number }).count).toBe(1200);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('paired A/B fallback exports only a scoped plan after validated edits', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second A/B Pilot';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Package A/B test');
  const leaf = page.getByRole('region', { name: 'A/B experiment preview route' });
  await expect(leaf.getByText('NO VERDICT')).toBeVisible();
  await expect(leaf.getByText('PENDING', { exact: true })).toBeVisible();
  await expect(leaf.locator('tbody tr')).toHaveCount(9);
  await leaf.getByRole('textbox', { name: 'Paired random seeds' }).fill('7, 8');
  await leaf.getByRole('textbox', { name: 'Paired random seeds' }).press('Tab');
  await expect.poll(() => database.revision).toBe(4);
  await expect(leaf.locator('tbody tr')).toHaveCount(6);
  await leaf.getByRole('textbox', { name: 'Paired random seeds' }).fill('7, 7');
  await leaf.getByRole('textbox', { name: 'Paired random seeds' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('A/B seeds must be unique bounded integers');
  await expect(leaf.getByRole('textbox', { name: 'Paired random seeds' })).toHaveValue('7, 8');
  expect(database.revision).toBe(4);
  const matrix = page.getByRole('region', { name: 'Paired run matrix table' });
  expect(await matrix.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
  await matrix.focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => matrix.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
  const downloadPromise = page.waitForEvent('download');
  await leaf.getByRole('button', { name: /Export A\/B experiment plan/i }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('atlas-ran-ab-plan.json');
  const spec = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(spec).toMatchObject({ schemaVersion: 1, mode: 'PLANNING_ONLY', useCase: 'ab',
    config: { seeds: [7, 8] }, plan: { status: 'not-executed', verdict: null } });
  expect(spec.plan.pairs).toHaveLength(6);
  await expect.poll(() => database.revision).toBe(5);
  expect(database.workspace.projects[0].activity[0]).toMatchObject({ title: 'Use-case plan exported', detail: 'ab' });
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(leaf.locator('tbody tr')).toHaveCount(9);
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Package A/B test');
  await expect(page.getByRole('region', { name: 'A/B experiment preview route' }).locator('tbody tr')).toHaveCount(9);
  expect(database.workspace.projects[1].activity).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('AI-RAN data fallback keeps generated rows at zero after scoped edits and export', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const second = structuredClone(initial.projects[0]);
  second.id = secondId;
  second.name = 'Second Data Pilot';
  second.project.name = second.name;
  const database: Database = { revision: 2, workspace: { ...initial, projects: [...initial.projects, second] } };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'AI-RAN data generation');
  const leaf = page.getByRole('region', { name: 'Dataset generation preview route' });
  await expect(leaf.getByText('0 ROWS GENERATED')).toBeVisible();
  await expect(leaf.getByText(/No generated samples, labels, or Parquet files exist/)).toBeVisible();
  await leaf.getByRole('combobox', { name: 'Learning task' }).selectOption('handover-prediction');
  await expect.poll(() => database.revision).toBe(4);
  await expect(leaf.getByText(/requires EM\+RAN simulation mode/)).toBeVisible();
  await leaf.getByRole('spinbutton', { name: 'Train (%)' }).fill('60');
  await leaf.getByRole('spinbutton', { name: 'Train (%)' }).press('Tab');
  await expect.poll(() => database.revision).toBe(6);
  await expect(leaf.getByRole('spinbutton', { name: 'Test (%)' })).toHaveValue('25');
  await leaf.getByRole('textbox', { name: 'Simulation seeds' }).fill('11, 11');
  await leaf.getByRole('textbox', { name: 'Simulation seeds' }).press('Tab');
  await expect(page.getByRole('alert')).toContainText('Data seeds must be unique bounded integers');
  expect(database.revision).toBe(6);
  await expect(leaf.getByRole('textbox', { name: 'Simulation seeds' })).toHaveValue('11, 22, 33');
  const pending = page.waitForEvent('download');
  await leaf.getByRole('button', { name: /Export dataset job spec/i }).click();
  const download = await pending;
  expect(download.suggestedFilename()).toBe('atlas-ran-data-plan.json');
  const spec = JSON.parse(await readFile(await download.path(), 'utf8'));
  expect(spec).toMatchObject({ schemaVersion: 1, mode: 'PLANNING_ONLY', useCase: 'data',
    config: { task: 'handover-prediction', split: { train: 60, validation: 15, test: 25 } },
    plan: { status: 'not-executed', requiredMode: 'EM+RAN', generatedRows: 0 } });
  await expect.poll(() => database.revision).toBe(7);
  expect(database.workspace.projects[0].activity[0]).toMatchObject({ title: 'Use-case plan exported', detail: 'data' });
  await page.getByRole('combobox', { name: 'Active project' }).selectOption(secondId);
  await expect(leaf.getByRole('combobox', { name: 'Learning task' })).toHaveValue('channel-prediction');
  await page.reload();
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'AI-RAN data generation');
  await expect(page.getByRole('region', { name: 'Dataset generation preview route' }).getByText('0 ROWS GENERATED')).toBeVisible();
  expect(database.workspace.projects[1].activity).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('schedule edits preserve dependency order and never dispatch planned tasks', async ({ page }) => {
  const initial = createWorkspaceState(undefined, { id: firstId, now: () => '2026-01-01T00:00:00Z' }) as WorkspaceSnapshot;
  const database: Database = { revision: 2, workspace: initial };
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await stubWorkspaceApi(page, database);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/frontend-preview.html');
  await page.getByRole('button', { name: 'Preview activity route' }).click();

  await clickWorkspaceButton(page, 'Schedule');
  const schedule = page.getByRole('region', { name: 'Schedule preview route' });
  await expect(schedule.getByText('Planning calendar only')).toBeVisible();
  await expect(schedule.getByText('Prerequisites: T-01')).toBeVisible();
  await expect(schedule.getByText('NOT RUN').first()).toBeVisible();
  const tasks = initial.projects[0].project.tasks as { id: string; dueDate: string }[];
  const later = tasks.find(task => task.id === 'T-02')!.dueDate;
  await schedule.getByLabel('Reschedule T-01').fill(later);
  await expect.poll(() => database.revision).toBe(4);
  expect((database.workspace.projects[0].project.tasks as typeof tasks)[0].dueDate).toBe(later);
  await schedule.getByLabel('Reschedule T-02').fill('2000-01-01');
  await expect(page.getByRole('alert')).toContainText('Task T-02 scheduled before dependency T-01');
  await expect(schedule.getByLabel('Reschedule T-02')).toHaveValue(later);
  expect(database.revision).toBe(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
