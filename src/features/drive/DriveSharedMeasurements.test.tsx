import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { defaultProject } from '../../../model.mjs';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { buildDriveMeasurements } from '../../../drive-measurements.mjs';
import { parseDmCsv } from '../../../dm.mjs';
import { workspaceSchema } from '../../api/schemas';
import { AppController } from '../../app/AppController';
import { projectMapSession, ProjectMapSession } from '../city-map/ProjectMapSession';
import DrivePreviewLeaf from './DrivePreviewLeaf';
import { DriveSession } from './DriveSession';

vi.mock('../site-planner/OpenSiteScene', () => ({ default: ({ project, onSelectDriveSample }: { project: { driveView: { metric: string; selectedIndex: number } }; onSelectDriveSample: (index: number) => void }) =>
  <div aria-label="Geographic drive map">{project.driveView.metric} · sample {project.driveView.selectedIndex}<button onClick={() => onSelectDriveSample(2)}>Pick GPS sample 3</button></div> }));

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event\n0,LTE,SITE-01-C1,37.5,127.02,-90,-9,17,35,8,\n1,NR,SITE-01-C1,37.501,127.021,-115,-16,-2,3,1,handover\n2,NR,SITE-02-C1,37.502,127.022,-117,-17,-3,2,0.5,';
const projectWithMeasurements = () => ({ ...defaultProject(), driveMeasurements: buildDriveMeasurements(parseDmCsv(csv), 'gangnam.csv') });

describe('canonical project drive measurements', () => {
  it('loads saved GPS data on reopen and synchronizes RAT, metric and original sample identity both ways', () => {
    const project = projectWithMeasurements(), shared = new ProjectMapSession();
    shared.update({ technology: 'NR', metric: 'sinr', selectedIndex: 2 });
    const session = new DriveSession('pilot', project, shared);
    expect(session.getSnapshot()).toMatchObject({ filename: 'gangnam.csv', metric: 'sinr', technology: 'NR', position: 1 });
    expect(session.getSnapshot().trace?.samples).toHaveLength(3);
    session.jumpToSample(1);
    expect(shared.getSnapshot().selectedIndex).toBe(1);
    shared.update({ metric: 'rsrp', selectedIndex: 2 });
    expect(session.getSnapshot()).toMatchObject({ metric: 'rsrp', position: 1 });
    session.dispose();
    const reopened = new DriveSession('pilot', project, shared);
    expect(reopened.getSnapshot().trace?.samples[2].longitude).toBe(127.022);
    expect(reopened.getSnapshot().position).toBe(1);
    reopened.setProject('other', defaultProject(), new ProjectMapSession());
    expect(reopened.getSnapshot()).toMatchObject({ projectId: 'other', trace: null, filename: '', technology: 'ALL', position: 0 });
    reopened.dispose();
  });

  it('uses the geographic map for saved data and shares table/map selection without duplicate import', async () => {
    const workspace = workspaceSchema.parse(createWorkspaceState(projectWithMeasurements() as unknown as ReturnType<typeof defaultProject>, { id: '11111111-1111-4111-8111-111111111111' }));
    const controller = new AppController({ read: async () => ({ workspace, revision: 1 }), write: async () => 2 });
    await controller.hydrate();
    const record = controller.getSnapshot().workspace!.projects[0];
    const shared = projectMapSession(controller, record.id, record.project.map as { latitude: number; longitude: number; radiusMeters: number });
    shared.update({ metric: 'sinr', technology: 'NR', selectedIndex: 1 });
    const view = render(<DrivePreviewLeaf controller={controller} record={record} onError={vi.fn()} />);
    expect(screen.getByLabelText('Geographic drive map').textContent).toContain('sinr · sample 1');
    expect(screen.getByText(/Local file gangnam.csv/)).toBeTruthy();
    fireEvent.click(screen.getByText('Pick GPS sample 3'));
    expect(shared.getSnapshot().selectedIndex).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: '#2' }));
    expect(shared.getSnapshot().selectedIndex).toBe(1);
    expect(screen.getByText(/1.5 m/)).toBeTruthy();
    view.unmount();
    render(<DrivePreviewLeaf controller={controller} record={record} onError={vi.fn()} />);
    expect(screen.getByLabelText('Geographic drive map').textContent).toContain('sinr · sample 1');
  });
});
