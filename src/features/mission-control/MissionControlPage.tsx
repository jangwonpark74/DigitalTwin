import { useSyncExternalStore } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { useProjectMapView } from '../city-map/ProjectMapSession';
import type { SiteSceneProject } from '../site-planner/OpenSiteScene';
import MissionControlProjectMap from './MissionControlProjectMap';
import type { AppController } from '../../app/AppController';
import { setMissionControlAssumption, setMissionControlScenario } from './missionControlCommands';
import { buildMissionControlModel } from './missionControlModel';
import { buildMissionMapModel } from './missionMapModel';
import MissionControlArchitecture from './MissionControlArchitecture';
import MissionControlLaunchpad from './MissionControlLaunchpad';
import MissionControlMap, { MissionControlSiteInspector, type MapLayers } from './MissionControlMap';
import MissionControlScenarioControls from './MissionControlScenarioControls';
import MissionControlSummary, { MissionControlActivity, MissionControlHero, MissionControlReadiness } from './MissionControlSummary';
import MissionControlWorkflows from './MissionControlWorkflows';
import { studyNextActions, studyReadiness } from './studyReadiness';

type Props = { controller: AppController; onNavigate: (route: string) => void; layers?: MapLayers };

/** An isolated composition for parity tests. The parent hydrates/owns the only controller. */
export default function MissionControlPage({ controller, onNavigate, layers }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const record = snapshot.workspace?.projects.find(item => item.id === snapshot.workspace?.activeProjectId) ?? null;
  const model = buildMissionControlModel(record, { loading: snapshot.status === 'idle' || snapshot.status === 'loading' });
  if (model.kind !== 'ready' || !record) return <MissionControlSummary model={model} onNavigate={onNavigate} />;

  return <ReadyMissionControlPage key={record.id} controller={controller} record={record} model={model} onNavigate={onNavigate} layers={layers} />;
}

function ReadyMissionControlPage({ controller, record, model, onNavigate, layers }: Props & {
  record: WorkspaceSnapshot['projects'][number]; model: Extract<ReturnType<typeof buildMissionControlModel>, { kind: 'ready' }>;
}) {
  const project = record.project as unknown as SiteSceneProject;
  const { session, view } = useProjectMapView(controller, record.id, project.map);
  const map = buildMissionMapModel(record, view.siteId ?? undefined);
  if (map.kind !== 'ready') return <MissionControlMap model={map} onSelect={() => {}} onNavigate={onNavigate} />;
  return <div className="mission-control-page">
    <MissionControlHero model={model} />
    <MissionControlLaunchpad actions={studyNextActions(project)} onNavigate={onNavigate} />
    <div className="mission-control-main-grid">
      <MissionControlProjectMap record={record} model={map} session={session} view={view} layers={layers}
        onSelect={siteId => {
          if (map.markers.some(marker => marker.id === siteId)) session.update({ siteId });
        }} />
      <MissionControlReadiness model={model} gates={studyReadiness(project)} onNavigate={onNavigate} />
    </div>
    <MissionControlWorkflows onNavigate={onNavigate} />
    <div className="mission-control-lower-grid">
      <MissionControlArchitecture />
      <MissionControlSiteInspector model={map} onNavigate={onNavigate} />
    </div>
    <div className="mission-control-lower-grid">
      <MissionControlScenarioControls state={model.scenario}
        onSelectPreset={preset => setMissionControlScenario(controller, preset) ?? undefined}
        onChangeAssumption={(path, value) => setMissionControlAssumption(controller, path, value) ?? undefined} />
      <MissionControlActivity model={model} onNavigate={onNavigate} />
    </div>
  </div>;
}
