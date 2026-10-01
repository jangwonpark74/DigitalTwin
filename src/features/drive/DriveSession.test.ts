import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { buildDmAnalysisReport } from '../../../dm.mjs';
import { DriveSession } from './DriveSession';

const csv = `time_s,technology,serving_cell,x_pct,y_pct,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event
0,4G,SITE-01-C1,10,20,-90,-9,17,35,8,
1,5G,SITE-01-C1,20,25,-115,-16,-2,3,1,handover
2,NR,SITE-02-C1,30,27,-117,-17,-3,2,0.5,
3,LTE,SITE-02-C1,40,30,-96,-12,7,22,5,
`;

afterEach(() => vi.useRealTimers());

describe('transient drive workspace session (no persisted store)', () => {
  it('keeps cached snapshots and mirrors tab/filter/cursor semantics without changing the project', () => {
    const project = defaultProject(), before = structuredClone(project);
    const session = new DriveSession('pilot', project);
    const initial = session.getSnapshot();
    expect(initial).toMatchObject({ projectId: 'pilot', tab: 'analysis', technology: 'ALL',
      metric: 'rsrp', position: 0, playing: false, trace: null, filename: '' });
    expect(session.getSnapshot()).toBe(initial);
    const notify = vi.fn(), unsubscribe = session.subscribe(notify);
    session.selectTab('plan');
    expect(session.getSnapshot()).toMatchObject({ tab: 'plan', position: 0 });
    session.seek(3);
    session.selectTab('analysis');
    expect(session.getSnapshot().position).toBe(0);
    session.selectTechnology('NR');
    session.seek(2);
    session.selectMetric('sinr');
    expect(session.getSnapshot()).toMatchObject({ technology: 'NR', metric: 'sinr', position: 2 });
    expect(session.jumpToSample(99)).toBe(false);
    expect(notify).toHaveBeenCalled();
    unsubscribe();
    expect(project).toEqual(before);
    session.dispose();
  });

  it('imports bounded CSV with source labels, filters and jump indices, then resets to a synthetic demo', async () => {
    const session = new DriveSession('pilot', defaultProject());
    await expect(session.importFile({ name: 'huge.csv', size: 1_000_001, text: async () => csv }))
      .rejects.toThrow('DM CSV must be smaller than 1 MB');
    expect(session.getSnapshot().trace).toBeNull();
    const imported = await session.importFile({ name: 'field.csv', size: csv.length, text: async () => csv });
    expect(imported?.samples).toHaveLength(4);
    expect(session.getSnapshot()).toMatchObject({ filename: 'field.csv', position: 0,
      technology: 'ALL', metric: 'rsrp', trace: { source: 'imported-unverified' } });
    session.selectTechnology('NR');
    expect(session.jumpToSample(2)).toBe(true);
    expect(session.getSnapshot().position).toBe(1);
    const report = session.buildAnalysisReport();
    expect(report).toEqual(buildDmAnalysisReport(imported, { technology: 'NR', metric: 'rsrp', filename: 'field.csv' }));
    session.resetDemo();
    expect(session.getSnapshot()).toMatchObject({ trace: null, filename: '', position: 0,
      technology: 'NR', metric: 'rsrp', playing: false });
    expect(session.buildAnalysisReport().provenance).toBe('illustrative-not-measured');
    session.dispose();
  });

  it('cleans a single 250ms playback timer on tab changes, project switches and dispose', () => {
    vi.useFakeTimers();
    const session = new DriveSession('pilot', defaultProject());
    session.play();
    expect(session.getSnapshot().playing).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(500);
    expect(session.getSnapshot().position).toBe(2);
    session.selectTab('plan');
    expect(session.getSnapshot()).toMatchObject({ position: 0, playing: false, tab: 'plan' });
    expect(vi.getTimerCount()).toBe(0);
    session.play();
    expect(vi.getTimerCount()).toBe(1);
    session.setProject('second', defaultProject());
    expect(session.getSnapshot()).toMatchObject({ projectId: 'second', tab: 'analysis',
      trace: null, filename: '', position: 0, playing: false });
    expect(vi.getTimerCount()).toBe(0);
    session.play();
    session.dispose();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(1_000);
    expect(session.getSnapshot().position).toBe(0);
  });

  it('stops naturally at the final filtered sample and stops when the analysis cursor is scrubbed', async () => {
    vi.useFakeTimers();
    const session = new DriveSession('pilot', defaultProject());
    await session.importFile({ name: 'field.csv', size: csv.length, text: async () => csv });
    session.selectTechnology('NR');
    session.play();
    vi.advanceTimersByTime(250);
    expect(session.getSnapshot()).toMatchObject({ position: 1, playing: true });
    vi.advanceTimersByTime(250);
    expect(session.getSnapshot()).toMatchObject({ position: 1, playing: false });
    expect(vi.getTimerCount()).toBe(0);
    session.seek(0);
    session.play();
    expect(vi.getTimerCount()).toBe(1);
    session.seek(1);
    expect(session.getSnapshot().playing).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    session.dispose();
  });

  it('resets playback position on a drive-plan edit within the same project but keeps imported evidence', async () => {
    vi.useFakeTimers();
    const project = defaultProject();
    const session = new DriveSession('pilot', project);
    await session.importFile({ name: 'field.csv', size: csv.length, text: async () => csv });
    session.seek(2);
    session.play();
    const updated = structuredClone(project);
    updated.useCases.drive.route = 'river-corridor';
    session.setProject('pilot', updated);
    expect(session.getSnapshot()).toMatchObject({ projectId: 'pilot', position: 0,
      playing: false, filename: 'field.csv', trace: { source: 'imported-unverified' } });
    expect(vi.getTimerCount()).toBe(0);
    let resolve!: (text: string) => void;
    const pending = session.importFile({ name: 'older.csv', size: csv.length,
      text: () => new Promise<string>(done => { resolve = done; }) });
    const next = structuredClone(updated);
    next.useCases.drive.samples = 32;
    session.setProject('pilot', next);
    resolve(csv);
    expect(await pending).toBeNull();
    expect(session.getSnapshot().filename).toBe('field.csv');
    session.dispose();
  });

  it('discards a late file read after a project switch rather than leaking data into another project', async () => {
    const session = new DriveSession('pilot', defaultProject());
    let resolve!: (text: string) => void;
    const loading = session.importFile({ name: 'late.csv', size: csv.length,
      text: () => new Promise<string>(done => { resolve = done; }) });
    session.setProject('second', defaultProject());
    resolve(csv);
    expect(await loading).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ projectId: 'second', trace: null, filename: '' });
    session.dispose();
  });

  it('lets the newest file choice or explicit reset win over older pending reads', async () => {
    const session = new DriveSession('pilot', defaultProject());
    let resolveOld!: (text: string) => void;
    let resolveNew!: (text: string) => void;
    const old = session.importFile({ name: 'old.csv', size: csv.length,
      text: () => new Promise<string>(done => { resolveOld = done; }) });
    const newer = session.importFile({ name: 'new.csv', size: csv.length,
      text: () => new Promise<string>(done => { resolveNew = done; }) });
    resolveNew(csv);
    expect((await newer)?.source).toBe('imported-unverified');
    resolveOld(csv);
    expect(await old).toBeNull();
    expect(session.getSnapshot().filename).toBe('new.csv');
    let resolveAfterReset!: (text: string) => void;
    const pending = session.importFile({ name: 'unwanted.csv', size: csv.length,
      text: () => new Promise<string>(done => { resolveAfterReset = done; }) });
    session.resetDemo();
    resolveAfterReset(csv);
    expect(await pending).toBeNull();
    expect(session.getSnapshot()).toMatchObject({ trace: null, filename: '' });
    session.dispose();
  });
});
