// Cross-language wire fixture: the Python store verifies captures prepared by the JS domain.
import { defaultProject } from '../../model.mjs';
import { parseGeoJsonScene } from '../../scene.mjs';
import { saveStudyDefinition, captureBaseline, createCandidate, reviseCandidate, stableJson } from '../../study.mjs';
import { prepareStudyRun, resolveRunInputs } from '../../study-run.mjs';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceArtifactIndex } from '../../artifacts.mjs';
import { createHash } from 'node:crypto';
import { buildDriveMeasurements } from '../../drive-measurements.mjs';
import { parseDmCsv } from '../../dm.mjs';
const now = () => '2026-10-02T01:00:00.000Z';
const project = defaultProject();
project.driveMeasurements = buildDriveMeasurements(parseDmCsv('time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,NR,SITE-01-C1,37.5665,126.978,-100,-12,5,30,4\n1,NR,SITE-01-C1,37.5666,126.9781,-110,-14,0,12,2'), 'synthetic-fixture.csv');
Object.assign(project.sites[0].radioLocation, { latitude: project.map.latitude, longitude: project.map.longitude, source: 'manual' });
project.map.scene = parseGeoJsonScene({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { height: 12 },
  geometry: { type: 'Polygon', coordinates: [[[126.9782, 37.5665], [126.9784, 37.5665], [126.9784, 37.5667], [126.9782, 37.5665]]] } }] }, { fileName: 'scene.geojson', importedAt: now() });
let saved = saveStudyDefinition(project, { objective: 'Height path sensitivity', operator: 'Unverified fixture', rat: 'NR', carrierMhz: 3500 }, { now });
saved = await captureBaseline(saved, 'Baseline', { id: 'baseline-1', now });
saved = await createCandidate(saved, 'baseline-1', 'Height candidate', '', { id: 'candidate-1', now });
saved = await reviseCandidate(saved, 'candidate-1', 1, [{ siteId: 'SITE-01', field: 'heightM', after: 35 }], { now });
const receiver = { latitude: 37.5666, longitude: 126.9781, heightM: 1.5 };
const candidateJob = await prepareStudyRun(saved, { kind: 'candidate', candidateId: 'candidate-1', version: 2 }, 'SITE-01', receiver, {}, { now });
const workingJob = await prepareStudyRun(saved, { kind: 'working' }, 'SITE-01', receiver, {}, { now });
saved = await reviseCandidate(saved, 'candidate-1', 2, [{ siteId: 'SITE-01', field: 'heightM', after: 35 },
  { siteId: 'SITE-01', cellId: 'SITE-01-C1', field: 'downtiltDeg', after: 8 }], { now });
const unsupportedJob = structuredClone(candidateJob);
const resolved = resolveRunInputs(saved, { kind: 'candidate', candidateId: 'candidate-1', version: 3 });
Object.assign(unsupportedJob.runCapture, { reference: resolved.reference, candidateSha256: resolved.revision.sha256,
  networkInputJson: stableJson(resolved.inputs) });
unsupportedJob.runCapture.networkInputSha256 = createHash('sha256').update(unsupportedJob.runCapture.networkInputJson).digest('hex');
const workspace = createWorkspaceState(saved, { id: 'project-1', now });
process.stdout.write(JSON.stringify({ workspace, artifacts: workspaceArtifactIndex(workspace), candidateJob, workingJob, unsupportedJob }));
