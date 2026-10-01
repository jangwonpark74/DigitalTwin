import { describe, expect, it } from 'vitest';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceSchema } from '../api/schemas';
import { previewRoutes, isPreviewRoute } from './routeRegistry';

const record = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];

describe('preview route registry', () => {
  it('maps the supported route leaves and rejects unknown IDs', () => {
    expect(Object.keys(previewRoutes)).toEqual(['overview', 'projects', 'activity', 'artifacts', 'stack', 'ues', 'map', 'planner', 'radio', 'ray', 'drive', 'ab', 'data', 'hardware', 'software', 'monitoring', 'schedule', 'tasks']);
    expect(isPreviewRoute('overview')).toBe(true);
    expect(isPreviewRoute('projects')).toBe(true);
    expect(isPreviewRoute('activity')).toBe(true);
    expect(isPreviewRoute('stack')).toBe(true);
    expect(isPreviewRoute('ues')).toBe(true);
    expect(isPreviewRoute('map')).toBe(true);
    expect(previewRoutes.map.label).toBe('City map');
    expect(isPreviewRoute('planner')).toBe(true);
    expect(previewRoutes.planner.label).toBe('Site & cell planner');
    expect(isPreviewRoute('radio')).toBe(true);
    expect(previewRoutes.radio.label).toBe('Radio planner');
    expect(previewRoutes.ray.label).toBe('Ray tracing lab');
    expect(isPreviewRoute('drive')).toBe(true);
    expect(previewRoutes.drive.label).toBe('Virtual drive test');
    expect(isPreviewRoute('ab')).toBe(true);
    expect(isPreviewRoute('data')).toBe(true);
    expect(isPreviewRoute('hardware')).toBe(true);
    expect(previewRoutes.hardware.label).toBe('Hardware inventory');
    expect(isPreviewRoute('monitoring')).toBe(true);
    expect(isPreviewRoute('software')).toBe(true);
    expect(isPreviewRoute('schedule')).toBe(true);
    expect(isPreviewRoute('tasks')).toBe(true);
    expect(isPreviewRoute('artifacts')).toBe(true);
    expect('render' in previewRoutes.overview).toBe(false);
    expect('render' in previewRoutes.projects).toBe(false);
    expect('render' in previewRoutes.activity).toBe(false);
    expect('render' in previewRoutes.stack).toBe(false);
    expect('render' in previewRoutes.ues).toBe(false);
    expect('render' in previewRoutes.ab).toBe(false);
    expect('render' in previewRoutes.data).toBe(false);
    expect('render' in previewRoutes.monitoring).toBe(false);
    expect('render' in previewRoutes.software).toBe(false);
    expect('render' in previewRoutes.schedule).toBe(false);
    expect('render' in previewRoutes.tasks).toBe(false);
  });
});
