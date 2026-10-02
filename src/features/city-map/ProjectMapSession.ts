import { useMemo, useSyncExternalStore } from 'react';
import type { DriveMetric, DriveTechnology } from '../ray-tracing/driveKpi';

export type MapViewport = { longitude: number; latitude: number; zoom: number; bearing: number };
type MapView = { viewport: MapViewport | null; metric: DriveMetric; technology: DriveTechnology;
  driveVisible: boolean; selectedIndex: number | null; sitesVisible: boolean; contextVisible: boolean; siteId: string | null;
  mapMode: '2d' | 'project-3d'; pitch: number };

export class ProjectMapSession {
  private snapshot: Readonly<MapView> = Object.freeze({ viewport: null, metric: 'rsrp', technology: 'ALL',
    driveVisible: true, selectedIndex: null, sitesVisible: true, contextVisible: true, siteId: null,
    mapMode: '2d', pitch: 52 });
  private listeners = new Set<() => void>();
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  update = (changes: Partial<MapView>) => {
    const next = { ...this.snapshot, ...changes };
    const a = this.snapshot.viewport, b = next.viewport;
    const sameViewport = a === b || (a && b && Math.abs(a.longitude - b.longitude) < 1e-8 &&
      Math.abs(a.latitude - b.latitude) < 1e-8 && Math.abs(a.zoom - b.zoom) < 1e-6 && Math.abs(a.bearing - b.bearing) < 1e-6);
    if (sameViewport && Object.keys(changes).every(key => key === 'viewport' ||
      next[key as keyof MapView] === this.snapshot[key as keyof MapView])) return;
    this.snapshot = Object.freeze({ ...next, viewport: next.viewport ? Object.freeze({ ...next.viewport }) : null });
    this.listeners.forEach(listener => listener());
  };
}

// View preferences belong to the current workspace session, not persisted RF inputs.
const workspaces = new WeakMap<object, Map<string, { scope: string; session: ProjectMapSession }>>();
export function resetMeasurementSelection(owner: object, projectId: string) {
  workspaces.get(owner)?.get(projectId)?.session.update({ selectedIndex: null });
}
export function projectMapSession(owner: object, projectId: string, map: { longitude: number; latitude: number; radiusMeters: number }) {
  let sessions = workspaces.get(owner);
  if (!sessions) { sessions = new Map(); workspaces.set(owner, sessions); }
  const scope = `${map.longitude}:${map.latitude}:${map.radiusMeters}`;
  const existing = sessions.get(projectId);
  if (existing?.scope === scope) return existing.session;
  const session = new ProjectMapSession();
  sessions.set(projectId, { scope, session });
  return session;
}

export function useProjectMapView(owner: object, projectId: string, map: { longitude: number; latitude: number; radiusMeters: number }) {
  const session = useMemo(() => projectMapSession(owner, projectId, map),
    [owner, projectId, map.longitude, map.latitude, map.radiusMeters]);
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot);
  return { session, view };
}
