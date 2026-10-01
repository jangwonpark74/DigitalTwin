import test from 'node:test';
import assert from 'node:assert/strict';
import { renderActivityView, renderEventsPanel } from './activity-ui.mjs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const helpers = {
  escape,
  header: (title, subtitle) => `<header><h1>${title}</h1><p>${subtitle}</p></header>`,
  banner: () => '<aside>Preparation workspace · RAN integration not connected</aside>',
  badge: label => `<span>${label}</span>`,
  panel: (title, caption, body, extra = '') => `<section><h2>${title}</h2><p>${caption}</p>${extra}${body}</section>`,
};

test('legacy activity leaf keeps the empty state, trust banner, and export action', () => {
  const html = renderActivityView([], helpers);
  assert.match(html, /Activity & handoff/);
  assert.match(html, /RAN integration not connected/);
  assert.match(html, /Recent activity/);
  assert.match(html, /data-go="activity"/);
  assert.match(html, /id="handoff-export"/);
  assert.match(html, /NOT IMPLEMENTED/);
  assert.doesNotMatch(html, /event-item/);
});

test('legacy activity leaf renders only the selected project log, escapes labels, and preserves newest-first order', () => {
  const entries = [
    { when: '2026-09-30T01:02:00Z', title: '<latest>', detail: 'saved & pending' },
    { when: '2026-09-29T01:02:00Z', title: 'older', detail: 'unchanged' },
  ];
  const html = renderEventsPanel(entries, 1, helpers);
  assert.match(html, /&lt;latest&gt;/);
  assert.match(html, /saved &amp; pending/);
  assert.doesNotMatch(html, /older/);
  assert.ok(renderActivityView(entries, helpers).indexOf('&lt;latest&gt;') < renderActivityView(entries, helpers).indexOf('older'));
});
