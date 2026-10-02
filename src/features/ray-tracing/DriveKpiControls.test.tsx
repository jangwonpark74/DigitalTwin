import { render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import DriveKpiControls, { DriveKpiInspector } from './DriveKpiControls';
import type { DriveSample } from './driveKpi';
import { defaultProject } from '../../../model.mjs';
import { prepareCellIdentity } from '../../../cell-identity.mjs';

const samples: DriveSample[] = [0, 1].map(index => ({ index, timeS: index, latitude: 37.5, longitude: 127 + index * .001,
  technology: 'NR', servingCell: 'A', event: '', provenance: 'imported-unverified', rsrpDbm: index === 0 ? -120 : null,
  rsrqDb: null, sinrDb: null, dlMbps: index === 0 ? 0 : null, ulMbps: null }));
it('shows available KPI denominators and a neutral unavailable legend', () => {
  render(<DriveKpiControls measurements={null} samples={samples} metric="rsrp" technology="ALL" visible busy={false} error=""
    onMetric={vi.fn()} onTechnology={vi.fn()} onVisible={vi.fn()} onFit={vi.fn()} />);
  expect(screen.getByText('1 poor / 1 available · 100% · 1 missing')).toBeTruthy();
  expect(screen.getByText('Unavailable')).toBeTruthy();
});
it('keeps absent selected values distinct from actual zero throughput', () => {
  const view = render(<DriveKpiInspector samples={samples} metric="dl" selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByText('0.0')).toBeTruthy();
  view.rerender(<DriveKpiInspector samples={samples} metric="dl" selectedIndex={1} onSelect={vi.fn()} />);
  expect(screen.getByText('Unavailable')).toBeTruthy();
  expect(screen.queryByText('0.0')).toBeNull();
  expect(screen.getByText(/RSRP — dBm/)).toBeTruthy();
});

it('shows source and associated inventory identities and stops resolving a removed target', () => {
  const project = defaultProject(), onSite = vi.fn();
  const measurements = prepareCellIdentity({ schemaVersion: 2, source: 'imported-unverified', coordinateMode: 'gps', fileName: 'source.csv', samples }, project.sites,
    [{ technology: 'NR', sourceCell: 'A', targetCellId: 'SITE-01-C1' }]);
  const view = render(<DriveKpiInspector samples={samples} measurements={measurements} sites={project.sites} onSite={onSite} metric="rsrp" selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByText(/Project cell: SITE-01-C1/)).toBeTruthy();
  expect(screen.getByText(/Reviewed association · unverified/)).toBeTruthy();
  screen.getByRole('button', { name: 'Select associated site' }).click();
  expect(onSite).toHaveBeenCalledWith('SITE-01');
  view.rerender(<DriveKpiInspector samples={samples} measurements={measurements} sites={[]} onSite={onSite} metric="rsrp" selectedIndex={0} onSelect={vi.fn()} />);
  expect(screen.getByText(/Target cell missing/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Select associated site' })).toBeNull();
});
