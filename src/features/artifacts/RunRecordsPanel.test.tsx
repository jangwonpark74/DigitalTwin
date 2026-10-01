import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import RunRecordsPanel from './RunRecordsPanel';

const projectId = '11111111-1111-4111-8111-111111111111';
const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: projectId, now: () => '2026-01-01T00:00:00Z' }));
const run = (id: string, status: 'complete' | 'failed' = 'complete', totalPaths: number | null = 2) => ({
  id, projectId, taskId: null, kind: 'sionna-rt', status, createdAt: '2026-01-02T12:00:00Z',
  completedAt: '2026-01-02T12:01:00Z', error: status === 'failed' ? 'runtime unavailable' : null, totalPaths,
});

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } });
});

function setup() {
  const api = { read: vi.fn().mockResolvedValue({ revision: 0, workspace }), write: vi.fn().mockResolvedValue(1) };
  const queries = {
    artifacts: vi.fn().mockResolvedValue([]),
    runs: vi.fn().mockImplementation(async (_id: string, { offset = 0 }: { offset?: number } = {}) => offset === 0
      ? { runs: [run('run-1')], total: 2, nextOffset: 1 }
      : { runs: [run('run-2', 'failed', null)], total: 2, nextOffset: null }),
    run: vi.fn().mockImplementation(async (_projectId: string, id: string) => ({ ...run(id), input: { maxDepth: 3 }, result: { totalPaths: 2, paths: [{ id: 'path-1' }] } })),
  };
  return { queries, controller: new AppController(api, queries), record: workspace.projects[0] };
}

describe('RunRecordsPanel', () => {
  it('refreshes a project-scoped page, loads details, and appends older pages', async () => {
    const { controller, record, queries } = setup();
    await controller.hydrate();
    render(<RunRecordsPanel controller={controller} record={record} />);
    expect(await screen.findByRole('button', { name: /run-1.*complete/i })).toBeTruthy();
    expect(queries.runs).toHaveBeenCalledWith(projectId, { limit: 50 });
    fireEvent.click(screen.getByRole('button', { name: /run-1.*complete/i }));
    expect(await screen.findByText(/"maxDepth": 3/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load older runs' }));
    expect(await screen.findByRole('button', { name: /run-2.*failed/i })).toBeTruthy();
    await waitFor(() => expect(controller.getSnapshot().runs.data?.runs).toHaveLength(2));
    expect(controller.getSnapshot().selectedRun.data?.id).toBe('run-1');
  });
});
