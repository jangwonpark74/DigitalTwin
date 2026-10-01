import { makeDemoTrace } from './dm.mjs';
import { dmView } from './dm-ui.mjs';
import { drivePlan } from './usecases.mjs';
import { driveView } from './usecase-ui.mjs';

// Shared presentation boundary for the active drive workspace and an eventual React-owned leaf.
/** @typedef {ReturnType<typeof makeDemoTrace> | ReturnType<typeof import('./dm.mjs').parseDmCsv> | null} DriveTrace */
export function renderDriveWorkspace(project, helpers, {
  tab = 'analysis', trace = /** @type {DriveTrace} */ (null), technology = 'ALL', metric = 'rsrp', position = 0,
  filename = '', playing = false,
} = {}) {
  const tabs = `<div class="dm-tabs" role="tablist" aria-label="Virtual drive test workspaces"><button role="tab" data-drive-tab="analysis" aria-selected="${tab === 'analysis'}" aria-controls="drive-panel">4G/5G DM analysis</button><button role="tab" data-drive-tab="plan" aria-selected="${tab === 'plan'}" aria-controls="drive-panel">Route & simulation plan</button></div>`;
  const body = tab === 'analysis'
    ? dmView(project, helpers, trace || makeDemoTrace(project, drivePlan(project)),
      { technology, metric, position, filename, playing })
    : driveView(project, helpers, position, playing, false);
  return helpers.header('Virtual drive test',
    'Plan a software UE route and inspect 4G/5G drive-measurement-style RF evidence with explicit source provenance.') +
    helpers.banner() + tabs + `<div id="drive-panel" role="tabpanel">${body}</div>`;
}
