import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { radioPlannerView } from './radio-ui.mjs';

const helpers = {
  header: (title, subtitle, action = '') => `<header><h1>${title}</h1><p>${subtitle}</p>${action}</header>`,
  banner: () => '<div>Planning only</div>',
  panel: (title, caption, body, extra = '') => `<section><h2>${title}</h2><p>${caption}</p>${extra}${body}</section>`,
  badge: (label, style = '') => `<span class="${style}">${label}</span>`,
};

test('radio planner shows editable RU, MMU and per-location coordinates', () => {
  const project = defaultProject();
  const html = radioPlannerView(project, helpers, { selectedSiteId: 'SITE-02' });
  assert.match(html, /Radio planner/);
  assert.match(html, /Samsung/);
  assert.match(html, /4G LTE \+ 5G NR/);
  assert.match(html, /MMU model/);
  assert.match(html, /data-radio-config="SITE-02"/);
  assert.match(html, /data-radio-location="SITE-02"/);
  assert.match(html, /data-radio-place="SITE-02"/);
  assert.match(html, /coordinates not set/i);
});

test('radio planner makes site selection and map placement explicit and escapes site labels', () => {
  const project = defaultProject();
  project.sites[0].name = 'North <Tower>';
  project.sites[0].radioLocation = { latitude: 37.5, longitude: 126.9, source: 'manual' };
  const html = radioPlannerView(project, helpers, { selectedSiteId: 'SITE-01' });
  assert.match(html, /data-radio-site="SITE-01"/);
  assert.match(html, /North &lt;Tower&gt;/);
  assert.doesNotMatch(html, /North <Tower>/);
  assert.match(html, /data-prop="latitude" value="37\.5"/);
  assert.match(html, /manual/i);
  assert.match(html, /data-radio-place="SITE-01"/);
});

test('radio coordinates display at input precision', () => {
  const project = defaultProject();
  project.sites[0].radioLocation = { latitude: 37.57, longitude: 126.98000000000002, source: 'map-estimate' };
  const html = radioPlannerView(project, helpers, { selectedSiteId: 'SITE-01' });
  assert.match(html, /data-prop="longitude" value="126\.98"/);
  assert.doesNotMatch(html, /126\.98000000000002/);
  project.sites[0].radioLocation.source = 'manual';
  assert.doesNotMatch(radioPlannerView(project, helpers), /126\.98000000000002/);
});
