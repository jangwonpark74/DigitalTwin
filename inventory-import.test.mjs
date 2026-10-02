import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultProject, validateProject, createManifest } from './model.mjs';
import { INVENTORY_FIELDS, inspectInventoryCsv, normalizeInventoryCsv, prepareInventoryImport, applyInventoryImport, validateInventoryImports, verifyInventoryImports, assertInventoryTransition } from './inventory-import.mjs';
import { saveStudyDefinition, captureBaseline, engineeringInputs, verifyStudyDigests } from './study.mjs';
import { buildArtifactTree, listArtifactFiles, applyArtifactJson } from './artifacts.mjs';

const csv = '\uFEFFsource_site,source_cell,technology,mcc,mnc,cell_id,pci,arfcn,carrier_name\r\nVendor-A,Sector-X,NR,001,01,0xABC,0,630000,"Trial, carrier"\r\n';
const options = (rawCsv = csv) => ({ rawCsv, fileName: 'inventory.csv', namespace: 'Test operator inventory', sourceDate: '2026-10-01', origin: 'operator-declared', mapping: inspectInventoryCsv(rawCsv).mapping });
const bindings = [{ sourceSite: 'Vendor-A', sourceCell: 'Sector-X', targetCellId: 'SITE-01-C2' }];

test('normalizes mapped CSV with exact raw-source retention and nullable identity fields', async () => {
  const mapped = { ...inspectInventoryCsv(csv).mapping, carrier_name: { column: 'carrier_name', unit: null } };
  const rows = normalizeInventoryCsv(csv, mapped);
  assert.equal(rows[0].sourceCell, 'Sector-X'); assert.equal(rows[0].identity.mnc, '01'); assert.equal(rows[0].identity.cellId, '2748');
  assert.equal(rows[0].identity.pci, 0); assert.equal(rows[0].identity.sourceReference, null);
  const prepared = await prepareInventoryImport(defaultProject(), { ...options(), mapping: mapped }, bindings);
  const payload = JSON.parse(prepared.record.inputJson);
  assert.equal(payload.rawCsv, csv); assert.equal(payload.verification, 'unverified'); assert.equal(payload.rows[0].identity.carrierName, 'Trial, carrier');
  assert.match(payload.sourceSha256, /^[a-f0-9]{64}$/); assert.equal(payload.bindings[0].targetCellId, 'SITE-01-C2');
});

test('rejects malformed source rows, duplicate IDs, unsupported mappings and incomplete identity pairs', () => {
  for (const raw of ['source_site,source_site,technology\nA,B,NR', 'source_site,source_cell,technology\nA,B,"NR"x',
    'source_site,source_cell,technology\nA,B,NR\nA,B,LTE', 'source_site,source_cell,technology,pci\nA,B,NR,1008',
    'source_site,source_cell,technology,mcc\nA,B,NR,001']) assert.throws(() => normalizeInventoryCsv(raw, inspectInventoryCsv(raw).mapping));
  const mapping = inspectInventoryCsv(csv).mapping; mapping.pci.unit = 'dBm';
  assert.throws(() => normalizeInventoryCsv(csv, mapping), /mapping/);
  assert.equal(Object.keys(INVENTORY_FIELDS).length > 15, true);
});

test('updates only reviewed cells, exposes exact changes and keeps unrelated RF, sources and studies', async () => {
  const p = defaultProject(), before = structuredClone(p);
  const prepared = await prepareInventoryImport(p, options(), bindings), next = applyInventoryImport(p, prepared);
  assert.deepEqual(p, before); assert.deepEqual(next.sites[0].cells[0], p.sites[0].cells[0]);
  assert.equal(next.sites[0].cells[1].inventoryIdentity.cellId, '2748');
  assert.equal(next.sites[0].cells[1].inventorySource.importId, prepared.record.id);
  assert.equal(prepared.changes.some(change => change.field === 'inventoryIdentity' && change.cellId === 'SITE-01-C2'), true);
  assert.deepEqual(next.driveMeasurements, p.driveMeasurements); assert.deepEqual(validateProject(next), []);
  assert.equal(JSON.parse(createManifest(next)).inventoryImports.records[0].inputJson, prepared.record.inputJson);
  const changed = structuredClone(p); changed.sites[0].heightM++;
  assert.throws(() => applyInventoryImport(changed, prepared), /changed/);
});

test('creates supplied three-sector sites with stable project IDs and rejects missing engineering fields', async () => {
  const p = defaultProject(), latitude = p.map.latitude, longitude = p.map.longitude;
  const header = 'source_site,source_cell,technology,site_name,latitude,longitude,height_m,manufacturer,front_end,azimuth_deg,downtilt_deg,tx_power_dbm,bandwidth_mhz';
  const raw = `${header}\nNew-A,a,NR,Test site,${latitude},${longitude},30,Test vendor,Antenna,0,6,43,100\nNew-A,b,NR,Test site,${latitude},${longitude},30,Test vendor,Antenna,120,6,43,100\nNew-A,c,LTE,Test site,${latitude},${longitude},30,Test vendor,Antenna,240,6,43,20`;
  const rows = normalizeInventoryCsv(raw, inspectInventoryCsv(raw).mapping), targets = rows.map(row => ({ sourceSite: row.sourceSite, sourceCell: row.sourceCell, targetCellId: null }));
  const prepared = await prepareInventoryImport(p, options(raw), targets), next = applyInventoryImport(p, prepared), site = next.sites.at(-1);
  assert.equal(site.id, 'SITE-04'); assert.equal(site.radio.technology, '4G LTE + 5G NR'); assert.equal(site.radio.manufacturer, 'Test vendor');
  assert.deepEqual(site.cells.map(cell => cell.id), ['SITE-04-C1', 'SITE-04-C2', 'SITE-04-C3']);
  assert.deepEqual(validateProject(next), []);
  await assert.rejects(() => prepareInventoryImport(p, options(raw.split('\n').slice(0, 3).join('\n')), targets.slice(0, 2)), /three/);
  await assert.rejects(() => prepareInventoryImport(p, options(raw.replace(/,30,/g, ',,')), targets), /height/);
});

test('retains immutable source versions and frozen inventory provenance, rejects tampering through generic JSON edits', async () => {
  let p = applyInventoryImport(defaultProject(), await prepareInventoryImport(defaultProject(), options(), bindings));
  p = saveStudyDefinition(p, { objective: 'Inventory provenance', operator: 'Test declaration', rat: 'NR', carrierMhz: null, windowStart: null, windowEnd: null });
  p = await captureBaseline(p, 'Imported inventory'); const frozen = structuredClone(p.study);
  const next = applyInventoryImport(p, await prepareInventoryImport(p, options(csv.replace('0xABC', '0xABD')), bindings));
  assert.equal(next.inventoryImports.records.length, 2); assert.deepEqual(next.study, frozen);
  assert.equal(engineeringInputs(next).inventoryImports.records.length, 2);
  assert.equal(JSON.parse(frozen.baselines[0].inputJson).inputs.inventoryImports.records.length, 1);
  await verifyInventoryImports(next); await verifyStudyDigests(next.study);
  const files = listArtifactFiles(buildArtifactTree(next));
  assert.equal(files.find(file => file.id === 'inventory-1-source').content, csv);
  const edited = structuredClone(next); edited.inventoryImports.records[0].inputJson += ' ';
  assert.ok(validateInventoryImports(edited).length);
  assert.throws(() => assertInventoryTransition(next, { ...next, inventoryImports: undefined }), /retained/);
  const omitted = structuredClone(next); delete omitted.inventoryImports;
  assert.throws(() => applyArtifactJson(next, 'project-config', JSON.stringify(omitted)));
});

test('forces synthetic source markers to remain synthetic and rejects duplicate targets or global identities', async () => {
  const raw = csv.replace('carrier_name\r\n', 'carrier_name,provenance\r\n').replace('"Trial, carrier"\r\n', '"Trial, carrier",synthetic\r\n');
  const prepared = await prepareInventoryImport(defaultProject(), options(raw), bindings);
  assert.equal(JSON.parse(prepared.record.inputJson).origin, 'synthetic');
  const duplicate = csv + 'Vendor-A,Sector-Y,NR,001,01,0xABC,0,630000,Second\r\n';
  await assert.rejects(() => prepareInventoryImport(defaultProject(), options(duplicate), [...bindings, { ...bindings[0], sourceCell: 'Sector-Y' }]), /target/);
  await assert.rejects(() => prepareInventoryImport(defaultProject(), options(duplicate), [...bindings, { ...bindings[0], sourceCell: 'Sector-Y', targetCellId: 'SITE-01-C3' }]), /Duplicate/);
});
