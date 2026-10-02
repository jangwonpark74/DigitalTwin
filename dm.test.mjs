import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { drivePlan } from './usecases.mjs';
import { makeDemoTrace, parseDmCsv, analyzeDmTrace, buildDmAnalysisReport, DM_METRICS, inspectDmCsv } from './dm.mjs';

const fixture=`time_s,technology,serving_cell,x_pct,y_pct,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event\n0,4G,SITE-01-C1,10,20,-90,-9,17,35,8,\n1,5G,SITE-01-C1,20,25,-115,-16,-2,3,1,handover\n2,NR,SITE-02-C1,30,27,-117,-17,-3,2,0.5,\n3,LTE,SITE-02-C1,40,30,-96,-12,7,22,5,\n`;

test('partial KPI imports preserve nulls and exclude missing observations from quality denominators and zones', () => {
  const partial = parseDmCsv('time_s,technology,serving_cell,latitude,longitude,sinr_db,dl_mbps\n0,NR,A,37.5,127,-2,0\n1,NR,A,37.501,127.001,,\n2,NR,A,37.502,127.002,-4,NA');
  assert.equal(partial.schemaVersion, 2);
  assert.deepEqual(partial.samples.map(s => s.rsrpDbm), [null, null, null]);
  assert.deepEqual(partial.samples.map(s => s.dlMbps), [0, null, null]);
  const stats = analyzeDmTrace(partial.samples, { metric: 'sinr' });
  assert.equal(stats.sampleCount, 3); assert.equal(stats.validCount, 2); assert.equal(stats.missingCount, 1);
  assert.equal(stats.average, -3); assert.equal(stats.weakPercent, 100);
  assert.deepEqual(stats.weakZones, [{ start: 0, end: 0 }, { start: 2, end: 2 }]);
  const unavailable = analyzeDmTrace(partial.samples, { metric: 'rsrp' });
  assert.equal(unavailable.average, null); assert.equal(unavailable.weakPercent, null);
  assert.equal(unavailable.weakCount, 0); assert.equal(unavailable.missingCount, 3);
});

test('explicit vendor column and unit mapping converts only selected units and retains source headers', () => {
  const csv = '\uFEFFElapsed,RAT,Cell,Lat,Lon,SS Power,Download\n0,5G,A,37.5,127,-90,7.5e6\n1500,4G,A,37.501,127.001,N/A,0';
  const inspected = inspectDmCsv(csv);
  assert.equal(inspected.headers[0], 'Elapsed');
  const mapping = { ...inspected.mapping, time_s: { column: 'Elapsed', unit: 'ms' }, technology: { column: 'RAT', unit: null },
    serving_cell: { column: 'Cell', unit: null }, latitude: { column: 'Lat', unit: 'degrees' }, longitude: { column: 'Lon', unit: 'degrees' },
    rsrp_dbm: { column: 'SS Power', unit: 'dBm' }, dl_mbps: { column: 'Download', unit: 'bps' } };
  const parsed = parseDmCsv(csv, { mapping });
  assert.deepEqual(parsed.samples.map(s => s.timeS), [0, 1.5]);
  assert.deepEqual(parsed.samples.map(s => s.dlMbps), [7.5, 0]);
  assert.deepEqual(parsed.samples.map(s => s.rsrpDbm), [-90, null]);
  assert.deepEqual(parsed.mapping, mapping);
  assert.throws(() => parseDmCsv(csv, { mapping: { ...mapping, latitude: { column: 'Lon', unit: 'degrees' } } }), /mapped more than once/);
  assert.throws(() => parseDmCsv(csv, { mapping: { ...mapping, dl_mbps: { column: 'Download', unit: 'MBps' } } }), /unit/);
  assert.throws(() => parseDmCsv(csv, { mapping: { ...mapping, time_s: { column: null, unit: 's' } } }), /Missing columns/);
  assert.throws(() => parseDmCsv(csv.replace('7.5e6', 'Infinity'), { mapping }), /dl_mbps/);
});

test('synthetic demo is deterministic, route-bound and explicitly non-measured', () => {
  const project=defaultProject(), plan=drivePlan(project);
  const a=makeDemoTrace(project,plan), b=makeDemoTrace(project,plan);
  assert.deepEqual(a,b);
  assert.equal(a.source,'synthetic-demo');
  assert.equal(a.samples.length,plan.samples.length);
  assert.deepEqual(a.samples.map(({x,y})=>({x,y})),plan.samples);
  assert.ok(a.samples.some(x=>x.technology==='LTE'));
  assert.ok(a.samples.some(x=>x.technology==='NR'));
  assert.ok(a.samples.every(x=>x.provenance==='illustrative-not-measured'));
});

test('DM CSV parses LTE/NR metrics, normalizes 4G/5G and derives no unprovided results', () => {
  const trace=parseDmCsv(fixture);
  assert.equal(trace.source,'imported-unverified');
  assert.equal(trace.coordinateMode,'schematic');
  assert.deepEqual(trace.samples.map(x=>x.technology),['LTE','NR','NR','LTE']);
  assert.equal(trace.samples[1].rsrpDbm,-115);
  assert.equal(trace.samples[1].event,'handover');
  assert.equal(trace.samples[1].provenance,'imported-unverified');
});

test('4G/5G DM analytics use selected technology, units and contiguous weak zones', () => {
  const trace=parseDmCsv(fixture);
  const all=analyzeDmTrace(trace.samples,{technology:'ALL',metric:'rsrp'});
  assert.equal(all.sampleCount,4);
  assert.equal(all.weakCount,2);
  assert.deepEqual(all.weakZones.map(x=>[x.start,x.end]),[[1,2]]);
  assert.equal(all.handoverCount,1);
  assert.equal(all.techCounts.LTE,2);
  assert.equal(all.techCounts.NR,2);
  const nr=analyzeDmTrace(trace.samples,{technology:'NR',metric:'sinr'});
  assert.equal(nr.sampleCount,2);
  assert.equal(nr.weakCount,2);
  assert.equal(nr.average,-2.5);
  assert.equal(DM_METRICS.rsrp.unit,'dBm');
});

test('CSV rejects missing, out-of-range and nonfinite KPIs, and never treats missing data as zero', () => {
  assert.throws(()=>parseDmCsv('time_s,technology\n1,LTE'),/Missing columns/);
  assert.throws(()=>parseDmCsv(fixture.replace('-115,-16,-2','NaN,-16,-2')),/rsrp_dbm/);
  assert.throws(()=>parseDmCsv(fixture.replace('20,25,-115','120,25,-115')),/x_pct/);
  assert.throws(()=>parseDmCsv(fixture.replace('35,8,','-5,8,')),/dl_mbps/);
  assert.throws(()=>parseDmCsv(fixture.replace('1,5G','-1,5G')),/time_s/);
});

test('CSV supports GPS columns only as normalized schematic positioning', () => {
  const csv=`time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,LTE,A,37.5,127.0,-90,-9,10,20,3\n1,NR,B,37.6,127.2,-91,-10,11,22,4\n`;
  const trace=parseDmCsv(csv);
  assert.equal(trace.coordinateMode,'gps-normalized-schematic');
  assert.deepEqual(trace.samples.map(x=>[x.x,x.y]),[[10,90],[90,10]]);
  assert.equal(trace.samples[0].latitude,37.5);
});

test('DM download preserves source-labelled filters, summary and events without raw data or verdicts', () => {
  const project=defaultProject(), demo=makeDemoTrace(project,drivePlan(project));
  const before=structuredClone(demo);
  const report=buildDmAnalysisReport(demo,{technology:'NR',metric:'sinr'});
  const {filtered,events,...summary}=analyzeDmTrace(demo.samples,{technology:'NR',metric:'sinr'});
  assert.deepEqual(report,{schemaVersion:1,kind:'4G-5G-DM-ANALYSIS',source:'synthetic-demo',
    provenance:'illustrative-not-measured',filename:null,coordinateMode:demo.coordinateMode,
    filters:{technology:'NR',metric:'sinr'},summary,
    events:events.map(s=>({sampleIndex:s.index,timeS:s.timeS,technology:s.technology,servingCell:s.servingCell,event:s.event})),
    note:'UI-only analysis. No Sionna-RT execution, verified 4G/5G measurement, or network acceptance verdict is implied.'});
  assert.equal(Object.hasOwn(report,'samples'),false);
  assert.equal(filtered.length,summary.sampleCount);
  assert.deepEqual(demo,before);
  const imported=buildDmAnalysisReport(parseDmCsv(fixture),{filename:'local.csv',technology:'NR',metric:'rsrp'});
  assert.equal(imported.source,'imported-unverified');
  assert.equal(imported.provenance,'imported-unverified');
  assert.equal(imported.filename,'local.csv');
  assert.equal(imported.summary.sampleCount,2);
  assert.throws(()=>buildDmAnalysisReport(demo,{metric:'unknown'}),/Unknown DM metric/);
});
