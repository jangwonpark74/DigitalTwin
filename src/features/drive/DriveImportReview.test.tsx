import { webcrypto } from 'node:crypto';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DriveImportReview from './DriveImportReview';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps\n0,NR,CELL-1,37.5,127.02,-100,-12,5,30,4\n1,NR,UNKNOWN-CELL,37.501,127.021,-110,-14,0,12,2';
afterEach(() => vi.unstubAllGlobals());
describe('drive import review before commit', () => {
  it('shows origin, quality and original extent before saving and keeps unresolved identifiers visible', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<DriveImportReview file={{ name: 'drive.csv', size: csv.length, text: async () => csv }} knownCellIds={['CELL-1']} onCommit={onCommit} onCancel={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Save GPS dataset' }).hasAttribute('disabled')).toBe(true);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validate and preview' })).toHaveProperty('disabled', false));
    fireEvent.change(screen.getByRole('combobox', { name: 'Dataset origin' }), { target: { value: 'field-measured' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    await screen.findByText('UNKNOWN-CELL');
    expect(screen.getByText(/37.50000/)).toBeTruthy();
    expect(onCommit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save GPS dataset' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].evidence).toMatchObject({ origin: 'field-measured', verification: 'unverified', rawCsv: csv });
  });
  it('keeps rejected input reviewable and blocks saving without inventing missing KPIs', async () => {
    const onCommit = vi.fn();
    render(<DriveImportReview file={{ name: 'bad.csv', size: 20, text: async () => csv.replace('-100', 'NaN') }} knownCellIds={[]} onCommit={onCommit} onCancel={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Validate and preview' })).toHaveProperty('disabled', false));
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    expect((await screen.findByRole('alert')).textContent).toContain('rsrp_dbm');
    expect(screen.getByRole('button', { name: 'Save GPS dataset' }).hasAttribute('disabled')).toBe(true);
    expect(onCommit).not.toHaveBeenCalled();
  });
  it('maps vendor fields and units, reviews missing KPI counts and invalidates the preview after mapping edits', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const raw = 'Elapsed,RAT,Cell,Lat,Lon,Rate\n0,NR,A,37.5,127,1000\n1000,NR,A,37.501,127.001,';
    const onCommit = vi.fn().mockResolvedValue(undefined);
    render(<DriveImportReview file={{ name: 'vendor.csv', size: raw.length, text: async () => raw }} knownCellIds={['A']} onCommit={onCommit} onCancel={vi.fn()} />);
    for (const [field, column] of [['Elapsed time', 'Elapsed'], ['Radio technology', 'RAT'], ['Serving cell', 'Cell'], ['Latitude', 'Lat'], ['Longitude', 'Lon'], ['DL throughput', 'Rate']]) {
      fireEvent.change(await screen.findByLabelText(`${field} source column`), { target: { value: column } });
    }
    expect(screen.getByLabelText('DL throughput source column').closest('details')).toHaveProperty('open', true);
    fireEvent.change(screen.getByLabelText('Elapsed time source unit'), { target: { value: 'ms' } });
    fireEvent.change(screen.getByLabelText('DL throughput source unit'), { target: { value: 'kbps' } });
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    await screen.findByRole('table', { name: 'KPI availability' });
    expect(screen.getByRole('button', { name: 'Save GPS dataset' })).toHaveProperty('disabled', false);
    fireEvent.change(screen.getByLabelText('DL throughput source unit'), { target: { value: 'Mbps' } });
    expect(screen.queryByRole('table', { name: 'KPI availability' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Save GPS dataset' })).toHaveProperty('disabled', true);
    fireEvent.click(screen.getByRole('button', { name: 'Validate and preview' }));
    await screen.findByRole('table', { name: 'KPI availability' });
    fireEvent.click(screen.getByRole('button', { name: 'Save GPS dataset' }));
    await waitFor(() => expect(onCommit).toHaveBeenCalledTimes(1));
    expect(onCommit.mock.calls[0][0].samples[0]).toMatchObject({ timeS: 0, dlMbps: 1000, rsrpDbm: null });
  });
});
