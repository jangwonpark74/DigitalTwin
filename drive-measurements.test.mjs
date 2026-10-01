import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDmCsv } from './dm.mjs';
import { buildDriveMeasurements, validateDriveMeasurements } from './drive-measurements.mjs';
import { defaultProject, upgradeProject, validateProject } from './model.mjs';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event\n0,NR,SITE-01-C1,37.566,126.978,-90,-9,18,120,30,\n1,LTE,SITE-01-C1,37.566,126.9781,-115,-16,-2,3,1,handover';

test('GPS measurements preserve imported coordinates and KPIs through project upgrade', () => {
  const measurements = buildDriveMeasurements(parseDmCsv(csv), 'field.csv');
  const project = defaultProject();
  project.driveMeasurements = measurements;
  assert.deepEqual(validateProject(project), []);
  assert.deepEqual(upgradeProject(project).driveMeasurements, measurements);
  assert.equal(measurements.samples[1].longitude, 126.9781);
  assert.equal(measurements.samples[1].sinrDb, -2);
  const legacy = defaultProject(); delete legacy.driveMeasurements;
  assert.equal(upgradeProject(legacy).driveMeasurements, null);
});

test('GPS evidence rejects schematic data, synthetic sources and malformed persisted samples', () => {
  const schematic = csv.replace('latitude,longitude', 'x_pct,y_pct').replaceAll('37.566,126.9781', '10,20').replaceAll('37.566,126.978', '20,30');
  assert.throws(() => buildDriveMeasurements(parseDmCsv(schematic), 'schematic.csv'), /latitude and longitude/);
  assert.throws(() => buildDriveMeasurements({ ...parseDmCsv(csv), source: 'synthetic-demo' }, 'fake.csv'), /Only imported/);
  const valid = buildDriveMeasurements(parseDmCsv(csv), 'field.csv');
  for (const mutate of [trace => trace.samples[0].latitude = 200, trace => trace.samples[1].rsrpDbm = null,
    trace => trace.samples[1].timeS = -1, trace => trace.samples[1].index = 0, trace => trace.source = 'measured']) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.ok(validateDriveMeasurements(invalid).length > 0);
    assert.ok(validateProject({ ...defaultProject(), driveMeasurements: invalid }).length > 0);
  }
});
