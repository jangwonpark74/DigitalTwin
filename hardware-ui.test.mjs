import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject } from './model.mjs';
import { hardwareView } from './hardware-workspace.mjs';

const h={header:title=>title,banner:()=>'',panel:(title,caption,body)=>`<section><h2>${title}</h2>${caption}${body}</section>`,badge:text=>text,escape:x=>x};

test('network workbench exposes four GH200 pools, vDU, switch and inspectable unverified links',()=>{
  const html=hardwareView(defaultProject(),h,{mode:'network',selectedNode:'GH-POOL-02'});
  assert.match(html,/24 \/ 24/);
  assert.match(html,/vDU server pool/);
  assert.match(html,/Ethernet switch fabric/);
  assert.equal((html.match(/data-hw-link="ETH-/g)||[]).length,5);
  assert.equal((html.match(/data-hw-node="GH-POOL-/g)||[]).length,4);
  assert.match(html,/data-hw-view="racks"/);
  assert.match(html,/data-hw-view="inventory"/);
  assert.match(html,/data-hw-slot="GH-POOL-02-S06"/);
  assert.match(html,/0 verified/);
  assert.doesNotMatch(html,/status="connected"|status="verified"/);
});

test('link inspector shows unresolved physical port, VLAN and timing evidence',()=>{
  const html=hardwareView(defaultProject(),h,{selectedLink:'ETH-FABRIC-P2'});
  assert.match(html,/ETH-FABRIC-P2/);
  assert.match(html,/PORT MAP.*TBD/s);
  assert.match(html,/VLAN.*TBD/s);
  assert.match(html,/TIMING.*TBD/s);
  assert.match(html,/unverified/i);
});

test('rack workbench renders all 24 target bays with selected host beside the visualization',()=>{
  const project=defaultProject();project.management.topology.gh200Pools[1].plannedServers=3;
  const html=hardwareView(project,h,{mode:'racks',selectedNode:'GH-POOL-02',selectedServer:'GH-POOL-02-S05',isometric:true});
  assert.match(html,/21 \/ 24/);
  assert.equal((html.match(/class="hwx-device /g)||[]).length,24);
  assert.match(html,/GH-POOL-02-S05/);
  assert.match(html,/RESERVED/);
  assert.match(html,/H200 GPU.*Grace CPU/s);
  assert.match(html,/aria-pressed="true"/);
});

test('inventory tab places editable capacity targets and registry under one bounded workspace',()=>{
  const html=hardwareView(defaultProject(),h,{mode:'inventory',selectedNode:'ethernet-switch'});
  assert.match(html,/data-pool-count="GH-POOL-04"/);
  assert.match(html,/data-hw-count="vdu"/);
  assert.match(html,/data-hw-count="switch"/);
  assert.match(html,/data-hw-alias="gpu-h200"/);
  assert.match(html,/Changes save locally on field exit/);
});
