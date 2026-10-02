import test from 'node:test';
import assert from 'node:assert/strict';
import { dmTrendScale } from './dm-trend.mjs';
import { DM_METRICS } from './dm.mjs';
import { dmView } from './dm-ui.mjs';
import { defaultProject } from './model.mjs';

test('RF axes enclose decimal observations and thresholds on an exact, evenly spaced scale', () => {
  const samples = [{ rsrpDbm: -115.3 }, { rsrpDbm: null }, { rsrpDbm: -90.2 }];
  const scale = dmTrendScale(samples, DM_METRICS.rsrp);
  assert.deepEqual(scale.ticks, [-130, -120, -110, -100, -90, -80]);
  assert.equal(scale.step, 10);
  assert.equal(scale.y(-130), scale.plot.bottom);
  assert.equal(scale.y(-80), scale.plot.top);
  assert.ok(scale.y(-115.3) > scale.y(-110));
  assert.equal(scale.x(0), scale.plot.left);
  assert.equal(scale.x(2), scale.plot.right);
});

test('throughput axes start at zero while negative SINR remains visible', () => {
  const throughput = dmTrendScale([{ dlMbps: 0 }, { dlMbps: 35 }], DM_METRICS.dl);
  assert.equal(throughput.minimum, 0);
  assert.equal(throughput.maximum, 40);
  assert.deepEqual(throughput.ticks, [0, 10, 20, 30, 40]);
  const sinr = dmTrendScale([{ sinrDb: -3 }, { sinrDb: 17 }], DM_METRICS.sinr);
  assert.deepEqual(sinr.ticks, [-10, 0, 10, 20, 30]);
});

test('downsampling includes the final observation and produces unambiguous sample ticks', () => {
  const samples = Array.from({ length: 502 }, (_, index) => ({ rsrpDbm: -100, index }));
  const scale = dmTrendScale(samples, DM_METRICS.rsrp);
  assert.equal(scale.observations.at(-1), 501);
  assert.equal(scale.x(scale.observations.at(-1)), scale.plot.right);
  assert.deepEqual(scale.sampleTicks, [0, 125, 251, 376, 501]);
  assert.deepEqual(dmTrendScale(samples.slice(0, 1), DM_METRICS.rsrp).sampleTicks, [0]);
  assert.deepEqual(dmTrendScale([], DM_METRICS.rsrp).sampleTicks, []);
});

test('template chart discloses its category and scale, shows isolated observations, and preserves missing-value gaps', () => {
  const samples = [0, 1, 2].map(index => ({ index, technology: 'NR', servingCell: 'A', event: '',
    x: index * 10, y: 20, timeS: index, rsrpDbm: index === 1 ? null : -100, rsrqDb: null, sinrDb: null,
    dlMbps: null, ulMbps: null, provenance: 'imported-unverified' }));
  const html = dmView(defaultProject(), { panel: (_title, _caption, body) => body, badge: () => '' },
    { source: 'imported-unverified', samples });
  const chart = html.slice(html.indexOf('<div class="dm-trend">'), html.indexOf('<div class="lower-grid">'));
  assert.match(chart, /KPI category · Signal power/);
  assert.match(chart, /RSRP \/ SS-RSRP <small>\(dBm\)/);
  assert.match(chart, /Scale -115 to -90 dBm · 5 dBm \/ division/);
  assert.match(chart, /Example weak threshold: -110 dBm/);
  assert.match(chart, /preserveAspectRatio="xMinYMid meet"/);
  assert.equal((chart.match(/<circle /g) ?? []).length, 2);
  assert.doesNotMatch(chart, /stroke-width="3"/);
});
