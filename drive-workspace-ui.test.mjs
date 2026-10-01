import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { makeDemoTrace } from './dm.mjs';
import { drivePlan } from './usecases.mjs';
import { renderDriveWorkspace } from './drive-workspace-ui.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const helpers = {
  header: title => `<h1>${title}</h1>`, banner: () => '<aside>RAN OFFLINE</aside>',
  badge: text => `<span>${text}</span>`,
  panel: (title, caption, body, extra = '') => `<section><h2>${title}</h2><p>${caption}</p>${extra}${body}</section>`,
  escape,
};

test('drive workspace defaults to synthetic DM analysis and exposes its alternate plan tab', () => {
  const p = defaultProject();
  const html = renderDriveWorkspace(p, helpers);
  assert.match(html, /Virtual drive test workspaces/);
  assert.match(html, /data-drive-tab="analysis" aria-selected="true"/);
  assert.match(html, /data-drive-tab="plan" aria-selected="false"/);
  assert.match(html, /SYNTHETIC DEMO · NOT MEASURED/);
  assert.match(html, /Deterministic UI illustration derived from the planned route/);
  assert.match(html, /NO ACCEPTANCE VERDICT/);
  assert.match(html, /id="dm-csv"/);
  assert.doesNotMatch(html, /IMPORTED CSV · UNVERIFIED/);
  const planned = renderDriveWorkspace(p, helpers, { tab: 'plan' });
  assert.match(planned, /data-drive-tab="plan" aria-selected="true"/);
  assert.match(planned, /NO MEASUREMENTS/);
  assert.match(planned, /data-export-usecase="drive"/);
  assert.doesNotMatch(planned, /SYNTHETIC DEMO · NOT MEASURED/);
});

test('drive workspace discloses an imported trace while preserving its source and read-only project', () => {
  const p = defaultProject(), original = structuredClone(p);
  const trace = { ...makeDemoTrace(p, drivePlan(p)), source: 'imported-csv' };
  const html = renderDriveWorkspace(p, helpers, { trace, filename: '<source>.csv', technology: 'NR', metric: 'sinr', position: 2 });
  assert.match(html, /IMPORTED CSV · UNVERIFIED/);
  assert.match(html, /Local file &lt;source&gt;.csv/);
  assert.match(html, /id="dm-technology"/);
  assert.doesNotMatch(html, /<source>/);
  assert.deepEqual(p, original);
});
