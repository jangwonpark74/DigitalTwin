import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { drivePlan } from './usecases.mjs';
import { makeDemoTrace, parseDmCsv, analyzeDmTrace, DM_METRICS } from './dm.mjs';

const fixture=`time_s,technology,serving_cell,x_pct,y_pct,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event\n0,4G,SITE-01-C1,10,20,-90,-9,17,35,8,\n1,5G,SITE-01-C1,20,25,-115,-16,-2,3,1,handover\n2,NR,SITE-02-C1,30,27,-117,-17,-3,2,0.5,\n3,LTE,SITE-02-C1,40,30,-96,-12,7,22,5,\n`;

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
