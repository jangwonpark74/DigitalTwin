import { useSyncExternalStore } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { applyScenario } from '../../../model.mjs';
import { activateWorkspaceProject, createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import { workspaceSchema, type WorkspaceSnapshot } from '../../api/schemas';
import { setMissionControlAssumption, setMissionControlScenario } from './missionControlCommands';
import { buildMissionControlModel } from './missionControlModel';
import MissionControlScenarioControls from './MissionControlScenarioControls';

const first = workspaceSchema.parse(createWorkspaceState(undefined, {
  id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z',
})).projects[0];
const scenario = (record = first) => {
  const model = buildMissionControlModel(record);
  if (model.kind !== 'ready') throw new Error('Valid project required');
  return model.scenario;
};

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
});

function ScenarioHarness({ controller }: { controller: AppController }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const selected = snapshot.workspace?.projects.find(record => record.id === snapshot.workspace?.activeProjectId);
  const model = buildMissionControlModel(selected ?? null);
  if (model.kind !== 'ready') return null;
  return <MissionControlScenarioControls state={model.scenario}
    onSelectPreset={preset => setMissionControlScenario(controller, preset) ?? undefined}
    onChangeAssumption={(path, value) => setMissionControlAssumption(controller, path, value) ?? undefined} />;
}

describe('Mission Control scenario controls (not yet routed)', () => {
  it('dispatches preset intent, reflects canonical selection, and resets a rejected numeric edit', async () => {
    const user = userEvent.setup();
    const select = vi.fn();
    const change = vi.fn((path: string, value: string) => {
      if (path === 'ue.count' && value === '50001') throw new Error('Invalid UE count');
    });
    const { rerender } = render(<MissionControlScenarioControls state={scenario()} onSelectPreset={select} onChangeAssumption={change} />);
    expect(screen.getByRole('button', { name: 'Baseline' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('slider', { name: 'Blockage assumption' }).getAttribute('value')).toBe('12');
    expect(screen.getByRole('spinbutton', { name: 'Virtual UE count' }).getAttribute('value')).toBe('1200');
    await user.click(screen.getByRole('button', { name: 'UE density surge' }));
    expect(select).toHaveBeenCalledWith('ue-surge');
    const surged = structuredClone(first);
    surged.project = applyScenario(surged.project, 'ue-surge');
    rerender(<MissionControlScenarioControls state={scenario(surged)} onSelectPreset={select} onChangeAssumption={change} />);
    expect(screen.getByRole('button', { name: 'UE density surge' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('spinbutton', { name: 'Virtual UE count' }).getAttribute('value')).toBe('3400');
    const ue = screen.getByRole('spinbutton', { name: 'Virtual UE count' });
    await user.clear(ue);
    await user.type(ue, '50001');
    fireEvent.blur(ue);
    expect(screen.getByRole('alert').textContent).toContain('Invalid UE count');
    expect(ue.getAttribute('value')).toBe('3400');
    expect(change).toHaveBeenCalledWith('ue.count', '50001');
    expect(screen.getByText(/does not run a channel solver/)).toBeTruthy();
  });

  it('commits a slider on release, numeric depth on blur, and clears stale drafts on project switch', async () => {
    const user = userEvent.setup();
    const change = vi.fn();
    const select = vi.fn();
    const { rerender } = render(<MissionControlScenarioControls state={scenario()} onSelectPreset={select} onChangeAssumption={change} />);
    const slider = screen.getByRole('slider', { name: 'Blockage assumption' });
    fireEvent.change(slider, { target: { value: '48' } });
    expect(screen.getByText('48%')).toBeTruthy();
    expect(change).not.toHaveBeenCalled();
    fireEvent.pointerUp(slider);
    expect(change).toHaveBeenCalledWith('channel.blockage', '48');
    fireEvent.blur(slider);
    expect(change).toHaveBeenCalledTimes(1);
    const depth = screen.getByRole('spinbutton', { name: 'Max trace depth' });
    await user.clear(depth);
    await user.type(depth, '7');
    fireEvent.blur(depth);
    expect(change).toHaveBeenCalledWith('channel.maxDepth', '7');
    const other = structuredClone(first);
    other.id = '22222222-2222-4222-8222-222222222222';
    (other.project.channel as { blockage: number; maxDepth: number }).blockage = 5;
    (other.project.channel as { blockage: number; maxDepth: number }).maxDepth = 3;
    rerender(<MissionControlScenarioControls state={scenario(other)} onSelectPreset={select} onChangeAssumption={change} />);
    expect(screen.getByRole('slider', { name: 'Blockage assumption' }).getAttribute('value')).toBe('5');
    expect(screen.getByRole('spinbutton', { name: 'Max trace depth' }).getAttribute('value')).toBe('3');
  });

  it('persists a preset through the controller and keeps validation and project switching scoped', async () => {
    const user = userEvent.setup();
    const other = structuredClone(first);
    other.id = '22222222-2222-4222-8222-222222222222';
    other.name = 'Other plan';
    other.project.name = other.name;
    const workspace = workspaceSchema.parse({
      schemaVersion: 1, activeProjectId: first.id, projects: [first, other],
    });
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    await controller.hydrate();
    render(<ScenarioHarness controller={controller} />);
    await user.click(screen.getByRole('button', { name: 'Urban blockage' }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'Urban blockage' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('slider', { name: 'Blockage assumption' }).getAttribute('value')).toBe('48');
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Scenario selected');
    const ue = screen.getByRole('spinbutton', { name: 'Virtual UE count' });
    fireEvent.change(ue, { target: { value: '50001' } });
    fireEvent.blur(ue);
    expect(screen.getByRole('alert').textContent).toContain('Invalid UE count');
    expect(api.write).toHaveBeenCalledTimes(2);
    await controller.dispatch(next => activateWorkspaceProject(next, other.id) as WorkspaceSnapshot);
    await waitFor(() => expect(screen.getByRole('slider', { name: 'Blockage assumption' }).getAttribute('value')).toBe('12'));
    expect(screen.getByRole('button', { name: 'Baseline' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(controller.getSnapshot().workspace?.projects[1].activity).toHaveLength(0);
  });

  it('retains an unsaved numeric draft and labels an asynchronous save failure accurately', async () => {
    const change = vi.fn().mockRejectedValue(new Error('Database unavailable'));
    render(<MissionControlScenarioControls state={scenario()} onSelectPreset={vi.fn()} onChangeAssumption={change} />);
    const ue = screen.getByRole('spinbutton', { name: 'Virtual UE count' });
    fireEvent.change(ue, { target: { value: '2400' } });
    fireEvent.blur(ue);
    expect((await screen.findByRole('alert')).textContent).toContain('Database save needs attention · Database unavailable');
    expect(ue.getAttribute('value')).toBe('2400');
  });
});
