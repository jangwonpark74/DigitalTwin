import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { parseGeoJsonScene } from './scene.mjs';
import { buildRtJob } from './rt-job.mjs';

const buildings={type:'FeatureCollection',features:[{type:'Feature',geometry:{type:'Polygon',coordinates:[[
  [126.9779,37.5664],[126.9781,37.5664],[126.9781,37.5666],[126.9779,37.5666],[126.9779,37.5664],
]]},properties:{height:18}}]};

test('RT job uses loaded WGS84 geometry and a genuinely located transmitter', () => {
  const project=defaultProject();
  project.map.scene=parseGeoJsonScene(buildings);
  assert.throws(()=>buildRtJob(project,'SITE-01',{latitude:37.5666,longitude:126.978,heightM:1.5}),/radio site/);
  project.sites[0].radioLocation={latitude:37.5665,longitude:126.978,source:'manual'};
  const job=buildRtJob(project,'SITE-01',{latitude:37.5666,longitude:126.978,heightM:1.5},{frequencyGhz:3.5,samplesPerSrc:10000,maxDepth:2});
  assert.equal(job.scene.footprints.length,1);
  assert.equal(job.transmitter.heightM,28);
  assert.deepEqual(job.receiver,{latitude:37.5666,longitude:126.978,heightM:1.5});
  assert.equal(job.maxDepth,2);
});

test('RT job rejects out-of-scope receivers and excessive work', () => {
  const project=defaultProject();
  project.map.scene=parseGeoJsonScene(buildings);
  project.sites[0].radioLocation={latitude:37.5665,longitude:126.978,source:'manual'};
  assert.throws(()=>buildRtJob(project,'SITE-01',{latitude:38,longitude:126.978,heightM:1.5}),/inside the map scope/);
  assert.throws(()=>buildRtJob(project,'SITE-01',{latitude:37.5666,longitude:126.978,heightM:1.5},{samplesPerSrc:1_000_000}),/Samples per source/);
});
