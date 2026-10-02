// Cross-language fixture for nullable GPS measurements and retained normalization identity.
import { defaultProject } from '../../model.mjs';
import { inspectDmCsv, parseDmCsv } from '../../dm.mjs';
import { buildDriveMeasurements } from '../../drive-measurements.mjs';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceArtifactIndex } from '../../artifacts.mjs';
import { stableJson, saveStudyDefinition, captureBaseline } from '../../study.mjs';
import { createHash } from 'node:crypto';
const rawCsv = '\uFEFFElapsed,RAT,Cell,Lat,Lon,Power,Download\n0,5G,A,37.5,127,-120,7.5e6\n1500,NR,A,37.501,127.001,N/A,0\n3000,LTE,B,37.502,127.002,-90,';
const mapping = { ...inspectDmCsv(rawCsv).mapping, time_s: { column: 'Elapsed', unit: 'ms' }, technology: { column: 'RAT', unit: null },
  serving_cell: { column: 'Cell', unit: null }, latitude: { column: 'Lat', unit: 'degrees' }, longitude: { column: 'Lon', unit: 'degrees' },
  rsrp_dbm: { column: 'Power', unit: 'dBm' }, dl_mbps: { column: 'Download', unit: 'bps' } };
const measurements = buildDriveMeasurements(parseDmCsv(rawCsv, { mapping }), 'vendor.csv');
const sha256 = createHash('sha256').update(rawCsv).digest('hex');
const transformations = [{ type: 'mapped-gps-csv-parse', version: 2, mapping }];
const normalizationSha256 = createHash('sha256').update(stableJson({ sourceSha256: sha256, transformations })).digest('hex');
measurements.evidence = { schemaVersion: 2, datasetId: `sha256-${normalizationSha256}`, sha256, normalizationSha256, origin: 'unknown', verification: 'unverified',
  rawCsv, sourceDate: null, importedAt: '2026-10-02T00:00:00Z', coordinateReference: 'EPSG:4326', transformations };
let project = { ...defaultProject(), driveMeasurements: measurements };
project = saveStudyDefinition(project, { objective: 'Partial measurements', operator: 'Unknown', rat: 'ALL' });
project = await captureBaseline(project, 'Partial source baseline', { id: 'baseline-1' });
const workspace = createWorkspaceState(project, { id: 'pilot' });
process.stdout.write(JSON.stringify({ workspace, artifacts: workspaceArtifactIndex(workspace) }));
