import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceState, addWorkspaceProject } from '../../../workspaces.mjs';
import { defaultProject } from '../../../model.mjs';
import { AppController } from '../../app/AppController';
import RunRecoveryActions from './RunRecoveryActions';

const api = vi.hoisted(() => ({ getRtCapability: vi.fn(), cancelRtJob: vi.fn(), retryRtJob: vi.fn() }));
vi.mock('../../api/rtJobsApi', () => api);
const projectId = '11111111-1111-4111-8111-111111111111';
async function setup() {
  const workspace = createWorkspaceState(defaultProject(), { id: projectId });
  const second = addWorkspaceProject(workspace, defaultProject(), { id: '22222222-2222-4222-8222-222222222222', uniqueName: true });
  second.activeProjectId = projectId;
  const controller = new AppController({ read: vi.fn().mockResolvedValue({ revision: 1, workspace: second }), write: vi.fn().mockResolvedValue(2) });
  await controller.hydrate();
  return { controller, record: controller.getSnapshot().workspace!.projects[0] };
}
beforeEach(() => { vi.resetAllMocks(); vi.stubGlobal('crypto', webcrypto); });
describe('RunRecoveryActions', () => {
  it('retains an accepted retry receipt when record refresh fails and refreshes without creating another job', async () => {
    const { controller, record } = await setup();
    api.getRtCapability.mockResolvedValue({ available: true, jobActions: ['cancel', 'retry'] });
    const receipt = { id: 'retry-1', status: 'queued', retryOf: 'run-1', projectId };
    api.retryRtJob.mockResolvedValue(receipt);
    const onResult = vi.fn().mockRejectedValueOnce(new Error('List connection lost')).mockResolvedValue(undefined);
    render(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'failed', hasCapture: true }} onResult={onResult} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry frozen inputs' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry frozen inputs' }));
    await screen.findByText(/Request accepted for run retry-1/);
    expect(screen.getByRole('button', { name: 'Retry frozen inputs' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh accepted run' }));
    await waitFor(() => expect(onResult).toHaveBeenCalledTimes(2));
    expect(onResult).toHaveBeenLastCalledWith(receipt);
    expect(api.retryRtJob).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Refresh accepted run' })).toBeNull());
  });

  it('requests cancellation without reporting stopped output until the terminal state is confirmed', async () => {
    const { controller, record } = await setup();
    api.getRtCapability.mockResolvedValue({ available: false, jobActions: ['cancel', 'retry'] });
    api.cancelRtJob.mockResolvedValue({ id: 'run-1', status: 'cancelling', projectId, cancelRequestedAt: '2026-10-02' });
    const onResult = vi.fn();
    const view = render(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'running', hasCapture: true }} onResult={onResult} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel path job' }).hasAttribute('disabled')).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel path job' }));
    await waitFor(() => expect(api.cancelRtJob).toHaveBeenCalledWith(projectId, 'run-1'));
    expect(await screen.findByText(/awaiting worker exit/i)).toBeTruthy();
    expect(screen.queryByText(/worker stopped; output discarded/i)).toBeNull();
    view.rerender(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'cancelled', hasCapture: true }} onResult={onResult} />);
    expect(screen.getByText(/worker stopped; output discarded/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry frozen inputs' }).hasAttribute('disabled')).toBe(true);
  });

  it('allows exact retry after its accepted cancellation is confirmed stopped', async () => {
    const { controller, record } = await setup();
    api.getRtCapability.mockResolvedValue({ available: true, jobActions: ['cancel', 'retry'] });
    api.cancelRtJob.mockResolvedValue({ id: 'run-1', status: 'cancelling', projectId, cancelRequestedAt: '2026-10-02' });
    api.retryRtJob.mockResolvedValue({ id: 'retry-1', status: 'queued', projectId, retryOf: 'run-1' });
    const onResult = vi.fn();
    const view = render(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'running', hasCapture: true }} onResult={onResult} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel path job' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel path job' }));
    await screen.findByRole('button', { name: 'Cancellation requested' });
    view.rerender(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'cancelled', hasCapture: true }} onResult={onResult} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry frozen inputs' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'Retry frozen inputs' }));
    await waitFor(() => expect(api.retryRtJob).toHaveBeenCalledWith(projectId, 'run-1'));
  });

  it('retries a retained request once and suppresses late updates after the project changes', async () => {
    const { controller, record } = await setup();
    api.getRtCapability.mockResolvedValue({ available: true, jobActions: ['cancel', 'retry'] });
    let resolve: (value: unknown) => void = () => {};
    api.retryRtJob.mockReturnValue(new Promise(value => { resolve = value; }));
    const onResult = vi.fn();
    render(<RunRecoveryActions controller={controller} record={record} run={{ id: 'run-1', status: 'failed', hasCapture: true }} onResult={onResult} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Retry frozen inputs' }).hasAttribute('disabled')).toBe(false));
    const button = screen.getByRole('button', { name: 'Retry frozen inputs' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(api.retryRtJob).toHaveBeenCalledTimes(1);
    expect(api.retryRtJob).toHaveBeenCalledWith(projectId, 'run-1');
    await act(async () => { await controller.dispatch(workspace => ({ ...workspace, activeProjectId: workspace.projects[1].id })); });
    await act(async () => { resolve({ id: 'retry-1', status: 'queued', retryOf: 'run-1', projectId }); });
    expect(onResult).not.toHaveBeenCalled();
  });
});
