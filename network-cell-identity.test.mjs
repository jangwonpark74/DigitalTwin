import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, createManifest, upgradeProject } from './model.mjs';
import { normalizeInventoryIdentity, validateInventoryIdentities, inventoryIdentityLabel } from './network-cell-identity.mjs';
import { prepareCellIdentity, resolveMeasurementCell } from './cell-identity.mjs';
import { saveStudyDefinition, captureBaseline, stableJson, verifyStudyDigests } from './study.mjs';

const draft = (extra = {}) => ({ technology: 'NR', mcc: '001', mnc: '01', cellId: '0xFFFFFFFFF', pci: '1007', arfcn: '3279165', carrierName: 'Test carrier', sourceReference: 'Manual planning reference', ...extra });

test('normalizes explicit radio declarations without inventing values or dropping PLMN zeros', () => {
  const identity = normalizeInventoryIdentity(draft());
  assert.deepEqual(identity, { schemaVersion: 1, technology: 'NR', mcc: '001', mnc: '01', cellId: '68719476735', pci: 1007, arfcn: 3279165, carrierName: 'Test carrier', sourceReference: 'Manual planning reference', source: 'manual', verification: 'unverified' });
  assert.match(inventoryIdentityLabel(identity), /001-01.*FFFFFFFFF/);
  const empty = normalizeInventoryIdentity(draft({ mcc: '', mnc: '', cellId: '', pci: '', arfcn: '', carrierName: '', sourceReference: '' }));
  for (const key of ['mcc', 'mnc', 'cellId', 'pci', 'arfcn', 'carrierName', 'sourceReference']) assert.equal(empty[key], null);
  assert.throws(() => normalizeInventoryIdentity(draft({ technology: '' })), /technology/);
});

test('rejects invalid RAT-dependent boundaries and incomplete or malformed PLMN values', () => {
  for (const extra of [{ technology: ['NR'] }, { mcc: '01' }, { mnc: '1' }, { mnc: '' }, { cellId: '68719476736' }, { cellId: '1e3' }, { pci: '1008' }, { pci: '-1' }, { pci: '1.1' }, { arfcn: '3279166' }])
    assert.throws(() => normalizeInventoryIdentity(draft(extra)));
  for (const extra of [{ cellId: '268435456' }, { pci: '504' }, { arfcn: '262144' }])
    assert.throws(() => normalizeInventoryIdentity(draft({ technology: 'LTE', cellId: '268435455', pci: '503', arfcn: '262143', ...extra })));
  assert.equal(normalizeInventoryIdentity(draft({ technology: 'LTE', cellId: '0xFFFFFFF', pci: '503', arfcn: '262143' })).cellId, '268435455');
});

test('rejects forged provenance, malformed stored records and duplicate global identities, permits PCI reuse', () => {
  const p = defaultProject(), site = p.sites[0];
  site.radio.technology = '4G LTE + 5G NR';
  site.cells[0].inventoryIdentity = normalizeInventoryIdentity(draft());
  assert.deepEqual(validateProject(p), []);
  for (const extra of [{ technology: ['NR'] }, { carrierName: '\uFEFFuntrimmed' }, { verification: 'verified' }, { unknown: true }, { pci: true }, { cellId: '0001' }, { mnc: 1 }]) {
    const copy = structuredClone(p); Object.assign(copy.sites[0].cells[0].inventoryIdentity, extra);
    assert.ok(validateProject(copy).some(error => error.includes('identity')));
  }
  site.cells[1].inventoryIdentity = structuredClone(site.cells[0].inventoryIdentity);
  assert.ok(validateInventoryIdentities(p.sites).some(error => error.includes('Duplicate')));
  site.cells[1].inventoryIdentity.mnc = '001';
  assert.deepEqual(validateProject(p), []);
  site.radio.technology = '4G LTE';
  assert.ok(validateProject(p).some(error => error.includes('technology')));
});

test('preserves absent legacy metadata, manifest roundtrips and explicit unverified declarations', () => {
  const old = defaultProject();
  assert.equal(Object.hasOwn(upgradeProject(old).sites[0].cells[0], 'inventoryIdentity'), false);
  const p = defaultProject(); p.sites[0].radio.technology = '5G NR';
  p.sites[0].cells[0].inventoryIdentity = normalizeInventoryIdentity(draft({ cellId: '25' }));
  assert.deepEqual(JSON.parse(createManifest(p)).sites[0].cells[0].inventoryIdentity, p.sites[0].cells[0].inventoryIdentity);
  assert.deepEqual(upgradeProject(p).sites[0].cells[0].inventoryIdentity, p.sites[0].cells[0].inventoryIdentity);
});

test('measurement associations respect the individual cell RAT on mixed sites and preserve source IDs', () => {
  const p = defaultProject(), site = p.sites[0]; site.radio.technology = '4G LTE + 5G NR';
  site.cells[0].inventoryIdentity = normalizeInventoryIdentity(draft({ technology: 'LTE', cellId: '12', pci: '1', arfcn: '100' }));
  const trace = { samples: [{ technology: 'NR', servingCell: 'source-sector', rsrpDbm: -95 }] };
  assert.throws(() => prepareCellIdentity(trace, p.sites, [{ technology: 'NR', sourceCell: 'source-sector', targetCellId: site.cells[0].id }]), /technology/);
  const resolved = prepareCellIdentity(trace, p.sites, [{ technology: 'NR', sourceCell: 'source-sector', targetCellId: site.cells[1].id }]);
  assert.equal(resolveMeasurementCell(resolved, p.sites, trace.samples[0]).status, 'reviewed');
  assert.deepEqual(resolved.samples, trace.samples);
  assert.equal(Object.hasOwn(trace, 'cellIdentity'), false);
});

test('frozen baselines retain declared identities and reject malformed identities even in canonical payloads', async () => {
  let p = defaultProject();
  p.sites[0].cells[0].inventoryIdentity = normalizeInventoryIdentity(draft({ cellId: '13' }));
  p = saveStudyDefinition(p, { objective: 'Inspect street coverage', operator: 'Test declaration', rat: 'NR', carrierMhz: null, windowStart: null, windowEnd: null });
  p = await captureBaseline(p, 'Declared inventory');
  const saved = structuredClone(p.study);
  p.sites[0].cells[0].inventoryIdentity.carrierName = 'Working carrier B';
  assert.deepEqual(p.study, saved); await verifyStudyDigests(p.study);
  assert.equal(JSON.parse(saved.baselines[0].inputJson).inputs.sites[0].cells[0].inventoryIdentity.carrierName, 'Test carrier');
  const value = JSON.parse(p.study.baselines[0].inputJson); value.inputs.sites[0].cells[0].inventoryIdentity.verification = 'verified';
  p.study.baselines[0].inputJson = stableJson(value);
  assert.ok(validateProject(p).some(error => error.includes('identity')));
});
