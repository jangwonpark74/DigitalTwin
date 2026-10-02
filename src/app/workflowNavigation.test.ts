import { describe, expect, it } from 'vitest';
import { previewRoutes } from './routeRegistry';
import { workflowSections, sectionForRoute, visibleSections } from './workflowNavigation';

describe('engineering lifecycle navigation', () => {
  it('places every existing route exactly once and keeps projects global', () => {
    const routes = ['projects', ...workflowSections.flatMap(section => section.routes)];
    expect(routes.sort()).toEqual(Object.keys(previewRoutes).sort());
    expect(new Set(routes).size).toBe(routes.length);
    expect(workflowSections.filter(section => !section.utility).map(section => section.label)).toEqual([
      'Overview', 'Data and Twin Setup', 'Network Design', 'Simulation and Experiments',
      'Validation and Optimization', 'Operations and Reports',
    ]);
    expect(sectionForRoute('radio')?.id).toBe('design');
    expect(sectionForRoute('drive')?.id).toBe('validation');
    expect(sectionForRoute('runs')?.id).toBe('simulation');
    expect(sectionForRoute('measurements')?.id).toBe('setup');
  });
  it('keeps the current workspace discoverable when a role preset would hide it', () => {
    expect(visibleSections('operations', 'ray').map(section => section.id)).toContain('simulation');
    expect(visibleSections('rf', 'hardware').map(section => section.id)).toContain('platform');
    expect(visibleSections('all', 'overview')).toHaveLength(7);
  });
});
