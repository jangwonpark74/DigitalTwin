import { describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { HardwareSession } from './HardwareSession';

describe('transient hardware workbench session', () => {
  it('owns only tab and selection state, validates topology IDs and preserves project data', () => {
    const project = defaultProject(), original = structuredClone(project);
    const session = new HardwareSession('pilot', project);
    const first = session.getSnapshot();
    expect(first).toMatchObject({ projectId: 'pilot', mode: 'network', selectedNode: 'GH-POOL-01',
      selectedLink: null, selectedServer: null, isometric: true });
    expect(session.getSnapshot()).toBe(first);
    const notify = vi.fn(), unsubscribe = session.subscribe(notify);
    expect(session.selectLink(project.management.topology.links[0].id)).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ selectedLink: project.management.topology.links[0].id, selectedServer: null });
    expect(session.selectLink('unknown-link')).toBe(false);
    expect(session.getSnapshot()).toMatchObject({ selectedLink: project.management.topology.links[0].id });
    expect(session.selectNode('ethernet-switch')).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ selectedNode: 'ethernet-switch', selectedLink: null });
    expect(session.selectNode('unknown-pool')).toBe(false);
    session.selectTab('racks');
    expect(session.selectServer('GH-POOL-02-S06')).toBe(true);
    expect(session.getSnapshot()).toMatchObject({ mode: 'racks', selectedNode: 'GH-POOL-02',
      selectedServer: 'GH-POOL-02-S06', selectedLink: null });
    expect(session.selectServer('GH-POOL-02-S07')).toBe(false);
    session.rotate();
    expect(session.getSnapshot().isometric).toBe(false);
    session.selectTab('inventory');
    expect(session.getSnapshot().selectedServer).toBe('GH-POOL-02-S06');
    expect(() => session.selectTab('bogus' as 'network')).toThrow('Unknown hardware tab');
    expect(notify).toHaveBeenCalled();
    unsubscribe();
    expect(project).toEqual(original);
    session.dispose();
  });

  it('retains a valid same-project selection but clears project-scoped selections on a switch', () => {
    const project = defaultProject();
    const session = new HardwareSession('pilot', project);
    session.selectServer('GH-POOL-03-S02');
    const edit = structuredClone(project);
    edit.management.topology.gh200Pools[2].alias = 'New target label';
    session.setProject('pilot', edit);
    expect(session.getSnapshot()).toMatchObject({ selectedNode: 'GH-POOL-03', selectedServer: 'GH-POOL-03-S02' });
    session.setProject('other', defaultProject());
    expect(session.getSnapshot()).toMatchObject({ projectId: 'other', mode: 'network', selectedNode: 'GH-POOL-01',
      selectedLink: null, selectedServer: null, isometric: true });
    session.dispose();
    const closed = session.getSnapshot();
    session.selectNode('GH-POOL-02');
    expect(session.getSnapshot()).toBe(closed);
  });
});
