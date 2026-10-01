import { describe, expect, it } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { SitePlannerSession } from './SitePlannerSession';

const project = () => structuredClone(defaultProject());

describe('SitePlannerSession', () => {
  it('starts on the first site and cell, then selects only cells belonging to the selected site', () => {
    const first = project();
    const secondSite = first.sites[1];
    const session = new SitePlannerSession('project-a', first);
    expect(session.getSnapshot()).toEqual({ projectId: 'project-a', selectedSiteId: 'SITE-01', selectedCellId: 'SITE-01-C1' });

    expect(session.selectSite(secondSite.id)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: secondSite.id, selectedCellId: secondSite.cells[0].id });
    expect(session.selectCell(secondSite.cells[1].id)).toBe(true);
    expect(session.getSnapshot().selectedCellId).toBe(secondSite.cells[1].id);
    expect(session.selectCell(first.sites[0].cells[0].id)).toBe(false);
    expect(session.selectSite('SITE-99')).toBe(false);
  });

  it('preserves valid selections on same-project updates and repairs removed site or cell selections', () => {
    const original = project();
    const session = new SitePlannerSession('project-a', original);
    session.selectSite('SITE-02');
    session.selectCell('SITE-02-C2');

    session.setProject('project-a', project());
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: 'SITE-02', selectedCellId: 'SITE-02-C2' });

    const withoutCell = project();
    withoutCell.sites[1].cells = withoutCell.sites[1].cells.filter(cell => cell.id !== 'SITE-02-C2');
    session.setProject('project-a', withoutCell);
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: 'SITE-02', selectedCellId: 'SITE-02-C1' });

    const withoutSite = project();
    withoutSite.sites = withoutSite.sites.filter(site => site.id !== 'SITE-02');
    session.setProject('project-a', withoutSite);
    expect(session.getSnapshot()).toMatchObject({ selectedSiteId: 'SITE-01', selectedCellId: 'SITE-01-C1' });
  });

  it('resets selections on project switch and publishes immutable snapshots', () => {
    const first = project();
    const session = new SitePlannerSession('project-a', first);
    const seen: unknown[] = [];
    session.subscribe(() => seen.push(session.getSnapshot()));
    session.selectSite('SITE-03');
    const second = project();
    second.sites[0].id = 'OTHER-01';
    second.sites[0].cells = second.sites[0].cells.map(cell => ({ ...cell, id: cell.id.replace('SITE-01', 'OTHER-01') }));
    session.setProject('project-b', second);
    expect(session.getSnapshot()).toMatchObject({ projectId: 'project-b', selectedSiteId: 'OTHER-01', selectedCellId: 'OTHER-01-C1' });
    expect(Object.isFrozen(session.getSnapshot())).toBe(true);
    expect(seen).toHaveLength(2);
  });
});
