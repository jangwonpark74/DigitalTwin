import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseDmCsv } from '../../dm.mjs';
import { buildDriveMeasurements } from '../../drive-measurements.mjs';
import { retainMeasurementDataset, selectMeasurementDataset } from '../../measurement-library.mjs';
import { workspaceArtifactIndex } from '../../artifacts.mjs';
import { stableJson } from '../../study.mjs';

const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/drive-import.mjs'], { encoding: 'utf8' }));
const project = fixture.workspace.projects[0].project, initial = structuredClone(project.driveMeasurements);
const rawCsv = initial.evidence.rawCsv.replace('-120', '-100');
const second = buildDriveMeasurements(parseDmCsv(rawCsv, { mapping: initial.evidence.transformations[0].mapping }), 'second.csv');
const sha256 = createHash('sha256').update(rawCsv).digest('hex');
const normalizationSha256 = createHash('sha256').update(stableJson({ sourceSha256: sha256, transformations: initial.evidence.transformations })).digest('hex');
second.evidence = { ...initial.evidence, rawCsv, sha256, normalizationSha256, datasetId: `sha256-${normalizationSha256}`, importedAt: '2026-10-02T02:00:00Z' };
fixture.workspace.projects[0].project = await retainMeasurementDataset(project, second, { now: () => '2026-10-02T02:00:00Z' });
const restored = structuredClone(fixture.workspace);
restored.projects[0].project = selectMeasurementDataset(restored.projects[0].project, restored.projects[0].project.measurementLibrary.records[0].id);
console.log(JSON.stringify({ workspace: fixture.workspace, artifacts: workspaceArtifactIndex(fixture.workspace),
  restored, restoredArtifacts: workspaceArtifactIndex(restored) }));
