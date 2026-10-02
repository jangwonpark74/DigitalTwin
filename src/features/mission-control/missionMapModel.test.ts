import { describe, expect, it } from 'vitest';
import { mapPercentToGeo } from '../../../model.mjs';
import { parseGeoJsonScene, geoToLocalMeters } from '../../../scene.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { buildMissionMapModel } from './missionMapModel';

const record = () => workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];

describe('Mission Control map view model uses legacy site, geography and provenance contracts', () => {
  it('exposes the default schematic sites and first-site inspector without mutating the project', () => {
    const selected = record();
    const before = structuredClone(selected);
    const model = buildMissionMapModel(selected);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    expect(model.projectId).toBe(selected.id);
    expect(model.map).toMatchObject({ kind: 'schematic', source: 'OSM TARGET SOURCE',
      caption: 'Schematic preview · no imported geometry', note: 'Illustration only; not RT output' });
    expect(model.markers).toHaveLength(3);
    expect(model.markers.map(site => site.id)).toEqual(['SITE-01', 'SITE-02', 'SITE-03']);
    const site = (selected.project.sites as { x: number; y: number }[])[0];
    expect(model.markers[0]).toMatchObject({ selected: true, visible: true, x: site.x * 9, y: site.y * 5.4 });
    expect(model.selectedSite).toMatchObject({ id: 'SITE-01', name: 'Civic Square', frontEnd: 'Virtual antenna',
      coordinates: 'Not set', backhaul: 'Real vDU · unverified' });
    expect(model.footprints).toEqual([]);
    expect(selected).toEqual(before);
  });

  it('resolves selection transiently, falls back for stale IDs, and does not reuse another project selection', () => {
    const first = record();
    const second = structuredClone(first);
    second.id = '22222222-2222-4222-8222-222222222222';
    second.name = 'Another plan';
    second.project.name = second.name;
    (second.project.sites as { name: string }[])[0].name = 'Other site';
    const selected = buildMissionMapModel(first, 'SITE-02');
    expect(selected.kind).toBe('ready');
    if (selected.kind !== 'ready') return;
    expect(selected.selectedSite).toMatchObject({ id: 'SITE-02', name: 'River Bridge', frontEnd: 'Virtual MMU' });
    expect(selected.markers.filter(site => site.selected).map(site => site.id)).toEqual(['SITE-02']);
    const switched = buildMissionMapModel(second, 'SITE-99');
    expect(switched.kind).toBe('ready');
    if (switched.kind !== 'ready') return;
    expect(switched.selectedSite.name).toBe('Other site');
    expect(switched.markers[0].selected).toBe(true);
    expect(buildMissionMapModel(null)).toEqual({ kind: 'empty' });
  });

  it('projects located sites with the existing WGS84 conversion and labels schematic estimates explicitly', () => {
    const selected = record();
    const site = (selected.project.sites as {
      x: number; y: number; radioLocation: { latitude: number | null; longitude: number | null; source: string };
    }[])[0];
    const map = selected.project.map as { latitude: number; longitude: number; radiusMeters: number };
    const coordinates = mapPercentToGeo(map, site.x, site.y);
    site.radioLocation = { ...coordinates, source: 'map-estimate' };
    site.x = 5; site.y = 95; // Stored schematic percentages must not override WGS84.
    const model = buildMissionMapModel(selected);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    const local = geoToLocalMeters(map, coordinates.latitude, coordinates.longitude);
    expect(model.markers[0].x).toBeCloseTo(450 + local.eastM / map.radiusMeters * 450);
    expect(model.markers[0].y).toBeCloseTo(270 - local.northM / map.radiusMeters * 270);
    expect(model.selectedSite.coordinates).toBe(`${coordinates.latitude.toFixed(5)}, ${coordinates.longitude.toFixed(5)} · map estimate`);
    expect(model.selectedSite.mapPosition).toBe('31.0%, 35.0%');
    map.radiusMeters *= 2;
    const expanded = buildMissionMapModel(selected);
    if (expanded.kind !== 'ready') throw new Error('Valid expanded area expected');
    expect(expanded.selectedSite.mapPosition).toBe('40.5%, 42.5%');
    site.radioLocation.latitude = map.latitude + 0.1;
    expect(buildMissionMapModel(selected).kind).toBe('ready');
    const distant = buildMissionMapModel(selected);
    if (distant.kind !== 'ready') return;
    expect(distant.markers[0].visible).toBe(false);
    expect(distant.selectedSite.mapPosition).toBe('Outside map scope');
    expect(distant.markers[0].name).toBe('Civic Square');
  });

  it('projects only real imported footprints, retaining file provenance and assumed-height labels', () => {
    const selected = record();
    const scene = parseGeoJsonScene({ type: 'FeatureCollection', features: [{
      type: 'Feature', id: 'test-building', properties: {}, geometry: { type: 'Polygon', coordinates: [[
        [126.9778, 37.5664], [126.9780, 37.5664], [126.9780, 37.5666],
        [126.9778, 37.5666], [126.9778, 37.5664],
      ]] },
    }] }, { fileName: 'local.geojson', importedAt: '2026-01-01T00:00:00Z' });
    (selected.project.map as { scene: unknown }).scene = scene;
    const model = buildMissionMapModel(selected);
    expect(model.kind).toBe('ready');
    if (model.kind !== 'ready') return;
    expect(model.map).toMatchObject({ kind: 'footprints', source: 'LOCAL GEOJSON',
      caption: 'local.geojson · WGS84 EPSG:4326 footprints in local map scope',
      note: 'Footprints imported; UE markers and beams illustrative' });
    expect(model.footprints).toHaveLength(1);
    expect(model.footprints[0].label).toContain('assumed');
    expect(model.footprints[0].points.split(' ')).toHaveLength(scene.footprints[0].ring.length);
  });
});
