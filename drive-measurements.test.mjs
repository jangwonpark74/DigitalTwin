import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDmCsv } from './dm.mjs';
import { buildDriveMeasurements, validateDriveMeasurements } from './drive-measurements.mjs';
import { defaultProject, upgradeProject, validateProject } from './model.mjs';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event\n0,NR,SITE-01-C1,37.566,126.978,-90,-9,18,120,30,\n1,LTE,SITE-01-C1,37.566,126.9781,-115,-16,-2,3,1,handover';

test('nullable GPS schema is explicit while unversioned legacy captures remain unchanged and strict', () => {
  const partial = buildDriveMeasurements(parseDmCsv(csv.replace('rsrq_db', 'unused_rsrq')), 'partial.csv');
  assert.equal(partial.schemaVersion, 2);
  assert.equal(partial.samples[0].rsrqDb, null);
  assert.deepEqual(validateDriveMeasurements(partial), []);
  const legacy = buildDriveMeasurements(parseDmCsv(csv), 'legacy.csv'); delete legacy.schemaVersion;
  assert.deepEqual(upgradeProject({ ...defaultProject(), driveMeasurements: legacy }).driveMeasurements, legacy);
  legacy.samples[0].rsrqDb = null;
  assert.match(validateDriveMeasurements(legacy).join(';'), /sample/);
  const invalid = structuredClone(partial); invalid.schemaVersion = 99;
  assert.match(validateDriveMeasurements(invalid).join(';'), /version/i);
});

test('versioned source evidence never promotes a declared import to verified measurements', () => {
  const trace = buildDriveMeasurements(parseDmCsv(csv), 'field.csv');
  trace.evidence = { schemaVersion: 1, datasetId: `sha256-${'a'.repeat(64)}`, sha256: 'a'.repeat(64),
    origin: 'field-measured', verification: 'verified', rawCsv: csv, importedAt: '2026-10-02T00:00:00Z',
    sourceDate: null, coordinateReference: 'EPSG:4326', transformations: [{ type: 'strict-gps-csv-parse', version: 1 }] };
  assert.match(validateDriveMeasurements(trace).join(';'), /evidence/);
  trace.evidence.verification = 'unverified';
  assert.deepEqual(validateDriveMeasurements(trace), []);
  trace.evidence.rawCsv += '\nsynthetic-example';
  assert.match(validateDriveMeasurements(trace).join(';'), /synthetic/);
});

test('mapped evidence cannot hide a synthetic filename behind a measured declaration', () => {
  const parsed = parseDmCsv(csv), trace = buildDriveMeasurements(parsed, 'synthetic-drive.csv');
  const digest = 'a'.repeat(64);
  trace.evidence = { schemaVersion: 2, datasetId: `sha256-${digest}`, sha256: digest, normalizationSha256: digest,
    origin: 'field-measured', verification: 'unverified', rawCsv: csv, importedAt: '2026-10-02T00:00:00Z',
    sourceDate: null, coordinateReference: 'EPSG:4326', transformations: [{ type: 'mapped-gps-csv-parse', version: 2, mapping: parsed.mapping }] };
  assert.match(validateDriveMeasurements(trace).join(';'), /synthetic/);
  trace.evidence.origin = 'synthetic';
  assert.deepEqual(validateDriveMeasurements(trace), []);
});

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
  for (const mutate of [trace => trace.samples[0].latitude = 200, trace => trace.samples[1].rsrpDbm = undefined,
    trace => trace.samples[1].timeS = -1, trace => trace.samples[1].index = 0, trace => trace.source = 'measured']) {
    const invalid = structuredClone(valid); mutate(invalid);
    assert.ok(validateDriveMeasurements(invalid).length > 0);
    assert.ok(validateProject({ ...defaultProject(), driveMeasurements: invalid }).length > 0);
  }
});
