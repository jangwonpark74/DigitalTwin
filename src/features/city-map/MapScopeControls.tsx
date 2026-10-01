import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import { fitMapToScene, importGeoJsonScene, loadDemoScene, updateMapField } from './cityMapCommands';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type MapProject = { city: string; cluster: string; latitude: number; longitude: number; radiusMeters: number;
  scene?: { fileName: string; footprints: unknown[]; assumedHeightCount: number;
    bbox: { west: number; south: number; east: number; north: number } } | null };
type Draft = { city: string; cluster: string; latitude: string; longitude: string; radiusMeters: string };
type Field = keyof Draft;

const fields: { key: Field; label: string; type: string; attrs?: Record<string, string> }[] = [
  { key: 'city', label: 'City / location', type: 'text' },
  { key: 'cluster', label: 'Cluster name', type: 'text' },
  { key: 'latitude', label: 'Center latitude', type: 'number', attrs: { step: '0.0001' } },
  { key: 'longitude', label: 'Center longitude', type: 'number', attrs: { step: '0.0001' } },
  { key: 'radiusMeters', label: 'Area radius (m)', type: 'number', attrs: { min: '100', max: '20000' } },
];

function draftFrom(record: ProjectRecord): Draft {
  const map = record.project.map as unknown as MapProject;
  return { city: map.city, cluster: map.cluster, latitude: String(map.latitude), longitude: String(map.longitude),
    radiusMeters: String(map.radiusMeters) };
}

export default function MapScopeControls({ controller, record, fetcher = fetch }: {
  controller: AppController; record: ProjectRecord; fetcher?: typeof fetch;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const map = record.project.map as unknown as MapProject;
  const [draft, setDraft] = useState(() => draftFrom(record));
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const dirty = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const defaults = draftFrom(record);
    setDraft(previous => Object.fromEntries(Object.entries(defaults).map(([key, value]) => [
      key, dirty.current.has(`${record.id}:${key}`) ? previous[key as Field] : value,
    ])) as Draft);
  }, [record]);

  const commit = (field: Field, value: string) => {
    const key = `${record.id}:${field}`;
    try {
      const result = updateMapField(controller, record.id, field, value);
      if (!result) { dirty.current.delete(key); return; }
      dirty.current.add(key);
      void result.then(() => { dirty.current.delete(key); setError(''); })
        .catch(cause => {
          dirty.current.delete(key);
          setDraft(current => ({ ...current, [field]: draftFrom(record)[field] }));
          setError(cause instanceof Error ? cause.message : String(cause));
        });
    } catch (cause) {
      dirty.current.delete(key);
      setDraft(current => ({ ...current, [field]: draftFrom(record)[field] }));
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const importFile = async (file?: File) => {
    if (!file) return;
    setError(''); setStatus('');
    if (file.size > 2_000_000) { setError('GeoJSON must be smaller than 2 MB'); if (inputRef.current) inputRef.current.value = ''; return; }
    setBusy(true);
    try {
      const result = await importGeoJsonScene(controller, record.id, await file.text(), file.name);
      if (result) setStatus(`${result.fileName} loaded · ${result.footprintCount} footprints`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
  };

  const loadDemo = async () => {
    setBusy(true); setError(''); setStatus('Loading demo scene…');
    try {
      const result = await loadDemoScene(controller, record.id, fetcher);
      if (result) setStatus(`${result.fileName} loaded · ${result.footprintCount} footprints`);
    } catch (cause) { setStatus(''); setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const fit = async () => {
    setBusy(true); setError('');
    try { await fitMapToScene(controller, record.id); setStatus('Map scope fitted to geometry.'); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const scene = map.scene;
  return <section className="map-scope-controls" aria-label="Map scope and scene">
    <header><div><h2>Map scope &amp; scene</h2><p>GeoJSON polygons use [longitude, latitude] in WGS84 EPSG:4326.</p></div></header>
    <div className="map-scope-fields">
      {fields.map(field => <label key={field.key} className="form-field"><span>{field.label}</span>
        <input type={field.type} value={draft[field.key]} {...field.attrs}
          onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))}
          onBlur={event => commit(field.key, event.currentTarget.value)}
          onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} />
      </label>)}
      <label className="form-field"><span>Loaded scene</span><input type="text" readOnly value={scene?.fileName ?? ''} placeholder="No geometry loaded" /></label>
    </div>
    <div className="map-scope-actions">
      <label className="button outline file-label">⌁ Load building GeoJSON
        <input ref={inputRef} type="file" accept=".geojson,.json,application/geo+json" hidden disabled={busy}
          onChange={event => { void importFile(event.currentTarget.files?.[0]); }} />
      </label>
      <button type="button" className="button outline" disabled={busy} onClick={() => void loadDemo()}>Load demo scene</button>
    </div>
    {scene && <div className="map-scene-summary" aria-label="Imported scene summary">
      <strong>{scene.fileName}</strong><span>{scene.footprints.length} footprints · {scene.assumedHeightCount} heights estimated · EPSG:4326</span>
      <span>Bounds {scene.bbox.south.toFixed(5)}°–{scene.bbox.north.toFixed(5)}° N, {scene.bbox.west.toFixed(5)}°–{scene.bbox.east.toFixed(5)}° E</span>
      <button type="button" className="button outline" disabled={busy} onClick={() => void fit()}>Fit map scope to geometry</button>
    </div>}
    {error && <p role="alert">Map input rejected · {error}</p>}
    {status && <p role="status" aria-live="polite">{status}</p>}
    <p className="map-scope-note">Local browser import; outer polygon rings only. Height uses height/height_m or an estimated 3 m per level (12 m default). No RF materials, terrain, or channel solver are imported. The city explorer is separate from these inputs.</p>
  </section>;
}
