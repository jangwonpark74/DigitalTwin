import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { parseGeoJsonScene } from '../../../scene.mjs';
import { studyReadiness, studyNextActions } from './studyReadiness';
import { saveStudyDefinition, captureBaseline, createCandidate } from '../../../study.mjs';
import { webcrypto } from 'node:crypto';
afterEach(() => vi.unstubAllGlobals());

describe('action-specific study prerequisites', () => {
  it('guides definition, capture and candidate review without declaring comparable solver results', async () => {
    expect(studyNextActions(defaultProject())[1]).toMatchObject({ route: 'study', title: 'Define engineering study' });
    const defined = saveStudyDefinition(defaultProject(), { objective: 'Review', operator: 'Unknown', rat: 'NR' });
    expect(studyNextActions(defined)[1]).toMatchObject({ route: 'scenarios', title: 'Capture network baseline' });
    vi.stubGlobal('crypto', webcrypto);
    const captured = await captureBaseline(defined, 'Baseline');
    const candidate = await createCandidate(captured, captured.study.baselines[0].id, 'Candidate');
    expect(studyNextActions(candidate)[1].title).toBe('Review baseline and candidates');
    expect(studyReadiness(candidate).find(gate => gate.id === 'comparison')).toMatchObject({ status: 'blocked', route: 'scenarios' });
  });
  it('distinguishes a geographic review from executable EM and connected operations', () => {
    const project = defaultProject();
    Object.assign(project.sites[0].radioLocation, { latitude: project.map.latitude, longitude: project.map.longitude });
    const gates = studyReadiness(project, { available: true });
    expect(gates.find(gate => gate.id === 'geographic')?.status).toBe('ready');
    expect(gates.find(gate => gate.id === 'propagation')?.status).toBe('blocked');
    expect(gates.find(gate => gate.id === 'observation')?.status).toBe('blocked');
    expect(gates.find(gate => gate.id === 'change')?.status).toBe('blocked');
  });
  it('allows supported local path execution without claiming calibration or live RAN readiness', () => {
    const project = defaultProject();
    Object.assign(project.sites[0].radioLocation, { latitude: project.map.latitude, longitude: project.map.longitude });
    const lon = project.map.longitude, lat = project.map.latitude;
    project.map.scene = parseGeoJsonScene(JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { height: 12 }, geometry: {
      type: 'Polygon', coordinates: [[[lon, lat], [lon + .0001, lat], [lon + .0001, lat + .0001], [lon, lat]]],
    } }] }), { fileName: 'scene.geojson' }) as never;
    expect(studyReadiness(project, { available: true }).find(gate => gate.id === 'propagation')?.status).toBe('ready');
    expect(studyReadiness(project).find(gate => gate.id === 'propagation')?.status).toBe('unknown');
    expect(studyReadiness(project, { available: true }).find(gate => gate.id === 'calibration')?.status).toBe('blocked');
    const actions = studyNextActions(project);
    expect(actions[0]).toMatchObject({ route: 'drive', title: 'Import drive evidence', status: 'pending' });
    expect(actions.some(action => action.title.includes('GH200'))).toBe(false);
  });
});
