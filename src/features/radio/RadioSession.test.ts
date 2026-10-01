import { describe, expect, it } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { RadioSession } from './RadioSession';

describe('RadioSession', () => {
  it('selects only sites in the current project and starts placement for that site', () => {
    const project = defaultProject();
    const session = new RadioSession('project-a', project);
    const [first, second] = project.sites;

    expect(session.getSnapshot()).toEqual({ projectId: 'project-a', selectedSiteId: first.id, placementSiteId: null });
    expect(session.selectSite(second.id)).toBe(true);
    expect(session.startPlacement(second.id)).toBe(true);
    expect(session.getSnapshot()).toEqual({ projectId: 'project-a', selectedSiteId: second.id, placementSiteId: second.id });
    expect(session.selectSite('missing-site')).toBe(false);
    expect(session.startPlacement('missing-site')).toBe(false);
    expect(session.getSnapshot().selectedSiteId).toBe(second.id);
  });

  it('cancels placement and clears it when a different site is selected', () => {
    const project = defaultProject();
    const session = new RadioSession('project-a', project);
    const [first, second] = project.sites;

    session.startPlacement(first.id);
    session.selectSite(second.id);
    expect(session.getSnapshot().placementSiteId).toBeNull();
    session.startPlacement(second.id);
    session.cancelPlacement();
    expect(session.getSnapshot().placementSiteId).toBeNull();
  });

  it('retains valid selection on same-project edits and resets selection on project switch', () => {
    const firstProject = defaultProject();
    const firstSiteId = firstProject.sites[0].id;
    const session = new RadioSession('project-a', firstProject);
    const selectedSiteId = firstProject.sites[1].id;
    session.selectSite(selectedSiteId);
    session.startPlacement(selectedSiteId);

    session.setProject('project-a', structuredClone(firstProject));
    expect(session.getSnapshot().selectedSiteId).toBe(selectedSiteId);
    expect(session.getSnapshot().placementSiteId).toBe(selectedSiteId);

    const secondProject = defaultProject();
    secondProject.sites[0].id = 'other-site';
    session.setProject('project-b', secondProject);
    expect(session.getSnapshot()).toEqual({ projectId: 'project-b', selectedSiteId: 'other-site', placementSiteId: null });
    expect(firstSiteId).not.toBe('other-site');
  });

  it('falls back when a same-project edit removes the selected site and publishes immutable snapshots', () => {
    const project = defaultProject();
    const session = new RadioSession('project-a', project);
    const selectedSiteId = project.sites[1].id;
    session.selectSite(selectedSiteId);
    const snapshots: unknown[] = [];
    session.subscribe(() => snapshots.push(session.getSnapshot()));

    const reduced = structuredClone(project);
    reduced.sites = reduced.sites.slice(0, 1);
    session.setProject('project-a', reduced);

    expect(session.getSnapshot().selectedSiteId).toBe(reduced.sites[0].id);
    expect(session.getSnapshot().placementSiteId).toBeNull();
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    expect(snapshots).toHaveLength(1);
  });

  it('unsubscribe and dispose stop future notifications', () => {
    const project = defaultProject();
    const session = new RadioSession('project-a', project);
    const listener = () => undefined;
    const unsubscribe = session.subscribe(listener);
    unsubscribe();
    session.dispose();
    expect(session.subscribe(listener)).toEqual(expect.any(Function));
    expect(session.selectSite(project.sites[1].id)).toBe(false);
  });
});
