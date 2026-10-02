import { normalizeInventoryIdentity, validateInventoryIdentities } from './network-cell-identity.mjs';
import { geoToMapPercent } from './model.mjs';
import { stableJson } from './study.mjs';

const field = (label, kind = 'text', units = [null], target = null, min = null, max = null) => ({ label, kind, units, target, min, max });
export const INVENTORY_FIELDS = {
  source_site: field('Source site ID'), source_cell: field('Source cell ID'), technology: field('Cell RAT'),
  site_name: field('Site name', 'text', [null], 'name'), latitude: field('Latitude', 'number', ['deg'], 'latitude', -90, 90),
  longitude: field('Longitude', 'number', ['deg'], 'longitude', -180, 180), height_m: field('Mounting height', 'number', ['m', 'ft', 'cm'], 'heightM', 1, 300),
  manufacturer: field('Manufacturer', 'text', [null], 'manufacturer'), front_end: field('Front end', 'text', [null], 'frontEnd'),
  ru_model: field('RU model', 'text', [null], 'ruModel'), band: field('Band reference', 'text', [null], 'band'),
  azimuth_deg: field('Azimuth', 'number', ['deg', 'rad'], 'azimuthDeg', 0, 359.99999999), downtilt_deg: field('Downtilt', 'number', ['deg', 'rad'], 'downtiltDeg', 0, 30),
  tx_power_dbm: field('Transmit power', 'number', ['dBm', 'W', 'mW'], 'txPowerDbm', 0, 60), bandwidth_mhz: field('Bandwidth', 'number', ['MHz', 'kHz', 'Hz'], 'bandwidthMhz', 5, 400),
  antenna: field('Antenna reference', 'text', [null], 'antenna'), mcc: field('MCC'), mnc: field('MNC'), cell_id: field('NCI / ECI'),
  pci: field('PCI'), arfcn: field('NR-ARFCN / EARFCN'), carrier_name: field('Carrier label'), source_reference: field('Source reference'),
};
const required = ['source_site', 'source_cell', 'technology'];
const siteFields = ['site_name', 'latitude', 'longitude', 'height_m', 'manufacturer', 'front_end', 'ru_model', 'band'];
const cellFields = ['azimuth_deg', 'downtilt_deg', 'tx_power_dbm', 'bandwidth_mhz', 'antenna'];
const bytes = text => new TextEncoder().encode(text).length, object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const sourceKey = row => stableJson([row.sourceSite, row.sourceCell]);
const token = project => stableJson({ sites: project.sites, map: mapScope(project.map), inventoryImports: project.inventoryImports ?? null });
export const inventoryInputToken = token;
const rounded = value => Math.round(value * 1e8) / 1e8;
const mapScope = map => ({ latitude: map?.latitude, longitude: map?.longitude, radiusMeters: map?.radiusMeters });
const hash = async text => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, '0')).join('');
const timestamp = value => { if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('Invalid inventory import time'); };
const reference = (value, max, name) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\x00-\x1f<>]/.test(value)) throw new Error(`Invalid ${name}`);
  return value.trim();
};

/** Strict comma-separated UTF-8 records; raw source remains separate and unchanged. */
export function readInventoryCsv(raw) {
  if (typeof raw !== 'string' || bytes(raw) > 1_000_000) throw new Error('Inventory CSV must be UTF-8 text smaller than 1 MB');
  const text = raw.replace(/^\uFEFF/, ''), rows = []; let row = [], value = '', state = 'bare';
  const finish = () => { row.push(value); if (row.some(item => item.trim())) rows.push(row); row = []; value = ''; state = 'bare'; if (rows.length > 151) throw new Error('Inventory CSV exceeds 150 cell records'); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (state === 'quoted') {
      if (char === '"') { if (text[index + 1] === '"') { value += '"'; index++; } else state = 'closed'; }
      else value += char;
    } else if (char === ',') { row.push(value); value = ''; state = 'bare'; }
    else if (char === '\n') finish();
    else if (char === '\r') { if (text[index + 1] !== '\n') throw new Error('Invalid CSV line ending'); index++; finish(); }
    else if (char === '"' && state === 'bare' && value === '') state = 'quoted';
    else if (state === 'closed' || char === '"') throw new Error('Invalid CSV quoting');
    else value += char;
  }
  if (state === 'quoted') throw new Error('Unterminated CSV quote');
  finish();
  if (rows.length < 2) throw new Error('Inventory CSV requires a header and at least one cell record');
  const headers = rows.shift().map(value => value.trim());
  if (headers.length > 512 || headers.some(name => !name || name.length > 120 || /[\x00-\x1f]/.test(name)) || new Set(headers).size !== headers.length) throw new Error('Inventory CSV requires unique column names');
  if (rows.some(row => row.length !== headers.length)) throw new Error('Inventory CSV column count mismatch');
  return { headers, values: rows };
}

export function inspectInventoryCsv(raw) {
  const { headers, values } = readInventoryCsv(raw);
  return { headers, rowCount: values.length, mapping: Object.fromEntries(Object.entries(INVENTORY_FIELDS).map(([key, spec]) => [key, { column: headers.includes(key) ? key : null, unit: spec.units[0] }])) };
}

export function normalizeInventoryCsv(raw, mapping) {
  const { headers, values } = readInventoryCsv(raw), columns = new Set();
  if (!exact(mapping, Object.keys(INVENTORY_FIELDS))) throw new Error('Invalid inventory column mapping');
  for (const [key, spec] of Object.entries(INVENTORY_FIELDS)) {
    const entry = mapping[key];
    if (!exact(entry, ['column', 'unit']) || !spec.units.includes(entry.unit) || (entry.column !== null && (!headers.includes(entry.column) || columns.has(entry.column)))) throw new Error(`Invalid inventory mapping for ${key}`);
    if (entry.column !== null) columns.add(entry.column);
    if (required.includes(key) && entry.column === null) throw new Error(`Required source mapping: ${key}`);
  }
  for (const pair of [['mcc', 'mnc'], ['latitude', 'longitude']]) if ((mapping[pair[0]].column === null) !== (mapping[pair[1]].column === null)) throw new Error(`Paired inventory mapping required: ${pair.join(' / ')}`);
  const seen = new Set();
  return values.map((values, index) => {
    const source = Object.fromEntries(headers.map((header, column) => [header, values[column]]));
    const get = key => mapping[key].column === null ? undefined : source[mapping[key].column].trim();
    const row = index + 2, sourceSite = reference(get('source_site'), 80, `record ${row} source site`), sourceCell = reference(get('source_cell'), 80, `record ${row} source cell`);
    const technology = ({ LTE: 'LTE', '4G': 'LTE', NR: 'NR', '5G': 'NR' })[get('technology')?.toUpperCase()];
    if (!technology) throw new Error(`Record ${row}: cell technology must be LTE / NR`);
    const key = stableJson([sourceSite, sourceCell]); if (seen.has(key)) throw new Error(`Duplicate source cell at record ${row}`); seen.add(key);
    const number = key => {
      const value = get(key), unit = mapping[key].unit, spec = INVENTORY_FIELDS[key];
      if (!value || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`Record ${row}: ${key} requires a number`);
      let result = Number(value);
      if (unit === 'W' || unit === 'mW') result = result > 0 ? 10 * Math.log10(result * (unit === 'W' ? 1000 : 1)) : NaN;
      else result *= ({ ft: .3048, cm: .01, rad: 180 / Math.PI, kHz: .001, Hz: .000001 }[unit] ?? 1);
      result = rounded(result);
      if (!Number.isFinite(result) || result < spec.min || result > spec.max) throw new Error(`Record ${row}: ${key} outside range`);
      return result;
    };
    const site = {}, cell = {};
    for (const field of [...siteFields, ...cellFields]) {
      if (mapping[field].column === null) continue;
      const spec = INVENTORY_FIELDS[field], target = siteFields.includes(field) ? site : cell;
      target[spec.target] = spec.kind === 'number' ? number(field) : ['ru_model', 'band'].includes(field) && !get(field) ? '' : reference(get(field), field === 'manufacturer' || field === 'site_name' ? 60 : 80, field);
      if (field === 'front_end' && !['Antenna', 'MMU'].includes(target.frontEnd)) throw new Error(`Record ${row}: front end must be Antenna / MMU`);
    }
    const identity = normalizeInventoryIdentity({ technology, mcc: get('mcc') ?? '', mnc: get('mnc') ?? '', cellId: get('cell_id') ?? '', pci: get('pci') ?? '', arfcn: get('arfcn') ?? '', carrierName: get('carrier_name') ?? '', sourceReference: get('source_reference') ?? '' });
    const synthetic = headers.some(header => ['origin', 'provenance'].includes(header.toLowerCase()) && /synthetic/i.test(source[header]));
    return { row, sourceSite, sourceCell, technology, site, cell, identity, synthetic };
  });
}

function mergedSites(beforeSites, map, rows, bindings, importId = null) {
  if (!Array.isArray(beforeSites) || !beforeSites.length || beforeSites.length > 50 || !Array.isArray(bindings) || bindings.length !== rows.length) throw new Error('Invalid inventory targets / existing sites');
  const sites = structuredClone(beforeSites), groups = new Map(), targets = new Set(), bindingMap = new Map();
  for (const binding of bindings) {
    if (!exact(binding, ['sourceSite', 'sourceCell', 'targetCellId', 'newSite']) || typeof binding.newSite !== 'boolean' || (binding.targetCellId !== null && (typeof binding.targetCellId !== 'string' || !/^SITE-\d{2,4}-C[1-3]$/.test(binding.targetCellId))) || (!binding.newSite && binding.targetCellId === null)) throw new Error('Invalid inventory target binding');
    const key = sourceKey(binding); if (bindingMap.has(key) || !rows.some(row => sourceKey(row) === key)) throw new Error('Duplicate or unobserved inventory target'); bindingMap.set(key, binding);
  }
  rows.forEach(row => { const group = groups.get(row.sourceSite) ?? []; group.push(row); groups.set(row.sourceSite, group); });
  const assignedSites = new Set();
  for (const group of groups.values()) {
    if (group.some(row => stableJson(row.site) !== stableJson(group[0].site))) throw new Error(`Conflicting site fields for ${group[0].sourceSite}`);
    const links = group.map(row => bindingMap.get(sourceKey(row))); if (links.some(link => !link)) throw new Error('Review every source cell target');
    const creating = links.every(link => link.newSite); let site;
    if (creating) {
      if (group.length !== 3) throw new Error('New sites require three supplied sector records');
      if (sites.length >= 50) throw new Error('Site inventory limit reached (50)');
      for (const key of ['latitude', 'longitude', 'heightM', 'manufacturer', 'frontEnd']) if (!Object.hasOwn(group[0].site, key)) throw new Error(`New site requires ${key}`);
      for (const row of group) for (const key of ['azimuthDeg', 'downtiltDeg', 'txPowerDbm', 'bandwidthMhz']) if (!Object.hasOwn(row.cell, key)) throw new Error(`New cell requires ${key}`);
      const number = Math.max(...sites.map(site => Number(site.id?.slice(5)))) + 1;
      if (!Number.isInteger(number) || number > 9999) throw new Error('No stable project site ID available');
      const id = `SITE-${String(number).padStart(2, '0')}`;
      site = { id, name: group[0].site.name ?? group[0].sourceSite, heightM: group[0].site.heightM, x: 50, y: 50, frontEnd: group[0].site.frontEnd,
        radio: { manufacturer: group[0].site.manufacturer, technology: '5G NR', ruModel: '', band: '', mmuModel: '', mmuElements: null, beamformingProfile: '' },
        radioLocation: { latitude: null, longitude: null, source: 'unassigned' }, cells: group.map((row, index) => ({ id: `${id}-C${index + 1}`, antenna: row.cell.antenna ?? 'Unspecified reference', ...row.cell })) };
      sites.push(site); links.forEach((link, index) => { if (link.targetCellId !== null && link.targetCellId !== site.cells[index].id) throw new Error('New inventory target IDs changed'); link.targetCellId = site.cells[index].id; });
    } else {
      if (links.some(link => link.newSite)) throw new Error('Use existing targets or create the whole source site');
      const matches = sites.filter(site => links.some(link => site.cells?.some(cell => cell.id === link.targetCellId)));
      if (matches.length !== 1 || !links.every(link => matches[0].cells.some(cell => cell.id === link.targetCellId))) throw new Error('Source site must resolve to one existing project site');
      site = matches[0];
    }
    if (assignedSites.has(site.id)) throw new Error('Multiple source sites target the same project site'); assignedSites.add(site.id);
    const input = group[0].site;
    for (const key of ['name', 'heightM', 'frontEnd']) if (Object.hasOwn(input, key)) site[key] = input[key];
    for (const key of ['manufacturer', 'ruModel', 'band']) if (Object.hasOwn(input, key)) site.radio[key] = input[key];
    if (Object.hasOwn(input, 'latitude')) {
      const point = geoToMapPercent(map, input.latitude, input.longitude);
      site.x = rounded(point.x); site.y = rounded(point.y); site.radioLocation = { latitude: input.latitude, longitude: input.longitude, source: 'manual' };
    }
    const updated = new Set(links.map(link => link.targetCellId)), rats = new Set(group.map(row => row.technology));
    for (const cell of site.cells.filter(cell => !updated.has(cell.id))) {
      if (cell.inventoryIdentity) rats.add(cell.inventoryIdentity.technology);
      else { if (site.radio.technology !== '4G LTE') rats.add('NR'); if (site.radio.technology !== '5G NR') rats.add('LTE'); }
    }
    site.radio.technology = rats.size > 1 ? '4G LTE + 5G NR' : rats.has('NR') ? '5G NR' : '4G LTE';
    group.forEach((row, index) => {
      const link = links[index]; if (targets.has(link.targetCellId)) throw new Error('Duplicate inventory target cell'); targets.add(link.targetCellId);
      const cell = site.cells.find(cell => cell.id === link.targetCellId); Object.assign(cell, row.cell); cell.inventoryIdentity = structuredClone(row.identity);
      if (importId !== null) cell.inventorySource = { importId, row: row.row }; else delete cell.inventorySource;
    });
  }
  const errors = validateInventoryIdentities(sites); if (errors.length) throw new Error(errors[0]);
  return sites;
}

const payloadKeys = ['schemaVersion', 'fileName', 'namespace', 'sourceDate', 'origin', 'verification', 'rawCsv', 'sourceSha256', 'mapping', 'rows', 'bindings', 'map', 'beforeSites'];
function parsedRecord(record) {
  if (!exact(record, ['id', 'version', 'importedAt', 'inputJson', 'sha256']) || !Number.isInteger(record.version) || record.version < 1 || typeof record.inputJson !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '') || record.id !== `inventory-${record.sha256}`) throw new Error('Invalid retained inventory record');
  timestamp(record.importedAt); const data = JSON.parse(record.inputJson);
  if (!exact(data, payloadKeys) || data.schemaVersion !== 1 || data.verification !== 'unverified' || !['unknown', 'synthetic', 'operator-declared'].includes(data.origin)
    || reference(data.fileName, 80, 'inventory file name') !== data.fileName || /[/\\]/.test(data.fileName) || reference(data.namespace, 80, 'source namespace') !== data.namespace
    || typeof data.sourceDate !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(data.sourceDate) || !Number.isFinite(Date.parse(data.sourceDate)) || new Date(data.sourceDate).toISOString().slice(0, 10) !== data.sourceDate
    || data.sourceDate > record.importedAt.slice(0, 10) || !/^[a-f0-9]{64}$/.test(data.sourceSha256 ?? '') || stableJson(data) !== record.inputJson
    || !exact(data.map, ['latitude', 'longitude', 'radiusMeters'])) throw new Error('Invalid retained inventory source / provenance');
  const rows = normalizeInventoryCsv(data.rawCsv, data.mapping);
  if (stableJson(rows) !== stableJson(data.rows) || (rows.some(row => row.synthetic) && data.origin !== 'synthetic')) throw new Error('Inventory normalization does not replay the retained source');
  mergedSites(data.beforeSites, data.map, rows, structuredClone(data.bindings), record.id);
  return data;
}

function validateReferences(sites, records) {
  for (const site of sites ?? []) for (const cell of site.cells ?? []) {
    if (!Object.hasOwn(cell, 'inventorySource')) continue;
    const ref = cell.inventorySource, record = records.find(record => record.id === ref?.importId);
    if (!exact(ref, ['importId', 'row']) || !Number.isInteger(ref.row) || !record || !JSON.parse(record.inputJson).bindings.some(binding => binding.targetCellId === cell.id && JSON.parse(record.inputJson).rows.find(row => sourceKey(row) === sourceKey(binding))?.row === ref.row)) throw new Error('Missing or mismatched retained inventory source');
  }
}

export function validateInventoryImports(project) {
  try {
    const library = project?.inventoryImports;
    if (library === undefined) { validateReferences(project?.sites, []); return []; }
    if (!exact(library, ['schemaVersion', 'records']) || library.schemaVersion !== 1 || !Array.isArray(library.records) || !library.records.length || library.records.length > 20 || bytes(JSON.stringify(library)) > 2_000_000) throw new Error('Inventory sources require 1–20 records within 2 MB');
    const ids = new Set();
    library.records.forEach((record, index) => { const data = parsedRecord(record); if (record.version !== index + 1 || ids.has(record.id)) throw new Error('Invalid inventory source order'); validateReferences(data.beforeSites, library.records.slice(0, index)); ids.add(record.id); });
    validateReferences(project.sites, library.records);
    return [];
  } catch (cause) { return [`Inventory: ${cause.message}`]; }
}

export async function verifyInventoryImports(project) {
  const errors = validateInventoryImports(project); if (errors.length) throw new Error(errors[0]);
  for (const record of project?.inventoryImports?.records ?? []) {
    const data = parsedRecord(record);
    if (await hash(record.inputJson) !== record.sha256 || await hash(data.rawCsv) !== data.sourceSha256) throw new Error('Retained inventory SHA-256 does not match its source');
  }
}

function differences(before, after) {
  const changes = [];
  for (const site of after) {
    const original = before.find(item => item.id === site.id);
    if (!original) { changes.push({ siteId: site.id, cellId: null, field: 'newSite', before: null, after: site }); continue; }
    for (const key of ['name', 'heightM', 'frontEnd', 'radioLocation', 'radio']) if (stableJson(original[key]) !== stableJson(site[key])) changes.push({ siteId: site.id, cellId: null, field: key, before: original[key], after: site[key] });
    for (const cell of site.cells) { const old = original.cells.find(item => item.id === cell.id); for (const key of [...Object.keys(cell).filter(key => !['id', 'inventorySource'].includes(key))]) if (stableJson(old?.[key] ?? null) !== stableJson(cell[key])) changes.push({ siteId: site.id, cellId: cell.id, field: key, before: old?.[key] ?? null, after: cell[key] }); }
  }
  return changes;
}

export async function prepareInventoryImport(project, options, bindings, { now = () => new Date().toISOString() } = {}) {
  await verifyInventoryImports(project);
  const fileName = reference(options.fileName, 80, 'inventory file name'), namespace = reference(options.namespace, 80, 'source namespace');
  if (/[/\\]/.test(fileName)) throw new Error('Inventory file name must not contain a path');
  const importedAt = typeof now === 'function' ? now() : now; timestamp(importedAt);
  if (!Array.isArray(bindings)) throw new Error('Review every source cell target');
  const rows = normalizeInventoryCsv(options.rawCsv, options.mapping), resolved = bindings.map(binding => {
    if (!exact(binding, ['sourceSite', 'sourceCell', 'targetCellId'])) throw new Error('Invalid inventory target binding');
    return { ...binding, newSite: binding.targetCellId === null };
  });
  mergedSites(project.sites, project.map, rows, resolved);
  const data = { schemaVersion: 1, fileName, namespace, sourceDate: options.sourceDate, origin: rows.some(row => row.synthetic) ? 'synthetic' : options.origin,
    verification: 'unverified', rawCsv: options.rawCsv, sourceSha256: await hash(options.rawCsv), mapping: structuredClone(options.mapping), rows, bindings: resolved,
    map: mapScope(project.map), beforeSites: structuredClone(project.sites) };
  const inputJson = stableJson(data), sha256 = await hash(inputJson), record = { id: `inventory-${sha256}`, version: (project.inventoryImports?.records.length ?? 0) + 1, importedAt, inputJson, sha256 };
  parsedRecord(record);
  const sites = mergedSites(project.sites, project.map, rows, structuredClone(resolved), record.id);
  return { record, sites, changes: differences(project.sites, sites), inputToken: token(project) };
}

export function applyInventoryImport(project, prepared) {
  if (token(project) !== prepared.inputToken) throw new Error('Inventory or map scope changed during import review. Validate the latest inputs.');
  const data = parsedRecord(prepared.record), sites = mergedSites(project.sites, project.map, data.rows, structuredClone(data.bindings), prepared.record.id);
  if (stableJson(sites) !== stableJson(prepared.sites)) throw new Error('Reviewed inventory differs from retained source');
  const next = structuredClone(project); next.sites = sites;
  next.inventoryImports ??= { schemaVersion: 1, records: [] }; next.inventoryImports.records.push(structuredClone(prepared.record));
  const errors = validateInventoryImports(next); if (errors.length) throw new Error(errors[0]);
  if (bytes(JSON.stringify(next, null, 2)) > 3_000_000) throw new Error('Project snapshot exceeds 3 MB');
  return next;
}

export function assertInventoryTransition(previous, next) {
  if (!previous) return;
  const before = previous.inventoryImports?.records ?? [], after = next?.inventoryImports?.records ?? [];
  if (after.length < before.length || before.some((record, index) => stableJson(record) !== stableJson(after[index]))) throw new Error('Original inventory sources must remain retained and unchanged');
  if (after.length === before.length) return;
  if (after.length !== before.length + 1) throw new Error('Apply one reviewed inventory import per save');
  const record = after.at(-1), data = parsedRecord(record);
  if (stableJson(data.beforeSites) !== stableJson(previous.sites) || stableJson(data.map) !== stableJson(mapScope(previous.map))
    || stableJson(mergedSites(previous.sites, previous.map, data.rows, structuredClone(data.bindings), record.id)) !== stableJson(next.sites)) throw new Error('Retained inventory source does not match the applied network changes');
}
