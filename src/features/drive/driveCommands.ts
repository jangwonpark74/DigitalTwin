import { buildUseCasePlanSpec } from '../../../usecases.mjs';
import { appendWorkspaceLog } from '../../../workspaces.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { applyLegacyField } from '../../legacy/legacyEventAdapter';
import type { DriveSession } from './DriveSession';
import { commitDriveImport } from './driveImportCommands';

function downloadJson(filename: string, payload: string) {
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  try { anchor.click(); }
  catch (error) { URL.revokeObjectURL(url); throw error; }
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Drive actions share the shell's save queue. GPS evidence is shared with the 3D lab. */
export function createDriveCommands(controller: AppController, session: DriveSession, options: {
  download?: (filename: string, payload: string) => void;
  onError: (message: string) => void;
  onSuccess?: () => void;
}) {
  const download = options.download ?? downloadJson;
  const activeRecord = () => {
    const workspace = controller.getSnapshot().workspace;
    if (!workspace || workspace.activeProjectId !== session.getSnapshot().projectId)
      throw new Error('Drive project changed; select the active project before retrying.');
    const record = workspace.projects.find(item => item.id === workspace.activeProjectId);
    if (!record) throw new Error('Active project not found');
    return record;
  };
  const log = (id: string, title: string, detail: string) => controller.dispatch(workspace =>
    appendWorkspaceLog(workspace, id, { title, detail }) as WorkspaceSnapshot);
  return {
    onSetting(path: 'drive.route' | 'drive.samples' | 'drive.speedKph', value: string) {
      activeRecord();
      return applyLegacyField(controller, path, value)!.then(() => { options.onSuccess?.(); });
    },
    async onImport(filename: string, rows: number) {
      const record = activeRecord();
      const state = session.getSnapshot();
      if (state.trace?.source !== 'imported-unverified' || state.filename !== filename
        || state.trace.samples.length !== rows) throw new Error('Imported drive trace is no longer current.');
      const gps = state.trace.samples.every((sample: { latitude?: number; longitude?: number }) => 'latitude' in sample && 'longitude' in sample);
      const measurements = gps ? buildDriveMeasurements(state.trace, filename) : null;
      if (measurements) await commitDriveImport(controller, record.id, measurements);
      else await controller.dispatch(workspace => appendWorkspaceLog(workspace,
        record.id, { title: 'DM trace imported', detail: `${filename} · ${rows} unverified rows` }) as WorkspaceSnapshot);
      options.onSuccess?.();
    },
    async onAnalysisExport(report: ReturnType<DriveSession['buildAnalysisReport']>) {
      const record = activeRecord();
      download('atlas-ran-dm-analysis.json', JSON.stringify(report, null, 2));
      await log(record.id, 'DM analysis exported', report.source);
      options.onSuccess?.();
    },
    async onPlanExport() {
      const record = activeRecord();
      const spec = buildUseCasePlanSpec(record.project, 'drive');
      download('atlas-ran-drive-plan.json', JSON.stringify(spec, null, 2));
      await log(record.id, 'Use-case plan exported', 'drive');
      options.onSuccess?.();
    },
    onError: options.onError,
  };
}
