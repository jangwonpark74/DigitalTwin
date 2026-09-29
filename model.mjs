import { defaultUseCases, validateUseCases, drivePlan, abPlan, datasetPlan } from './usecases.mjs';
import { defaultTasks, validateTasks, schedulePlan } from './tasks.mjs';
import { defaultManagement, validateManagement, sanitizeManagement, managementSnapshot, upgradeManagement } from './management.mjs';

const clone = value => structuredClone(value);
const round = value => Math.round(value * 10) / 10;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

function cells(siteId) {
  return [0, 120, 240].map((azimuth, i) => ({ id: `${siteId}-C${i + 1}`, azimuthDeg: azimuth,
    txPowerDbm: 43, downtiltDeg: 6, bandwidthMhz: 100, antenna: '8×8 virtual array' }));
}

export function defaultProject() {
  return {
    schemaVersion: 1, name: 'RAN Twin · City Pilot', scenario: 'baseline',
    map: { city: 'Example City', cluster: 'Central cluster', latitude: 37.5665, longitude: 126.978,
      radiusMeters: 1200, source: 'OpenStreetMap', sceneFile: '', geometryValidated: false,
      materialAssigned: false, coordinateAligned: false },
    runtime: { host: 'GH200', gpu: 'H200', cpu: 'Grace CPU', status: 'not-connected' },
    integration: { connected: false, vCoreEndpoint: '', vDUEndpoint: '', protocol: 'not-configured' },
    architecture: {
      vCore: { kind: 'physical', label: 'vCore · real NE' },
      vDU: { kind: 'physical', label: 'vDU · real NE' },
      ru: { kind: 'virtual', label: 'O-RAN RU · virtual' },
      antenna: { kind: 'virtual', label: 'Antenna / MMU · virtual' },
      ue: { kind: 'virtual-cpu', label: 'Software UE · Grace CPU' },
    },
    channel: { engine: 'Sionna-RT', execution: 'planned-not-executed', maxDepth: 4,
      reflections: true, diffraction: false, blockage: 12 },
    ue: { count: 1200, mobility: 'Urban pedestrian', seed: 42 },
    useCases: defaultUseCases(),
    tasks: defaultTasks(),
    management: defaultManagement(),
    sites: [
      { id: 'SITE-01', name: 'Civic Square', x: 31, y: 35, heightM: 28, frontEnd: 'Antenna', cells: cells('SITE-01') },
      { id: 'SITE-02', name: 'River Bridge', x: 68, y: 31, heightM: 36, frontEnd: 'MMU', cells: cells('SITE-02') },
      { id: 'SITE-03', name: 'Market Street', x: 54, y: 71, heightM: 24, frontEnd: 'Antenna', cells: cells('SITE-03') },
    ],
  };
}

export function validateProject(p) {
  const errors = [];
  if (p?.schemaVersion !== 1) errors.push('Unsupported schema version');
  if (!p?.map || !Number.isFinite(p.map.latitude) || p.map.latitude < -90 || p.map.latitude > 90) errors.push('Invalid map latitude');
  if (!p?.map || !Number.isFinite(p.map.longitude) || p.map.longitude < -180 || p.map.longitude > 180) errors.push('Invalid map longitude');
  if (!p?.map || !Number.isFinite(p.map.radiusMeters) || p.map.radiusMeters < 100 || p.map.radiusMeters > 20000) errors.push('Invalid map radius');
  if (!p?.map || typeof p.map.city !== 'string' || !p.map.city.trim() || typeof p.map.cluster !== 'string' || !p.map.cluster.trim()) errors.push('City and cluster are required');
  if (p?.map?.source !== 'OpenStreetMap') errors.push('Unsupported map source');
  if (p?.runtime?.host !== 'GH200' || p.runtime.gpu !== 'H200' || p.runtime.cpu !== 'Grace CPU') errors.push('Runtime must specify GH200 / H200 / Grace CPU');
  if (p?.architecture?.vCore?.kind !== 'physical' || p?.architecture?.vDU?.kind !== 'physical' || p?.architecture?.ru?.kind !== 'virtual' || p?.architecture?.ue?.kind !== 'virtual-cpu') errors.push('Physical / virtual RAN boundary invalid');
  if (p?.channel?.engine !== 'Sionna-RT' || !Number.isInteger(p.channel.maxDepth) || p.channel.maxDepth < 1 || p.channel.maxDepth > 12) errors.push('Invalid Sionna-RT configuration');
  if (!Number.isFinite(p?.channel?.blockage) || p.channel.blockage < 0 || p.channel.blockage > 80) errors.push('Invalid blockage percentage');
  if (!Number.isInteger(p?.ue?.count) || p.ue.count < 1 || p.ue.count > 50000) errors.push('Invalid UE count');
  if (!Array.isArray(p?.sites) || p.sites.length === 0 || p.sites.length > 50) errors.push('Site inventory must contain 1–50 sites');
  const siteIds = new Set(), cellIds = new Set();
  for (const site of Array.isArray(p?.sites) ? p.sites : []) {
    if (typeof site.id !== 'string' || !/^SITE-\d{2,4}$/.test(site.id) || siteIds.has(site.id)) errors.push(`Duplicate or invalid site ${site.id}`);
    siteIds.add(site.id);
    if (typeof site.name !== 'string' || !site.name.trim() || ![site.x, site.y].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) errors.push(`Invalid location for ${site.id}`);
    if (!Number.isFinite(site.heightM) || site.heightM < 1 || site.heightM > 300) errors.push(`Invalid height for ${site.id}`);
    if (!['Antenna', 'MMU'].includes(site.frontEnd)) errors.push(`Invalid front end for ${site.id}`);
    if (!Array.isArray(site.cells) || site.cells.length !== 3) errors.push(`Site ${site.id} requires three sectors`);
    for (const cell of Array.isArray(site.cells) ? site.cells : []) {
      if (typeof cell.id !== 'string' || !/^SITE-\d{2,4}-C[1-3]$/.test(cell.id) || !cell.id.startsWith(`${site.id}-C`) || cellIds.has(cell.id)) errors.push(`Duplicate cell ${cell.id}`);
      cellIds.add(cell.id);
      if (!Number.isFinite(cell.txPowerDbm) || cell.txPowerDbm < 0 || cell.txPowerDbm > 60) errors.push(`Invalid Tx power for ${cell.id}`);
      if (!Number.isFinite(cell.downtiltDeg) || cell.downtiltDeg < 0 || cell.downtiltDeg > 30) errors.push(`Invalid downtilt for ${cell.id}`);
      if (!Number.isFinite(cell.azimuthDeg) || cell.azimuthDeg < 0 || cell.azimuthDeg >= 360) errors.push(`Invalid azimuth for ${cell.id}`);
      if (!Number.isFinite(cell.bandwidthMhz) || cell.bandwidthMhz < 5 || cell.bandwidthMhz > 400) errors.push(`Invalid bandwidth for ${cell.id}`);
    }
  }
  errors.push(...validateUseCases(p?.useCases));
  errors.push(...validateTasks(p?.tasks));
  errors.push(...validateManagement(p?.management));
  return errors;
}

export function upgradeProject(p) {
  if (!p || typeof p !== 'object') return p;
  const next = clone(p);
  if (!next.useCases) next.useCases = defaultUseCases();
  if (!next.tasks) next.tasks = defaultTasks();
  next.management = upgradeManagement(next.management);
  return next;
}

export function simulatePreview(p) {
  const cells = p.sites.flatMap(s => s.cells);
  const avgPower = cells.reduce((sum, c) => sum + c.txPowerDbm, 0) / cells.length;
  const tiltPenalty = cells.reduce((sum, c) => sum + Math.abs(c.downtiltDeg - 6), 0) / cells.length;
  const blockage = p.channel.blockage;
  const coveragePercent = round(clamp(71 + (p.sites.length - 3) * 3.2 + (avgPower - 43) * 1.2 - tiltPenalty * 0.8 - blockage * 0.45, 0, 99));
  const capacityPressure = round(clamp(p.ue.count / (p.sites.length * 3 * 220) * 100, 0, 999));
  const avgSinrProxy = round(19 + (avgPower - 43) * 0.25 - blockage * 0.2 - Math.max(0, capacityPressure - 75) * 0.04);
  return { method: 'ILLUSTRATIVE_ONLY_NOT_RAY_TRACING', coveragePercent, capacityPressure,
    avgSinrProxy, estimatedUes: p.ue.count, cells: cells.length, siteCount: p.sites.length };
}

export function applyScenario(p, name) {
  const next = clone(p);
  next.scenario = name;
  if (name === 'baseline') { next.channel.blockage = 12; next.ue.count = 1200; }
  else if (name === 'blockage') { next.channel.blockage = 48; next.ue.count = 1200; }
  else if (name === 'ue-surge') { next.channel.blockage = 12; next.ue.count = 3400; }
  else if (name === 'clear-line') { next.channel.blockage = 2; next.ue.count = 1200; }
  else throw new Error(`Unknown scenario: ${name}`);
  return next;
}

export function addSite(p, location) {
  if (typeof location?.name !== 'string' || !location.name.trim()) throw new Error('Site name required');
  if (![location.x, location.y].every(v => Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error('Site map position must be between 0 and 100');
  const next = clone(p);
  const id = `SITE-${String(Math.max(0, ...next.sites.map(s => Number(s.id.replace('SITE-', '')) || 0)) + 1).padStart(2, '0')}`;
  next.sites.push({ id, name: location.name.trim(), x: location.x, y: location.y, heightM: 30,
    frontEnd: 'Antenna', cells: cells(id) });
  return next;
}

export function sanitizeProject(p) {
  const next = clone(p);
  next.map.geometryValidated = false;
  next.map.coordinateAligned = false;
  next.map.materialAssigned = false;
  next.runtime.status = 'not-connected';
  next.integration.connected = false;
  next.channel.execution = 'planned-not-executed';
  next.tasks = next.tasks.map(t=>({...t,status:'planned',execution:'not-executed'}));
  next.management = sanitizeManagement(next.management);
  return next;
}

export function readiness(p) {
  const checks = [
    { id: 'map', label: 'City / cluster and coordinates configured', done: validateProject(p).length === 0 },
    { id: 'geometry', label: 'OSM geometry imported and coordinate reference validated', done: false },
    { id: 'materials', label: 'Buildings / terrain assigned RF materials', done: false },
    { id: 'antenna', label: 'Virtual RU, antenna / MMU patterns calibrated', done: false },
    { id: 'runtime', label: 'GH200 Grace CPU + H200 GPU runtime verified', done: false },
    { id: 'integration', label: 'Real vCore / vDU test endpoints verified', done: false },
  ];
  return { checks, readyForRayTracing: false };
}

export function createManifest(p) {
  const errors = validateProject(p);
  if (errors.length) throw new Error(errors.join('; '));
  const safe = sanitizeProject(p);
  return JSON.stringify({ schemaVersion: 1, exportedAt: new Date().toISOString(), project: safe.name,
    map: safe.map, runtime: safe.runtime, integration: safe.integration, architecture: safe.architecture,
    channel: safe.channel, ue: safe.ue, sites: safe.sites, preview: simulatePreview(safe), readiness: readiness(safe),
    useCaseConfig: safe.useCases,
    useCases: { drive: drivePlan(safe), ab: abPlan(safe), data: datasetPlan(safe) },
    tasks: safe.tasks, schedule: schedulePlan(safe.tasks),
    management: safe.management, monitoring: managementSnapshot(safe.management),
    note: 'Planning manifest only. No real network connection, OSM scene import, Sionna-RT execution, scheduled task dispatch, hardware discovery, software installation, telemetry collection, A/B run, drive measurement, or dataset generation was performed.' }, null, 2);
}
