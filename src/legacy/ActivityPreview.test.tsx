import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppController } from '../app/AppController';
import { WorkspaceConflictError } from '../api/workspaceApi';
import { createWorkspaceState } from '../../workspaces.mjs';
import { workspaceSchema } from '../api/schemas';
import ActivityPreview from './ActivityPreview';

const initial = createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now: () => '2026-01-01T00:00:00Z' });
const second = structuredClone(workspaceSchema.parse(initial).projects[0]);
second.id = '22222222-2222-4222-8222-222222222222';
second.name = 'Another pilot';
second.project.name = second.name;
second.activity = [{ when: '2026-01-01T00:00:00Z', title: 'Other project activity', detail: 'Not from the first project' }];
const workspace = workspaceSchema.parse({ ...initial, projects: [initial.projects[0], second] });

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  });
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn().mockReturnValue('blob:manifest') });
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
});

describe('isolated activity migration preview', () => {
  it('hydrates once, switches projects through the sole controller, and logs an exported manifest', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockResolvedValueOnce(3).mockResolvedValueOnce(4) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    expect(await screen.findByRole('heading', { name: 'Activity & handoff' })).toBeTruthy();
    expect(api.read).toHaveBeenCalledTimes(1);
    const focusTarget = screen.getByRole('region', { name: 'Activity migration preview' });
    await waitFor(() => expect(document.activeElement).toBe(focusTarget));
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('RAN Twin · City Pilot');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Activity');
    expect(screen.queryByText('Other project activity')).toBeNull();
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    await waitFor(() => expect(screen.getByText('Other project activity')).toBeTruthy());
    expect(screen.getByRole('region', { name: 'Active project context' }).textContent).toContain('Another pilot');
    expect(api.write).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace?.activeProjectId).toBe(second.id);
    await user.click(screen.getByRole('button', { name: /Export planning manifest/i }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace?.projects[1].activity[0].title).toBe('Manifest exported');
    expect(controller.getSnapshot().workspace?.projects[0].activity).toHaveLength(0);
    expect(screen.getByText('Manifest exported')).toBeTruthy();
    expect(api.write.mock.calls[1][1]).toBe(3);
  });

  it('shows a recoverable database error without rendering a second shell', async () => {
    const api = { read: vi.fn().mockRejectedValue(new Error('Database unavailable')),
      write: vi.fn() };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', expect.stringContaining('Database unavailable'));
    expect(screen.queryByRole('region', { name: 'Legacy activity route' })).toBeNull();
  });

  it('navigates between exactly one activity and stack leaf and persists scoped endpoint labels', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'RAN topology' }));
    expect(screen.queryByRole('region', { name: 'Legacy activity route' })).toBeNull();
    expect(screen.getByRole('region', { name: 'RAN topology preview route' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Physical-to-virtual RAN stack' })).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('RAN topology');
    expect(screen.getByRole('region', { name: 'Activity migration preview' })).toBe(document.activeElement);
    expect(screen.getByRole('button', { name: 'RAN topology' }).getAttribute('aria-current')).toBe('page');
    const input = screen.getByRole('textbox', { name: 'vCore endpoint label' });
    fireEvent.change(input, { target: { value: 'local-core' } });
    fireEvent.blur(input);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(api.write.mock.calls.map((call: unknown[]) => call[1])).toEqual([2, 3]);
    expect((controller.getSnapshot().workspace?.projects[0].project.integration as { vCoreEndpoint: string }).vCoreEndpoint).toBe('local-core');
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Project setting changed');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    await waitFor(() => expect(controller.getSnapshot().workspace?.activeProjectId).toBe(second.id));
    expect(screen.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveProperty('value', '');
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByRole('region', { name: 'Activity preview route' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'RAN topology preview route' })).toBeNull();
    expect(screen.getByText('Other project activity')).toBeTruthy();
  });

  it('keeps monitoring threshold edits project-scoped and rejects invalid input without inventing telemetry', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    const system = screen.getByRole('button', { name: /SYSTEM/i });
    await user.click(system);
    await user.click(screen.getByRole('button', { name: 'Monitoring' }));
    expect(screen.getByRole('region', { name: 'Monitoring preview route' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Legacy activity route' })).toBeNull();
    expect(screen.getAllByText('NO DATA', { exact: true })).toHaveLength(2);
    expect(screen.getByText('OFFLINE', { exact: true })).toBeTruthy();
    fireEvent.change(screen.getByRole('spinbutton', { name: /H200 GPU utilization threshold/i }), { target: { value: '92' } });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    const monitoring = controller.getSnapshot().workspace?.projects[0].project.management as {
      monitoring: { connected: boolean; lastSample: null; thresholds: { gpuUtilizationPct: number; fronthaulLatencyMs: number } };
    };
    expect(monitoring.monitoring).toMatchObject({ connected: false, lastSample: null, thresholds: { gpuUtilizationPct: 92 } });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Monitoring threshold changed');
    fireEvent.change(screen.getByRole('spinbutton', { name: /latency threshold/i }), { target: { value: '501' } });
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').textContent).toContain('Invalid monitoring threshold fronthaulLatencyMs');
    expect(screen.getByRole('spinbutton', { name: /latency threshold/i })).toHaveProperty('value', '10');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect(screen.getByRole('spinbutton', { name: /H200 GPU utilization threshold/i })).toHaveProperty('value', '85');
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Other project activity')).toBeTruthy();
  });

  it('saves software version targets without claiming installation and resets rejected versions', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: /SYSTEM/i }));
    await user.click(screen.getByRole('button', { name: 'Software management' }));
    expect(screen.getByRole('region', { name: 'Software preview route' })).toBeTruthy();
    expect(screen.getAllByText('NOT VERIFIED')).toHaveLength(6);
    fireEvent.change(screen.getByRole('textbox', { name: 'Target version for Sionna-RT' }), { target: { value: ' 2.1.0 ' } });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    const firstSoftware = (controller.getSnapshot().workspace?.projects[0].project.management as {
      software: { id: string; targetVersion: string; installation: string }[];
    }).software;
    expect(firstSoftware.find(item => item.id === 'sionna-rt')).toMatchObject({ targetVersion: '2.1.0', installation: 'not-verified' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Software target version changed');
    fireEvent.change(screen.getByRole('textbox', { name: 'Target version for Sionna-RT' }), { target: { value: 'bad version!' } });
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').textContent).toContain('Invalid target version for sionna-rt');
    expect(screen.getByRole('textbox', { name: 'Target version for Sionna-RT' })).toHaveProperty('value', '2.1.0');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect(screen.getByRole('textbox', { name: 'Target version for Sionna-RT' })).toHaveProperty('value', 'unassigned');
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Other project activity')).toBeTruthy();
  });

  it('reschedules a planned task without dispatching work and rejects dates before prerequisites', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: /TASKS & SCHEDULE/i }));
    await user.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(screen.getByRole('region', { name: 'Schedule preview route' })).toBeTruthy();
    expect(screen.getByText(/Planning calendar only/i)).toBeTruthy();
    expect(screen.getAllByText('NOT RUN')).toHaveLength(7);
    const tasks = controller.getSnapshot().workspace?.projects[0].project.tasks as { id: string; dueDate: string; execution: string }[];
    const original = tasks.find(task => task.id === 'T-01')!.dueDate;
    const valid = tasks.find(task => task.id === 'T-02')!.dueDate;
    fireEvent.change(screen.getByLabelText('Reschedule T-01'), { target: { value: valid } });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect((controller.getSnapshot().workspace?.projects[0].project.tasks as typeof tasks)[0]).toMatchObject({ dueDate: valid, execution: 'not-executed' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Task date changed', detail: `T-01 → ${valid}` });
    fireEvent.change(screen.getByLabelText('Reschedule T-02'), { target: { value: '2000-01-01' } });
    expect(api.write).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('alert').textContent).toContain('Task T-02 scheduled before dependency T-01');
    expect((screen.getByLabelText('Reschedule T-02') as HTMLInputElement).value).toBe(valid);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect((screen.getByLabelText('Reschedule T-01') as HTMLInputElement).value).toBe(original);
    await user.click(screen.getByRole('button', { name: 'Activity' }));
    expect(screen.getByText('Other project activity')).toBeTruthy();
  });

  it('uses the Task board form for planned-only project-scoped work and rejects invalid dependencies', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const queries = { artifacts: vi.fn(), runs: vi.fn().mockResolvedValue({ runs: [], total: 0, nextOffset: null }), run: vi.fn() };
    const controller = new AppController(api, queries);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: /TASKS & SCHEDULE/i }));
    await user.click(screen.getByRole('button', { name: 'Task board' }));
    expect(screen.getByRole('region', { name: 'Task board preview route' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Run records' })).toBeTruthy();
    expect(document.querySelector('[data-run-refresh]')).toBeNull();
    await waitFor(() => expect(queries.runs).toHaveBeenCalledWith(workspace.activeProjectId, { limit: 50 }));
    expect(screen.getByText('No Sionna-RT run has been recorded for this project.')).toBeTruthy();
    expect(screen.getByText('NO DISPATCH')).toBeTruthy();
    const tasks = controller.getSnapshot().workspace?.projects[0].project.tasks as { id: string; dueDate: string }[];
    const due = tasks.find(item => item.id === 'T-02')!.dueDate;
    const form = document.querySelector<HTMLFormElement>('#add-task-form')!;
    fireEvent.change(form.querySelector('[name="title"]')!, { target: { value: 'Validate antenna patterns' } });
    fireEvent.change(form.querySelector('[name="dueDate"]')!, { target: { value: due } });
    fireEvent.change(form.querySelector('[name="dependency"]')!, { target: { value: 'T-01' } });
    fireEvent.submit(form);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    const updated = controller.getSnapshot().workspace?.projects[0].project.tasks as { id: string; title: string; status: string; execution: string }[];
    expect(updated.at(-1)).toMatchObject({ id: 'T-08', title: 'Validate antenna patterns', status: 'planned', execution: 'not-executed' });
    expect(controller.getSnapshot().workspace?.projects[0].activity[0].title).toBe('Task added to plan');
    const rejected = document.querySelector<HTMLFormElement>('#add-task-form')!;
    fireEvent.change(rejected.querySelector('[name="title"]')!, { target: { value: 'Too early' } });
    fireEvent.change(rejected.querySelector('[name="dueDate"]')!, { target: { value: '2000-01-01' } });
    fireEvent.change(rejected.querySelector('[name="dependency"]')!, { target: { value: 'T-01' } });
    fireEvent.submit(rejected);
    expect(screen.getByRole('alert').textContent).toContain('Task T-09 scheduled before dependency T-01');
    expect(api.write).toHaveBeenCalledTimes(2);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect((controller.getSnapshot().workspace?.projects[1].project.tasks as typeof updated)).toHaveLength(7);
    expect(screen.queryByText('Validate antenna patterns')).toBeNull();
  });

  it('shows project-scoped run pages and detail without marking delivery tasks executed', async () => {
    const user = userEvent.setup();
    const run = { id: 'run-1', projectId: workspace.activeProjectId, taskId: null, kind: 'sionna-rt',
      status: 'queued' as const, createdAt: '2026-01-01', completedAt: null, totalPaths: null, error: null };
    const queries = { artifacts: vi.fn(), runs: vi.fn()
      .mockResolvedValueOnce({ runs: [run], total: 2, nextOffset: 1 })
      .mockResolvedValueOnce({ runs: [{ ...run, id: 'run-2' }], total: 2, nextOffset: null })
      .mockResolvedValueOnce({ runs: [], total: 0, nextOffset: null }),
    run: vi.fn().mockResolvedValue({ ...run, input: {}, result: null }) };
    const controller = new AppController({ read: vi.fn().mockResolvedValue({ revision: 2, workspace }), write: vi.fn().mockResolvedValue(3) }, queries);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: /TASKS & SCHEDULE/i }));
    await user.click(screen.getByRole('button', { name: 'Task board' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run run-1 · queued/ })).toBeTruthy());
    expect(screen.getByText(/2 runs recorded/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: /Run run-1 · queued/ }));
    await screen.findByRole('article', { name: 'Run detail run-1' });
    await user.click(screen.getByRole('button', { name: 'Load older runs' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Run run-2 · queued/ })).toBeTruthy());
    expect(controller.getSnapshot().selectedRun.data?.id).toBe('run-1');
    await user.click(screen.getByRole('button', { name: 'Refresh run list' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: /Run run-1 · queued/ })).toBeNull());
    expect(controller.getSnapshot().selectedRun.data).toBeNull();
    expect(screen.getByText('No Sionna-RT run has been recorded for this project.')).toBeTruthy();
  });

  it('keeps virtual UE planning fields project-scoped and rejects an invalid population without starting processes', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'Virtual UE fleet' }));
    expect(screen.getByText('No UE processes are running in the browser')).toBeTruthy();
    const population = screen.getByRole('spinbutton', { name: 'UE population' });
    fireEvent.change(population, { target: { value: '1800' } });
    fireEvent.blur(population);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(screen.getByText('1,800 PLANNED')).toBeTruthy();
    expect(screen.getAllByText('600 UEs')).toHaveLength(3);
    fireEvent.change(screen.getByRole('combobox', { name: 'Mobility profile' }), { target: { value: 'Vehicular cluster' } });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(4));
    const seed = screen.getByRole('spinbutton', { name: 'Reproducibility seed' });
    fireEvent.change(seed, { target: { value: '71' } });
    fireEvent.blur(seed);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(6));
    fireEvent.click(document.querySelector('[data-site-select="SITE-02"]')!);
    expect(api.write).toHaveBeenCalledTimes(6);
    fireEvent.change(population, { target: { value: '50001' } });
    fireEvent.blur(population);
    expect(screen.getByRole('alert').textContent).toContain('Invalid UE count');
    expect((screen.getByRole('spinbutton', { name: 'UE population' }) as HTMLInputElement).value).toBe('1800');
    expect(api.write).toHaveBeenCalledTimes(6);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect(screen.getByText('1,200 PLANNED')).toBeTruthy();
    expect((controller.getSnapshot().workspace?.projects[0].project.ue as { count: number }).count).toBe(1800);
    expect((controller.getSnapshot().workspace?.projects[1].project.ue as { count: number }).count).toBe(1200);
  });

  it('keeps paired A/B edits scoped, rejects invalid seeds, and logs a planning export', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'USE CASES' }));
    await user.click(screen.getByRole('button', { name: 'Package A/B test' }));
    expect(screen.getByText('NO VERDICT')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Export A\/B experiment plan/i })).toBeTruthy();
    const seeds = screen.getByRole('textbox', { name: 'Paired random seeds' });
    fireEvent.change(seeds, { target: { value: '7, 8' } });
    fireEvent.blur(seeds);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(document.querySelectorAll('.data-table tbody tr')).toHaveLength(6);
    fireEvent.change(seeds, { target: { value: '7, 7' } });
    fireEvent.blur(seeds);
    expect(screen.getByRole('alert').textContent).toContain('A/B seeds must be unique bounded integers');
    expect((screen.getByRole('textbox', { name: 'Paired random seeds' }) as HTMLInputElement).value).toBe('7, 8');
    expect(api.write).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: /Export A\/B experiment plan/i }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(3));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Use-case plan exported', detail: 'ab' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect(document.querySelectorAll('.data-table tbody tr')).toHaveLength(9);
    expect(controller.getSnapshot().workspace?.projects[1].activity).toEqual(second.activity);
  });

  it('keeps data-plan edits scoped, derives split complements, and exports zero generated rows', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'USE CASES' }));
    await user.click(screen.getByRole('button', { name: 'AI-RAN data generation' }));
    expect(screen.getByText('0 ROWS GENERATED')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Learning task' }), { target: { value: 'handover-prediction' } });
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(screen.getByText(/Handover prediction · requires EM\+RAN/)).toBeTruthy();
    const train = screen.getByRole('spinbutton', { name: 'Train (%)' });
    fireEvent.change(train, { target: { value: '60' } });
    fireEvent.blur(train);
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(4));
    expect((screen.getByRole('spinbutton', { name: 'Test (%)' }) as HTMLInputElement).value).toBe('25');
    const seeds = screen.getByRole('textbox', { name: 'Simulation seeds' });
    fireEvent.change(seeds, { target: { value: '11, 11' } });
    fireEvent.blur(seeds);
    expect(screen.getByRole('alert').textContent).toContain('Data seeds must be unique bounded integers');
    expect((screen.getByRole('textbox', { name: 'Simulation seeds' }) as HTMLInputElement).value).toBe('11, 22, 33');
    expect(api.write).toHaveBeenCalledTimes(4);
    fireEvent.click(screen.getByRole('button', { name: /Export dataset job spec/i }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(5));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().workspace?.projects[0].activity[0]).toMatchObject({ title: 'Use-case plan exported', detail: 'data' });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active project' }), second.id);
    expect((screen.getByRole('spinbutton', { name: 'Train (%)' }) as HTMLInputElement).value).toBe('70');
    expect(controller.getSnapshot().workspace?.projects[1].activity).toEqual(second.activity);
  });

  it('keeps a 409 draft visible and offers read-only comparison, stale retry, and confirmed reload', async () => {
    const user = userEvent.setup();
    const server = structuredClone(workspace);
    (server.projects[0].project.integration as { vCoreEndpoint: string }).vCoreEndpoint = 'server-core';
    const api = { read: vi.fn().mockResolvedValueOnce({ revision: 2, workspace })
      .mockResolvedValueOnce({ revision: 3, workspace: server })
      .mockResolvedValueOnce({ revision: 3, workspace: server }),
    write: vi.fn().mockRejectedValue(new WorkspaceConflictError('Workspace changed in another browser tab')) };
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'RAN topology' }));
    const endpoint = screen.getByRole('textbox', { name: 'vCore endpoint label' });
    fireEvent.change(endpoint, { target: { value: 'local-draft' } });
    fireEvent.blur(endpoint);
    await waitFor(() => expect(controller.getSnapshot().status).toBe('conflict'));
    expect(screen.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveProperty('value', 'local-draft');
    expect(screen.getByRole('alert').textContent).toContain('Workspace changed in another browser tab');
    await user.click(screen.getByRole('button', { name: 'Compare' }));
    expect(await screen.findByRole('region', { name: 'Workspace comparison' })).toHaveProperty('textContent',
      expect.stringContaining('Local revision 2 · Database revision 3'));
    expect(screen.getByRole('region', { name: 'Workspace comparison' }).textContent).toContain('changed');
    expect(screen.getByRole('region', { name: 'Workspace comparison' }).textContent).toContain('project.integration.vCoreEndpoint');
    expect(controller.getSnapshot().revision).toBe(2);
    expect(api.write).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    expect(api.write.mock.calls[1][1]).toBe(2);
    await user.click(screen.getByRole('button', { name: 'Reload database' }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(api.read).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveProperty('value', 'local-draft');
    await user.click(screen.getByRole('button', { name: 'Reload database' }));
    await waitFor(() => expect(controller.getSnapshot()).toMatchObject({ revision: 3, dirty: false, status: 'ready' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('textbox', { name: 'vCore endpoint label' })).toHaveProperty('value', 'server-core');
    expect(screen.queryByRole('region', { name: 'Workspace comparison' })).toBeNull();
  });

  it('routes Radio placement through the preview map and returns with persisted estimate provenance', async () => {
    const user = userEvent.setup();
    const api = { read: vi.fn().mockResolvedValue({ revision: 2, workspace }),
      write: vi.fn().mockImplementation(async (_draft: unknown, revision: number) => revision + 1) };
    const controller = new AppController(api);
    render(<ActivityPreview controller={controller} />);
    await screen.findByRole('heading', { name: 'Activity & handoff' });
    await user.click(screen.getByRole('button', { name: 'Radio planner' }));
    await user.click(document.querySelector('[data-radio-site="SITE-02"]')!);
    await user.click(screen.getByRole('button', { name: /Place on map/i }));
    expect(screen.getByRole('heading', { name: 'City / cluster radio environment' })).toBeTruthy();
    expect(screen.getByRole('form', { name: 'Radio map placement for SITE-02' })).toBeTruthy();
    await user.clear(screen.getByRole('spinbutton', { name: 'Map X position (%)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Map X position (%)' }), '35');
    await user.clear(screen.getByRole('spinbutton', { name: 'Map Y position (%)' }));
    await user.type(screen.getByRole('spinbutton', { name: 'Map Y position (%)' }), '72');
    await user.click(screen.getByRole('button', { name: 'Place radio at these coordinates' }));
    await waitFor(() => expect(api.write).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Breadcrumb' }).textContent).toContain('Radio planner'));
    const placed = controller.getSnapshot().workspace!.projects[0].project.sites as {
      id: string; x: number; y: number; radioLocation: { latitude: number | null; longitude: number | null; source: string };
    }[];
    expect(placed.find(site => site.id === 'SITE-02')).toMatchObject({
      x: 35, y: 72, radioLocation: { source: 'map-estimate' },
    });
    expect(screen.getByText('Schematic-map estimate')).toBeTruthy();
    expect(controller.getSnapshot().workspace!.projects[0].activity[0].title).toBe('Radio location placed on map');
  });
});
