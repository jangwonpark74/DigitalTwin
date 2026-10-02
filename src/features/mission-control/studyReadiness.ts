import { buildRtJob } from '../../../rt-job.mjs';
import type { PreviewRouteId } from '../../app/routeRegistry';
import type { DriveMeasurements } from '../ray-tracing/driveKpi';
import type { SiteSceneProject } from '../site-planner/OpenSiteScene';
import type { StudyState } from '../study/studyTypes';

type StudyProject = SiteSceneProject & { driveMeasurements?: DriveMeasurements | null; study?: StudyState };
export type StudyGate = { id: string; label: string; status: 'ready' | 'blocked' | 'unknown'; reason: string; route: PreviewRouteId };
export type StudyAction = { title: string; detail: string; status: 'ready' | 'pending'; route: PreviewRouteId };
const positioned = (project: StudyProject) => project.sites.filter(site => Number.isFinite(site.radioLocation.latitude) && Number.isFinite(site.radioLocation.longitude));

export function studyReadiness(project: StudyProject, runtime?: { available: boolean; message?: string }): StudyGate[] {
  const sites = positioned(project);
  const geographic = sites.length > 0 || Boolean(project.driveMeasurements?.samples.length);
  let problem = '';
  try {
    buildRtJob(project as Parameters<typeof buildRtJob>[0], sites[0]?.id ?? '',
      { latitude: project.map.latitude, longitude: project.map.longitude, heightM: 1.5 });
  } catch (error) { problem = error instanceof Error ? error.message : String(error); }
  return [
    { id: 'geographic', label: 'Geographic review', status: geographic ? 'ready' : 'blocked', route: 'planner',
      reason: geographic ? 'WGS84 positions available. Inspect their source and positional uncertainty.' : 'Set site coordinates or import a GPS measurement dataset.' },
    { id: 'propagation', label: 'Local path execution', status: problem || runtime?.available === false ? 'blocked' : runtime?.available ? 'ready' : 'unknown', route: 'ray',
      reason: problem || (runtime?.available === false ? runtime.message || 'Compatible local RT runtime unavailable.' : runtime?.available
        ? 'Inputs support the current local path solver. Output is simulated, with uncalibrated antenna/material assumptions.'
        : 'Inputs prepared. Open Propagation to check the current runtime and receiver/options before execution.') },
    { id: 'calibration', label: 'Physical calibration', status: 'blocked', route: 'drive',
      reason: 'Requires nonsynthetic observations, compatible reference-signal semantics, alignment and held-out evaluation. CSV import alone does not qualify.' },
    { id: 'comparison', label: 'Baseline / candidate result comparison', status: 'blocked', route: 'scenarios',
      reason: project.study?.baselines.length && project.study.candidates.length
        ? 'Versioned input changes are available. Comparable completed baseline and candidate solver runs are still required for RF result comparison.'
        : 'Capture a baseline and candidate before linking comparable completed solver runs.' },
    { id: 'observation', label: 'Connected observation', status: 'blocked', route: 'monitoring',
      reason: 'No authenticated read adapter or timestamped collector evidence is available.' },
    { id: 'change', label: 'Controlled network change', status: 'blocked', route: 'tasks',
      reason: 'No network-change adapter, impact approval or rollback service is implemented.' },
  ];
}

export function studyNextActions(project: StudyProject): StudyAction[] {
  const samples = project.driveMeasurements?.samples.length ?? 0, sites = positioned(project).length;
  const study = project.study, captured = Boolean(study?.baselines.length);
  return [
    { route: 'drive', status: samples ? 'ready' : 'pending', title: samples ? 'Diagnose drive evidence' : 'Import drive evidence',
      detail: samples ? `${samples} saved GPS samples. Review source status, weak segments and cell mappings.` : 'Load a GPS CSV, then inspect radio quality and serving-cell changes.' },
    { route: study?.definitions.length ? 'scenarios' : 'study', status: captured ? 'ready' : 'pending',
      title: !study?.definitions.length ? 'Define engineering study' : captured ? 'Review baseline and candidates' : 'Capture network baseline',
      detail: captured ? `${study!.baselines.length} fixed baselines · ${study!.candidates.length} candidates. Review exact RF changes and retained revisions.`
        : `${sites} / ${project.sites.length} sites positioned. Define the decision and capture saved inputs before candidate changes.` },
    { route: 'ray', status: project.map.scene ? 'ready' : 'pending', title: project.map.scene ? 'Prepare propagation study' : 'Import solver geometry',
      detail: project.map.scene ? 'Choose a receiver and check local solver prerequisites. A rendered city is not validated RF geometry.' : 'Import bounded GeoJSON geometry and inspect height/material assumptions before local execution.' },
    { route: 'artifacts', status: 'pending', title: 'Review results and evidence',
      detail: 'Inspect saved runs, inputs and artifacts. Record an inconclusive outcome when evidence is insufficient.' },
  ];
}
