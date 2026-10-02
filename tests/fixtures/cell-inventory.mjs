import { execFileSync } from 'node:child_process';
import { workspaceArtifactIndex } from '../../artifacts.mjs';
import { normalizeInventoryIdentity } from '../../network-cell-identity.mjs';
import { prepareCellIdentity } from '../../cell-identity.mjs';
import { retainMeasurementDataset } from '../../measurement-library.mjs';
import { captureBaseline } from '../../study.mjs';

const fixture = JSON.parse(execFileSync(process.execPath, ['tests/fixtures/measurement-library.mjs'], { encoding: 'utf8' }));
const record = fixture.workspace.projects[0], site = record.project.sites[1], source = record.project.driveMeasurements.samples[0];
site.radio.technology = '4G LTE + 5G NR';
const declaration = { technology: 'NR', mcc: '001', mnc: '01', cellId: '13', pci: '42', arfcn: '630000', carrierName: 'Trial carrier A', sourceReference: 'Manual test reference' };
site.cells[0].inventoryIdentity = normalizeInventoryIdentity({ ...declaration, technology: 'LTE', cellId: '12', arfcn: '100' });
site.cells[1].inventoryIdentity = normalizeInventoryIdentity(declaration);
record.project = await retainMeasurementDataset(record.project, prepareCellIdentity(record.project.driveMeasurements, record.project.sites,
  [{ technology: source.technology, sourceCell: source.servingCell, targetCellId: site.cells[1].id }]));
record.project = await captureBaseline(record.project, 'Inventory declared A', { id: 'inventory-baseline' });
process.stdout.write(JSON.stringify({ workspace: fixture.workspace, artifacts: workspaceArtifactIndex(fixture.workspace), source, siteId: site.id, cellId: site.cells[1].id }));
