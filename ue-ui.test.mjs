import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { renderVirtualUeView } from './ue-ui.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const helpers = {
  header: title => `<h1>${title}</h1>`, banner: () => '<aside>RAN OFFLINE</aside>',
  badge: text => `<span>${text}</span>`,
  panel: (title, caption, body, extra = '') => `<section><h2>${title}</h2><p>${caption}</p>${extra}${body}</section>`,
  field: (label, path, value, type = 'text', attrs = '') => `<label>${label}<input type="${type}" data-field="${path}" value="${escape(value)}" ${attrs}/></label>`,
  escape,
};

test('UE fleet fallback retains planned Grace CPU fields and exact site allocations', () => {
  const p = defaultProject();
  p.ue.count = 1201;
  const html = renderVirtualUeView(p, helpers);
  assert.match(html, /Virtual UE fleet/);
  assert.match(html, /No UE processes are running in the browser/);
  assert.match(html, /CPU TARGET/);
  assert.match(html, /1,201 PLANNED/);
  assert.match(html, /data-field="ue.count" value="1201"/);
  assert.match(html, /data-field="ue.mobility"/);
  assert.match(html, /data-field="ue.seed"/);
  assert.deepEqual([...html.matchAll(/<b>([\d,]+) UEs<\/b>/g)].map(match => match[1]), ['401', '400', '400']);
  assert.deepEqual([...html.matchAll(/data-site-select="([^"]+)"/g)].map(match => match[1]), p.sites.map(site => site.id));
  assert.match(html, /require an actual UE\/RAN simulation backend/);
});

test('UE fleet fallback escapes untrusted site labels and does not imply execution', () => {
  const p = defaultProject();
  p.sites[0].name = '<img src=x onerror=alert(1)>';
  const html = renderVirtualUeView(p, helpers);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img/);
  assert.doesNotMatch(html, /\bCONNECTED\b|\bRUNNING\b/);
});
