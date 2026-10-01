import { describe, expect, it } from 'vitest';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceSchema } from '../api/schemas';
import { buildPreviewContext } from './selectors';

const workspace = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));

describe('React preview shell context', () => {
  it('derives only selected-project planning counts and explicit empty/loading state', () => {
    expect(buildPreviewContext(null, 0)).toBeNull();
    expect(buildPreviewContext(workspace.projects[0], 1)).toEqual({
      name: workspace.projects[0].name, city: 'Example City', cluster: 'Central cluster',
      projectCount: 1, siteCount: 3, cellCount: 9, ueCount: 1200, activityCount: 0,
    });
    const other = structuredClone(workspace.projects[0]);
    other.name = 'Other plan';
    other.project.name = other.name;
    (other.project.ue as { count: number }).count = 50;
    expect(buildPreviewContext(other, 2)).toMatchObject({ name: 'Other plan', projectCount: 2, ueCount: 50 });
  });
});
