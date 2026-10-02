import { webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { prepareDriveImport, readDriveCsv } from './driveImport';
import { inspectDmCsv } from '../../../dm.mjs';

const csv = 'time_s,technology,serving_cell,latitude,longitude,rsrp_dbm,rsrq_db,sinr_db,dl_mbps,ul_mbps,event,data_kind\n0,NR,CELL-1,37.5,127.02,-100,-12,5,30,4,SYNTHETIC_SAMPLE,synthetic-example\n1,NR,UNKNOWN-CELL,37.501,127.021,-110,-14,0,12,2,,synthetic-example';
afterEach(() => vi.unstubAllGlobals());
describe('reviewable GPS evidence import', () => {
  it('retains a source BOM when reading the original UTF-8 bytes', async () => {
    const raw = '\uFEFF' + csv;
    const bytes = new TextEncoder().encode(raw);
    expect(await readDriveCsv({ text: async () => csv, arrayBuffer: async () => bytes.buffer })).toBe(raw);
  });
  it('preserves raw bytes, a content digest, source declaration and unmatched identities', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const result = await prepareDriveImport({ name: 'gangnam.csv', rawCsv: csv, origin: 'field-measured', sourceDate: '2026-10-01',
      knownCellIds: ['CELL-1'], importedAt: '2026-10-02T00:00:00Z' });
    expect(result.measurements.evidence).toMatchObject({ schemaVersion: 2, origin: 'synthetic', verification: 'unverified',
      rawCsv: csv, sourceDate: '2026-10-01', importedAt: '2026-10-02T00:00:00Z', coordinateReference: 'EPSG:4326' });
    expect(result.measurements.evidence.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.quality).toMatchObject({ accepted: 2, rejected: 0, unmatchedCells: ['UNKNOWN-CELL'] });
    expect(result.quality.warnings.join(' ')).toContain('synthetic');
    expect(result.extent).toEqual({ south: 37.5, north: 37.501, west: 127.02, east: 127.021 });
  });
  it('reports missing KPI populations and rejects malformed provided values and future source dates', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const result = await prepareDriveImport({ name: 'missing.csv', rawCsv: csv.replace('sinr_db', 'missing_sinr'), origin: 'unknown',
      knownCellIds: [], importedAt: '2026-10-02T00:00:00Z' });
    expect(result.quality.metrics.sinr).toMatchObject({ available: 0, missing: 2 });
    expect(result.measurements.samples[0].sinrDb).toBeNull();
    await expect(prepareDriveImport({ name: 'bad.csv', rawCsv: csv.replace('-100', 'NaN'), origin: 'unknown',
      knownCellIds: [] })).rejects.toThrow('rsrp_dbm');
    await expect(prepareDriveImport({ name: 'future.csv', rawCsv: csv, origin: 'unknown', sourceDate: '2027-01-01',
      knownCellIds: [], importedAt: '2026-10-02T00:00:00Z' })).rejects.toThrow('Source date');
  });
  it('retains the normalization recipe and distinguishes different mappings of identical raw source bytes', async () => {
    vi.stubGlobal('crypto', webcrypto);
    const rawCsv = 'time_s,technology,serving_cell,latitude,longitude,Rate\n0,NR,A,37.5,127,1000\n1000,NR,A,37.501,127.001,2000';
    const mapping = { ...inspectDmCsv(rawCsv).mapping, time_s: { column: 'time_s', unit: 'ms' }, dl_mbps: { column: 'Rate', unit: 'kbps' } };
    const first = await prepareDriveImport({ name: 'vendor.csv', rawCsv, mapping, origin: 'unknown', knownCellIds: [] });
    const second = await prepareDriveImport({ name: 'vendor.csv', rawCsv, mapping: { ...mapping, dl_mbps: { column: 'Rate', unit: 'Mbps' } }, origin: 'unknown', knownCellIds: [] });
    expect(first.measurements.samples[1]).toMatchObject({ timeS: 1, dlMbps: 2, rsrpDbm: null });
    expect(first.measurements.evidence.transformations[0]).toMatchObject({ type: 'mapped-gps-csv-parse', version: 2, mapping });
    expect(first.measurements.evidence.rawCsv).toBe(rawCsv);
    expect(first.measurements.evidence.sha256).toBe(second.measurements.evidence.sha256);
    expect(first.measurements.evidence.datasetId).not.toBe(second.measurements.evidence.datasetId);
  });
});
