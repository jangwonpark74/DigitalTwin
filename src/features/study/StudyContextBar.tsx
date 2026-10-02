import type { WorkspaceSnapshot } from '../../api/schemas';
import { studyState } from './studyTypes';
import './study.css';
type ProjectRecord = WorkspaceSnapshot['projects'][number];

export default function StudyContextBar({ record, onOpen, onEvidence }: { record: ProjectRecord; onOpen: () => void; onEvidence: () => void }) {
  const study = studyState(record.project), definition = study?.definitions.at(-1), selection = study?.selection;
  const dataset = record.project.driveMeasurements as { fileName: string; samples: unknown[]; evidence?: { origin: string; datasetId: string } } | null;
  const library = record.project.measurementLibrary as { activeId: string | null; records: { id: string; version: number }[] } | undefined;
  const version = library?.records.find(item => item.id === library.activeId)?.version;
  const origin = dataset?.evidence?.origin ?? (dataset && /synthetic(?:[-_ .]|$)/i.test(dataset.fileName) ? 'synthetic' : 'origin unknown');
  const baseline = selection?.kind === 'baseline' ? study?.baselines.find(item => item.id === selection.id) : undefined;
  const candidate = selection?.kind === 'candidate' ? study?.candidates.find(item => item.id === selection.id) : undefined;
  return <section className="study-context-bar" aria-label="Shared study context">
    <div><strong>{definition ? `Study definition v${definition.version} · ${definition.rat}` : 'Study not defined'}</strong>
      <span>Working network · {dataset ? `${version ? `Dataset v${version}` : 'Legacy dataset'} · ${dataset.fileName} · ${dataset.samples.length} GPS samples · ${origin} · unverified` : 'No GPS evidence'}</span></div>
    <div><span>Comparison reference</span><strong>{baseline?.name ?? (candidate ? `${candidate.name} v${selection?.kind === 'candidate' ? selection.version : ''}` : 'Working draft')}</strong></div>
    <button type="button" onClick={onOpen}>Study & scenarios</button>
    <button type="button" onClick={onEvidence}>Measurement datasets</button>
  </section>;
}
