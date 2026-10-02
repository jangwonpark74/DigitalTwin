import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { createWorkspaceState } from '../../../workspaces.mjs';
import { workspaceSchema } from '../../api/schemas';
import StudyContextBar from './StudyContextBar';

it('identifies the working dataset version and opens retained evidence from the shared context', () => {
  const record = workspaceSchema.parse(createWorkspaceState()).projects[0];
  record.project.driveMeasurements = { fileName: 'seoul.csv', samples: [1, 2], evidence: { origin: 'synthetic', datasetId: 'source-1' } };
  record.project.measurementLibrary = { activeId: 'dataset-1', records: [{ id: 'dataset-1', version: 3 }] };
  const onEvidence = vi.fn(); render(<StudyContextBar record={record} onOpen={vi.fn()} onEvidence={onEvidence} />);
  expect(screen.getByRole('region', { name: 'Shared study context' }).textContent).toContain('Dataset v3 · seoul.csv');
  fireEvent.click(screen.getByRole('button', { name: 'Measurement datasets' })); expect(onEvidence).toHaveBeenCalledTimes(1);
});
