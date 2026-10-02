import { useEffect, useId, useRef, useState } from 'react';
import type { buildMissionControlModel } from './missionControlModel';
import './mission-control.css';

type ScenarioState = Extract<ReturnType<typeof buildMissionControlModel>, { kind: 'ready' }>['scenario'];
type AssumptionPath = 'channel.blockage' | 'ue.count' | 'channel.maxDepth';
type Props = {
  state: ScenarioState;
  onSelectPreset: (preset: string) => Promise<void> | void;
  onChangeAssumption: (path: AssumptionPath, value: string) => Promise<void> | void;
};
const presets = [
  { id: 'baseline', label: 'Default assumptions' },
  { id: 'blockage', label: 'Urban blockage' },
  { id: 'ue-surge', label: 'UE density surge' },
  { id: 'clear-line', label: 'Clear line-of-sight' },
];
function values(state: ScenarioState) {
  return { blockage: String(state.blockage), virtualUes: String(state.virtualUes), maxDepth: String(state.maxDepth) };
}

/** Presentation drafts do not persist; controller commands validate and save on commit. */
export default function MissionControlScenarioControls({ state, onSelectPreset, onChangeAssumption }: Props) {
  const [draft, setDraft] = useState(() => values(state));
  const [error, setError] = useState<{ message: string; kind: 'input' | 'save' } | null>(null);
  const currentProject = useRef(state.projectId);
  currentProject.current = state.projectId;
  const pending = useRef('');
  const lastCommitted = useRef('');
  const id = useId();
  useEffect(() => {
    setDraft(values(state));
    setError(null);
    lastCommitted.current = '';
  }, [state.projectId, state.preset, state.blockage, state.virtualUes, state.maxDepth]);

  const report = (cause: unknown, kind: 'input' | 'save') =>
    setError({ message: cause instanceof Error ? cause.message : String(cause), kind });
  const select = (preset: string) => {
    const projectId = state.projectId;
    try {
      const request = onSelectPreset(preset);
      void Promise.resolve(request).then(() => { if (currentProject.current === projectId) setError(null); })
        .catch(cause => { if (currentProject.current === projectId) report(cause, 'save'); });
    } catch (cause) { report(cause, 'input'); }
  };
  const commit = (path: AssumptionPath, value: string) => {
    const projectId = state.projectId;
    const current = path === 'channel.blockage' ? state.blockage : path === 'ue.count' ? state.virtualUes : state.maxDepth;
    const ticket = `${projectId}:${path}:${value}`;
    if (value === String(current) || pending.current === ticket || lastCommitted.current === ticket) return;
    let request: Promise<void> | void;
    try { request = onChangeAssumption(path, value); }
    catch (cause) {
      setDraft(values(state));
      report(cause, 'input');
      return;
    }
    pending.current = ticket;
    void Promise.resolve(request).then(() => {
      if (currentProject.current === projectId) { lastCommitted.current = ticket; setError(null); }
    }).catch(cause => { if (currentProject.current === projectId) report(cause, 'save'); })
      .finally(() => { if (pending.current === ticket) pending.current = ''; });
  };

  return <section className="mission-control-scenarios" aria-label="Illustrative preset controls">
    <h2>Illustrative assumptions</h2>
    <div className="mission-control-presets" role="group" aria-label="Illustrative presets">
      {presets.map(preset => <button type="button" key={preset.id} aria-pressed={state.preset === preset.id}
        onClick={() => select(preset.id)}>{preset.label}</button>)}
    </div>
    <p>Changing a preset updates illustrative indicators only. It does not run a channel solver.</p>
    <div className="mission-control-range-label"><label htmlFor={`${id}-blockage`}>Blockage assumption</label>
      <strong aria-hidden="true">{draft.blockage}%</strong></div>
    <input id={`${id}-blockage`} type="range" min="0" max="80" step="1" value={draft.blockage}
      onChange={event => setDraft(previous => ({ ...previous, blockage: event.target.value }))}
      onPointerUp={event => commit('channel.blockage', event.currentTarget.value)}
      onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key))
        commit('channel.blockage', event.currentTarget.value); }}
      onBlur={event => commit('channel.blockage', event.currentTarget.value)} />
    <div className="mission-control-inputs">
      <label>Virtual UE count
        <input type="number" min="1" max="50000" value={draft.virtualUes}
          onChange={event => setDraft(previous => ({ ...previous, virtualUes: event.target.value }))}
          onBlur={event => commit('ue.count', event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>
      <label>Max trace depth
        <input type="number" min="1" max="12" value={draft.maxDepth}
          onChange={event => setDraft(previous => ({ ...previous, maxDepth: event.target.value }))}
          onBlur={event => commit('channel.maxDepth', event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>
    </div>
    {error && <p role="alert">{error.kind === 'save' ? 'Database save needs attention' : 'Input rejected'} · {error.message}</p>}
  </section>;
}
