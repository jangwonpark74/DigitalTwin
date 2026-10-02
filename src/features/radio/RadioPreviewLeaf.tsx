import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { RadioSession } from './RadioSession';
import { SitePlannerSession } from '../site-planner/SitePlannerSession';
import SitePlannerPreviewLeaf from '../site-planner/SitePlannerPreviewLeaf';

/** Retained radio bookmarks enter the canonical site/cell inspector at RF. */
export default function RadioPreviewLeaf({ controller, record, session, plannerSession, onError, onNavigate }: {
  controller: AppController; record: WorkspaceSnapshot['projects'][number]; session: RadioSession; plannerSession?: SitePlannerSession;
  onError: (message: string) => void; onNavigate: (route: string) => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === snapshot.workspace?.activeProjectId) ?? record;
  const [fallback] = useState(() => new SitePlannerSession(record.id, record.project as { sites: { id: string; cells: { id: string }[] }[] }));
  useEffect(() => { session.setProject(record.id, record.project as { sites: { id: string }[] }); }, [record.id, record.project, session]);
  useEffect(() => () => fallback.dispose(), [fallback]);
  return <section aria-label="Radio planner preview route"><SitePlannerPreviewLeaf controller={controller} record={record}
    session={plannerSession ?? fallback} radioSession={session} initialTab="rf" onError={onError} onNavigate={onNavigate} /></section>;
}
