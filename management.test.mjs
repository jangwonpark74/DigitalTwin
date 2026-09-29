import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultManagement, validateManagement, managementSnapshot, sanitizeManagement, topologySummary } from './management.mjs';
import { defaultProject, createManifest, upgradeProject } from './model.mjs';

test('hardware inventory models target GH200/H200/Grace, not discovered devices', () => {
  const m=defaultManagement();
  assert.deepEqual(m.hardware.map(x=>x.id),['vdu-pool','host-gh200','gpu-h200','cpu-grace','ethernet-switch','fronthaul']);
  assert.ok(m.hardware.every(x=>x.discovery==='not-discovered'));
  assert.equal(validateManagement(m).length,0);
});

test('topology plans four GH200 pools of six plus vDU pool and Ethernet switch, without claiming links', () => {
  const m=defaultManagement(), topology=m.topology, summary=topologySummary(m);
  assert.deepEqual(topology.gh200Pools.map(x=>x.plannedServers),[6,6,6,6]);
  assert.deepEqual(topology.gh200Pools.map(x=>x.id),['GH-POOL-01','GH-POOL-02','GH-POOL-03','GH-POOL-04']);
  assert.equal(topology.vduServerCount,null);
  assert.equal(topology.switchPortCount,null);
  assert.equal(summary.plannedGh200Servers,24);
  assert.equal(summary.discoveredGh200Servers,0);
  assert.equal(summary.unverifiedLinks,5);
  assert.ok(topology.links.every(x=>x.medium==='Ethernet' && x.status==='unverified'));
});

test('pool plans are bounded at six servers each and imported link status is sanitized', () => {
  const m=defaultManagement();m.topology.gh200Pools[0].plannedServers=7;
  assert.ok(validateManagement(m).some(e=>e.includes('six')));
  const safe=defaultManagement();safe.topology.links[0].status='connected';safe.topology.gh200Pools[0].discovery='online';
  const sanitized=sanitizeManagement(safe);
  assert.equal(sanitized.topology.links[0].status,'unverified');
  assert.equal(sanitized.topology.gh200Pools[0].discovery,'not-discovered');
});

test('older stored projects gain topology and hardware entries without losing user aliases', () => {
  const old=defaultProject();delete old.management.topology;
  old.management.hardware=old.management.hardware.filter(x=>!['vdu-pool','ethernet-switch'].includes(x.id));
  old.management.hardware[0].alias='my GH200';
  const upgraded=upgradeProject(old);
  assert.equal(validateManagement(upgraded.management).length,0);
  assert.equal(upgraded.management.hardware.find(x=>x.id==='host-gh200').alias,'my GH200');
  assert.equal(upgraded.management.topology.gh200Pools.length,4);
});
test('software inventory includes channel, RU, front end and software UE with unverified versions', () => {
  const m=defaultManagement();
  assert.ok(['Sionna-RT','Virtual O-RAN RU','Virtual Antenna / MMU','Software UE'].every(name=>m.software.some(x=>x.name===name)));
  assert.ok(m.software.every(x=>x.installation==='not-verified'));
});

test('monitoring returns no measurements and imported status claims are sanitized', () => {
  const m=defaultManagement();
  m.hardware[0].discovery='online'; m.software[0].installation='running'; m.monitoring.connected=true;
  const safe=sanitizeManagement(m), snap=managementSnapshot(safe);
  assert.equal(safe.hardware[0].discovery,'not-discovered');
  assert.equal(safe.software[0].installation,'not-verified');
  assert.equal(safe.monitoring.connected,false);
  assert.ok(snap.signals.every(s=>s.value===null && s.status==='no-data'));
});

test('management validates version labels and threshold bounds before export', () => {
  const p=defaultProject();
  p.management.monitoring.thresholds.gpuUtilizationPct=120;
  assert.ok(validateManagement(p.management).some(e=>e.includes('threshold')));
  assert.throws(()=>createManifest(p),/threshold/);
});

test('manifest includes management targets with unverified discovery and no telemetry', () => {
  const m=JSON.parse(createManifest(defaultProject()));
  assert.equal(m.management.hardware[0].discovery,'not-discovered');
  assert.equal(m.monitoring.signals[0].value,null);
  assert.equal(m.monitoring.connected,false);
});
