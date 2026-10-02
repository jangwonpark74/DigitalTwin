import { webcrypto } from 'node:crypto';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { defaultProject } from '../../../model.mjs';
import { parseDmCsv } from '../../../dm.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import { retainMeasurementDataset, selectMeasurementDataset } from '../../../measurement-library.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import MeasurementDatasetsWorkspace from './MeasurementDatasetsWorkspace';
import { projectMapSession } from '../city-map/ProjectMapSession';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm\n0,NR,A,37.5,127,-120\n1,NR,B,37.501,127.001,';
beforeEach(() => vi.stubGlobal('crypto', webcrypto));
afterEach(() => vi.unstubAllGlobals());
const now = () => '2026-10-02T02:00:00Z';
async function setup(retained = true, failing = false) {
  let project: Record<string, unknown> = defaultProject(); const first = buildDriveMeasurements(parseDmCsv(csv), 'first.csv'); project.driveMeasurements = first;
  if (retained) project = await retainMeasurementDataset(project, { ...first, fileName: 'second.csv' }, { now });
  const workspace = workspaceSchema.parse(createWorkspaceState(undefined, { id: '11111111-1111-4111-8111-111111111111', now }));
  workspace.projects[0].project = project;
  const api = { read: vi.fn().mockResolvedValue({ revision: 1, workspace }), write: failing ? vi.fn().mockRejectedValue(new Error('Database offline')) : vi.fn().mockImplementation(async (_: unknown, rev: number) => rev + 1) };
  const controller = new AppController(api); await controller.hydrate(); const navigate = vi.fn();
  render(<MeasurementDatasetsWorkspace controller={controller} record={controller.getSnapshot().workspace!.projects[0]} onNavigate={navigate} />);
  return { controller, api, navigate };
}

it('reviews an inactive version before using it, preserves history and offers geographic analysis', async () => {
  const { controller, navigate } = await setup();
  const map = projectMapSession(controller, controller.getSnapshot().workspace!.activeProjectId, defaultProject().map);
  map.update({ selectedIndex: 1 });
  fireEvent.click(screen.getByRole('button', { name: 'Review v1 first.csv' }));
  expect(screen.getByRole('region', { name: 'Selected measurement dataset' }).textContent).toContain('1 / 2');
  expect(screen.getByText(/2 unresolved/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Use for working analysis' }));
  await screen.findByText('Working dataset selected');
  expect(map.getSnapshot().selectedIndex).toBeNull();
  expect((controller.getSnapshot().workspace!.projects[0].project.driveMeasurements as { fileName: string }).fileName).toBe('first.csv');
  expect((controller.getSnapshot().workspace!.projects[0].project.measurementLibrary as { records: unknown[] }).records).toHaveLength(2);
  fireEvent.click(screen.getByRole('button', { name: 'Open measurement analysis' }));
  expect(navigate).toHaveBeenCalledWith('drive');
});

it('keeps legacy evidence unchanged until explicitly retained and rejects generic controller removal', async () => {
  const { controller } = await setup(false);
  expect(controller.getSnapshot().workspace!.projects[0].project.measurementLibrary).toBeUndefined();
  fireEvent.click(screen.getByRole('button', { name: 'Retain current dataset' }));
  await screen.findByText('Current dataset retained');
  expect((controller.getSnapshot().workspace!.projects[0].project.measurementLibrary as { records: unknown[] }).records).toHaveLength(1);
  expect(() => controller.dispatch(workspace => { delete workspace.projects[0].project.measurementLibrary; return workspace; })).toThrow(/immutable/);
});

it('preserves the failed selection draft and locks changes until the database is resolved', async () => {
  const { controller, api } = await setup(true, true);
  fireEvent.click(screen.getByRole('button', { name: 'Review v1 first.csv' }));
  fireEvent.click(screen.getByRole('button', { name: 'Use for working analysis' }));
  expect((await screen.findByRole('alert')).textContent).toContain('Database offline');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Use for working analysis' })).toHaveProperty('disabled', true));
  expect(controller.getSnapshot().dirty).toBe(true); expect(api.write).toHaveBeenCalledTimes(1);
});

it('clears the old sample selection when a database reload selects different working evidence', async () => {
  const { controller, api } = await setup();
  const workspace = structuredClone(controller.getSnapshot().workspace!);
  const library = workspace.projects[0].project.measurementLibrary as { records: { id: string }[] };
  workspace.projects[0].project = selectMeasurementDataset(workspace.projects[0].project, library.records[0].id);
  const map = projectMapSession(controller, workspace.activeProjectId, defaultProject().map); map.update({ selectedIndex: 1 });
  api.read.mockResolvedValue({ revision: 2, workspace });
  await act(() => controller.hydrate());
  expect(map.getSnapshot().selectedIndex).toBeNull();
});

it('reviews source identities and saves a new interpreted version without changing observations', async () => {
  const { controller } = await setup();
  const before = structuredClone(controller.getSnapshot().workspace!.projects[0].project);
  fireEvent.click(screen.getByRole('button', { name: 'Review cell identities' }));
  fireEvent.change(screen.getByRole('combobox', { name: 'NR A project cell' }), { target: { value: 'SITE-01-C1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save identity interpretation' }));
  await screen.findByText('Cell identity interpretation retained and selected');
  const project = controller.getSnapshot().workspace!.projects[0].project;
  const library = project.measurementLibrary as { records: unknown[] };
  expect(library.records).toHaveLength(3);
  expect(library.records.slice(0, 2)).toEqual((before.measurementLibrary as { records: unknown[] }).records);
  expect((project.driveMeasurements as { samples: unknown[] }).samples).toEqual((before.driveMeasurements as { samples: unknown[] }).samples);
  expect(screen.getByText('1 unresolved serving-cell identifiers in the working inventory.')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Review v1 first.csv' }));
  expect(screen.getByRole('button', { name: 'Review cell identities' })).toHaveProperty('disabled', true);
});
