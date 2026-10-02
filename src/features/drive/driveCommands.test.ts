import { beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { DriveSession } from './DriveSession';
import { createDriveCommands } from './driveCommands';

const first = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
}));
const other = structuredClone(first.projects[0]);
other.id = '22222222-2222-4222-8222-222222222222';
other.name = 'Other project';
other.project.name = other.name;
const workspace = { ...first, projects: [first.projects[0], other] };
const csv = `time_s,technology,serving_cell,x_pct,y_pct,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event
0,LTE,SITE-01-C1,10,20,-90,-9,17,35,8,
1,NR,SITE-02-C1,20,25,-115,-16,-2,3,1,handover
`;

beforeEach(() => {
  vi.stubGlobal('crypto', webcrypto);
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

describe('Drive commands use the preview controller as the only persisted owner', () => {
  it('shares GPS imports with the 3D lab without putting samples in the drive plan', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api); await controller.hydrate();
    const session = new DriveSession(first.projects[0].id, first.projects[0].project);
    const gps = csv.replace('x_pct,y_pct', 'latitude,longitude').replace('10,20', '37.566,126.978').replace('20,25', '37.566,126.9781');
    await session.importFile({ name: 'gps.csv', size: gps.length, text: async () => gps });
    await createDriveCommands(controller, session, { onError: vi.fn() }).onImport('gps.csv', 2);
    expect(controller.getSnapshot().workspace!.projects[0].project.driveMeasurements).toMatchObject({
      fileName: 'gps.csv', source: 'imported-unverified', coordinateMode: 'gps',
      samples: [{ latitude: 37.566, longitude: 126.978, rsrpDbm: -90 }, { longitude: 126.9781, sinrDb: -2 }],
    });
    expect(controller.getSnapshot().workspace!.projects[1].project.driveMeasurements).toBeNull();
    expect(controller.getSnapshot().workspace!.projects[0].project.measurementLibrary).toMatchObject({ records: [expect.objectContaining({ version: 1 })] });
    expect((controller.getSnapshot().workspace!.projects[0].project.useCases as { drive: object }).drive).not.toHaveProperty('trace');
    session.dispose();
  });
  it('keeps imported trace state transient while saving settings through the controller', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const session = new DriveSession(first.projects[0].id, first.projects[0].project);
    const download = vi.fn(), onError = vi.fn();
    const actions = createDriveCommands(controller, session, { download, onError });
    const file = new File([csv], 'field.csv');
    Object.defineProperty(file, 'text', { value: async () => csv });
    await session.importFile(file);
    await actions.onImport(file.name, 2);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'DM trace imported', detail: 'field.csv · 2 unverified rows',
    });
    expect((controller.getSnapshot().workspace!.projects[0].project.useCases as { drive: object }).drive).not.toHaveProperty('trace');
    await actions.onSetting('drive.samples', '32');
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Use-case setting changed', detail: 'drive.samples',
    });
    expect((controller.getSnapshot().workspace!.projects[0].project.useCases as { drive: { samples: number } }).drive.samples).toBe(32);
    expect((controller.getSnapshot().workspace!.projects[1].project.useCases as { drive: { samples: number } }).drive.samples).toBe(48);
    await actions.onPlanExport();
    expect(download).toHaveBeenCalledWith('atlas-ran-drive-plan.json', expect.any(String));
    expect(JSON.parse(download.mock.calls[0][1]).config.samples).toBe(32);
    expect(onError).not.toHaveBeenCalled();
    session.dispose();
  });

  it('saves the selected project and logs imported evidence and source-labelled downloads', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const session = new DriveSession(first.projects[0].id, first.projects[0].project);
    const download = vi.fn(), onError = vi.fn();
    const actions = createDriveCommands(controller, session, { download, onError });
    await actions.onSetting('drive.samples', '32');
    expect((controller.getSnapshot().workspace!.projects[0].project.useCases as {
      drive: { samples: number };
    }).drive.samples).toBe(32);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Use-case setting changed', detail: 'drive.samples',
    });
    expect((controller.getSnapshot().workspace!.projects[1].project.useCases as { drive: { samples: number } }).drive.samples).toBe(48);
    await session.importFile({ name: 'field.csv', size: csv.length, text: async () => csv });
    await actions.onImport('field.csv', 2);
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'DM trace imported', detail: 'field.csv · 2 unverified rows',
    });
    session.selectTechnology('NR');
    await actions.onAnalysisExport(session.buildAnalysisReport());
    expect(download).toHaveBeenCalledWith('atlas-ran-dm-analysis.json', expect.any(String));
    const report = JSON.parse(download.mock.calls[0][1]);
    expect(report).toMatchObject({ kind: '4G-5G-DM-ANALYSIS', source: 'imported-unverified',
      provenance: 'imported-unverified', filename: 'field.csv', filters: { technology: 'NR', metric: 'rsrp' } });
    expect(report.samples).toBeUndefined();
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'DM analysis exported', detail: 'imported-unverified',
    });
    await actions.onPlanExport();
    expect(download).toHaveBeenCalledWith('atlas-ran-drive-plan.json', expect.any(String));
    const plan = JSON.parse(download.mock.calls[1][1]);
    expect(plan).toMatchObject({ mode: 'PLANNING_ONLY', useCase: 'drive', config: { samples: 32 } });
    expect(controller.getSnapshot().workspace!.projects[0].activity[0]).toMatchObject({
      title: 'Use-case plan exported', detail: 'drive',
    });
    expect(onError).not.toHaveBeenCalled();
    session.dispose();
  });

  it('rejects stale project actions and never logs a failed download or invalid edit', async () => {
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    const session = new DriveSession(first.projects[0].id, first.projects[0].project);
    const download = vi.fn(() => { throw new Error('Download unavailable'); });
    const onError = vi.fn();
    const actions = createDriveCommands(controller, session, { download, onError });
    expect(() => actions.onSetting('drive.samples', '501')).toThrow('Drive sample count must be 8–500');
    await expect(actions.onAnalysisExport(session.buildAnalysisReport())).rejects.toThrow('Download unavailable');
    expect(controller.getSnapshot().workspace!.projects[0].activity).toHaveLength(0);
    expect(api.write).not.toHaveBeenCalled();
    await controller.dispatch(state => activateWorkspaceProject(state, other.id) as WorkspaceSnapshot);
    expect(() => actions.onSetting('drive.samples', '32')).toThrow('Drive project changed');
    await expect(actions.onPlanExport()).rejects.toThrow('Drive project changed');
    await expect(actions.onImport('late.csv', 2)).rejects.toThrow('Drive project changed');
    expect(download).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace!.projects[1].activity).toHaveLength(0);
    expect(onError).not.toHaveBeenCalled();
    session.dispose();
  });
});
