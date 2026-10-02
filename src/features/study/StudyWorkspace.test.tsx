import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import StudyWorkspace from './StudyWorkspace';
import { mutateStudy } from './studyCommands';
import { saveStudyDefinition, captureBaseline } from '../../../study.mjs';

afterEach(() => vi.unstubAllGlobals());
const projectId = '11111111-1111-4111-8111-111111111111';
async function setup() {
  vi.stubGlobal('crypto', webcrypto);
  const state = createWorkspaceState(undefined, { id: projectId }) as WorkspaceSnapshot;
  const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace: state }), write: vi.fn().mockResolvedValue(2) };
  const controller = new AppController(api); await controller.hydrate();
  return { controller, api, state };
}
describe('saved study workflow', () => {
  it('captures an immutable baseline and retains candidate changes, revision history and reverts', async () => {
    const { controller } = await setup();
    render(<StudyWorkspace controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Study objective'), { target: { value: 'Reduce weak street segments' } });
    fireEvent.change(screen.getByLabelText('Operator declaration'), { target: { value: 'SKT' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save study definition' }));
    await screen.findByText('Definition v1 saved');
    fireEvent.click(screen.getByRole('button', { name: 'Continue to baselines' }));
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Gangnam baseline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Capture baseline' }));
    await screen.findByText('Baseline captured');
    const baseline = structuredClone((controller.getSnapshot().workspace!.projects[0].project.study as any).baselines[0]);
    fireEvent.change(screen.getByLabelText('Candidate name'), { target: { value: 'Tilt candidate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create candidate' }));
    await screen.findByText('Candidate v1 created');
    fireEvent.change(screen.getByLabelText('RF parameter'), { target: { value: 'downtiltDeg' } });
    fireEvent.change(screen.getByLabelText('Candidate value'), { target: { value: '8' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save candidate revision' }));
    await screen.findByText('Candidate v2 saved');
    expect(screen.getByRole('table', { name: 'Exact candidate changes' }).textContent).toContain('6');
    expect(screen.getByRole('table', { name: 'Exact candidate changes' }).textContent).toContain('8');
    expect((controller.getSnapshot().workspace!.projects[0].project.study as any).baselines[0]).toEqual(baseline);
    fireEvent.click(screen.getByRole('button', { name: /Revert Downtilt/ }));
    await screen.findByText('Candidate v3 saved');
    expect((controller.getSnapshot().workspace!.projects[0].project.study as any).candidates[0].versions).toHaveLength(3);
    expect(screen.getByText('No RF changes in this revision.')).toBeTruthy();
  });
  it('keeps failed database drafts visible and never declares them confirmed', async () => {
    const { controller, api } = await setup();
    api.write.mockRejectedValue(new Error('Database unavailable'));
    render(<StudyWorkspace controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onNavigate={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Study objective'), { target: { value: 'Review' } });
    fireEvent.change(screen.getByLabelText('Operator declaration'), { target: { value: 'Unknown' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save study definition' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Database unavailable');
    expect(screen.queryByText('Definition v1 saved')).toBeNull();
    expect(controller.getSnapshot().dirty).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Baselines & candidates' }));
    expect(screen.getByRole('button', { name: 'Capture baseline' }).closest('fieldset')?.disabled).toBe(true);
  });
  it('rejects an asynchronous capture if the project changes before commit', async () => {
    const { controller } = await setup();
    let release!: (value: any) => void;
    const deferred = new Promise<any>(resolve => { release = resolve; });
    const pending = mutateStudy(controller, projectId, () => deferred, 'Baseline captured');
    const original = controller.getSnapshot().workspace!.projects[0].project;
    await controller.dispatch(workspace => { workspace.projects[0].project.scenario = 'custom'; return workspace; });
    release(await captureBaseline(saveStudyDefinition(original, { objective: 'Review', operator: 'Unknown', rat: 'ALL' }), 'Baseline'));
    await expect(pending).rejects.toThrow(/changed/i);
    await waitFor(() => expect(controller.getSnapshot().workspace!.projects[0].project.study).toBeUndefined());
  });
  it('rejects rewriting captured history through a generic controller command', async () => {
    const { controller, api } = await setup();
    await mutateStudy(controller, projectId, async project => captureBaseline(saveStudyDefinition(project,
      { objective: 'Review', operator: 'Unknown', rat: 'ALL' }), 'Baseline'), 'Baseline captured');
    const writes = api.write.mock.calls.length;
    expect(() => controller.dispatch(workspace => {
      (workspace.projects[0].project.study as any).baselines[0].name = 'Rewritten'; return workspace;
    })).toThrow(/immutable/i);
    expect(api.write).toHaveBeenCalledTimes(writes);
  });
});
