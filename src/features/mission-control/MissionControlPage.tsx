import { useState, useSyncExternalStore } from 'react';
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

type Props = { controller: AppController; onNavigate: (route: string) => void; layers?: MapLayers };

/** An isolated composition for parity tests. The parent hydrates/owns the only controller. */
export default function MissionControlPage({ controller, onNavigate, layers }: Props) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const record = snapshot.workspace?.projects.find(item => item.id === snapshot.workspace?.activeProjectId) ?? null;
  const model = buildMissionControlModel(record, { loading: snapshot.status === 'idle' || snapshot.status === 'loading' });
  const [siteSelection, setSiteSelection] = useState<{ projectId: string; siteId: string } | null>(null);
  if (model.kind !== 'ready') return <MissionControlSummary model={model} onNavigate={onNavigate} />;

  const selectedSiteId = siteSelection && siteSelection.projectId === record?.id ? siteSelection.siteId : undefined;
  const map = buildMissionMapModel(record, selectedSiteId);
  if (map.kind !== 'ready') return <MissionControlMap model={map} onSelect={() => {}} onNavigate={onNavigate} />;
  return <div className="mission-control-page">
    <MissionControlHero model={model} />
    <MissionControlLaunchpad tasks={model.tasks} onNavigate={onNavigate} />
    <div className="mission-control-main-grid">
      <MissionControlMap model={map} onNavigate={onNavigate} layers={layers} showInspector={false}
        onSelect={siteId => {
          if (map.markers.some(marker => marker.id === siteId)) setSiteSelection({ projectId: map.projectId, siteId });
        }} />
      <MissionControlReadiness model={model} />
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
