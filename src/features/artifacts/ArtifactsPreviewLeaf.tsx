import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isEditableJsonArtifact } from '../../../artifacts.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';
import type { AppController } from '../../app/AppController';
import { saveArtifactJson } from './artifactCommands';
import { importManifestAsProject } from './manifestImport';

type RecordItem = WorkspaceSnapshot['projects'][number];
type ArtifactFile = { id: string; path: string; name: string; mimeType: string; description: string; content?: string };
type TreeItem = { type: 'directory' | 'file'; name: string; id: string; children?: TreeItem[]; file?: ArtifactFile };

function artifactTree(projectName: string, files: ArtifactFile[]): TreeItem {
  const root: TreeItem = { type: 'directory', id: 'root', name: projectName, children: [] };
  for (const file of files) {
    const segments = file.path.split('/').filter(Boolean);
    let parent = root;
    for (const name of segments.slice(0, -1)) {
      let child = parent.children!.find(item => item.type === 'directory' && item.name === name);
      if (!child) { child = { type: 'directory', id: `${parent.id}/${name}`, name, children: [] }; parent.children!.push(child); }
      parent = child;
    }
    parent.children!.push({ type: 'file', id: file.id, name: file.name, file });
  }
  return root;
}

function Tree({ item, selected, onSelect }: { item: TreeItem; selected: string; onSelect: (file: ArtifactFile) => void }) {
  if (item.type === 'file' && item.file) return <li><button type="button" className="artifact-file-button"
    aria-current={selected === item.id ? 'page' : undefined} onClick={() => onSelect(item.file!)}>{item.name}</button></li>;
  return <li><details open><summary>{item.name}</summary><ul>{item.children?.map(child =>
    <Tree key={child.id} item={child} selected={selected} onSelect={onSelect} />)}</ul></details></li>;
}

export default function ArtifactsPreviewLeaf({ controller, record, onNavigate }: {
  controller: AppController; record: RecordItem; onNavigate: (route: string) => void;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  record = snapshot.workspace?.projects.find(item => item.id === record.id) ?? record;
  const [selected, setSelected] = useState('');
  const [draft, setDraft] = useState<{ id: string; original: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const manifestInput = useRef<HTMLInputElement>(null);
  const query = snapshot.artifacts;
  const files = query.data ?? [];
  const tree = useMemo(() => artifactTree(record.name, files), [record.name, files]);
  const file = files.find(item => item.id === selected) ?? files[0];

  useEffect(() => {
    setDraft(null); setSelected(''); setError('');
    void controller.refreshArtifacts().catch(cause => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [controller, record.id]);

  useEffect(() => {
    if (!selected && files.length) setSelected(files[0].id);
  }, [files, selected]);

  const selectFile = (next: ArtifactFile) => { setSelected(next.id); setDraft(null); setError(''); };
  const beginEdit = () => {
    if (!file?.content || !isEditableJsonArtifact(file.id)) return;
    setDraft({ id: file.id, original: file.content, text: file.content }); setError('');
  };
  const save = async () => {
    if (!draft) return;
    setBusy(true); setError('');
    try { await saveArtifactJson(controller, record.id, draft.id, draft.original, draft.text); setDraft(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const importManifest = async (selectedFile?: File) => {
    if (!selectedFile) return;
    setError(''); setNotice(''); setBusy(true);
    try {
      if (selectedFile.size > 3_000_000) throw new Error('Manifest must be smaller than 3 MB.');
      const result = await importManifestAsProject(controller, JSON.parse(await selectedFile.text()), selectedFile.name);
      setNotice(`Imported ${selectedFile.name} as ${result.name}; the existing project was kept.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); if (manifestInput.current) manifestInput.current.value = ''; }
  };
  const download = () => {
    if (!file?.content) return;
    const url = URL.createObjectURL(new Blob([file.content], { type: file.mimeType }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.name; anchor.click(); URL.revokeObjectURL(url);
  };

  if (query.status === 'loading' || query.status === 'idle') return <section className="artifacts-preview" role="region" aria-label="Project artifacts preview"><p role="status">Loading project artifacts…</p></section>;
  if (query.status === 'error') return <section className="artifacts-preview" role="region" aria-label="Project artifacts preview"><p role="alert">Artifact records unavailable · {query.error}</p><button type="button" onClick={() => void controller.refreshArtifacts()}>Retry</button></section>;
  return <section className="artifacts-preview" role="region" aria-label="Project artifacts preview">
    <header><div><h1>Project artifacts</h1><p>{record.name} · {files.length} project-scoped files</p></div>
      <div><button type="button" onClick={() => void controller.refreshArtifacts()} disabled={busy}>Refresh files</button>
        <button type="button" className="artifact-import-button" disabled={busy} onClick={() => manifestInput.current?.click()}>Import planning manifest</button>
        <input ref={manifestInput} type="file" accept=".json,application/json" hidden disabled={busy}
          aria-label="Import planning manifest" onChange={event => { void importManifest(event.currentTarget.files?.[0]); }} />
        <button type="button" onClick={() => onNavigate('projects')}>Manage projects</button></div></header>
    <p className="artifacts-boundary">Generated reports and logs reflect saved project state. Edited ray paths lose local solver provenance. No RAN or hardware test results are implied.</p>
    {error && <p role="alert">Artifact action failed · {error}</p>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    <div className="artifacts-browser"><nav aria-label="Project artifact file tree"><h2>Project files</h2><ul><Tree item={tree} selected={file?.id ?? ''} onSelect={selectFile} /></ul></nav>
      <article aria-label="Selected artifact">
        {file ? <><header><div><span>{file.mimeType}</span><h2>{file.name}</h2><p>{file.description}</p><small>{file.path}</small></div>
          <div>{draft ? <><button type="button" disabled={busy || draft.text === draft.original} onClick={() => void save()}>Save to project</button><button type="button" disabled={busy} onClick={() => setDraft(null)}>Cancel</button></>
            : <>{file.content !== undefined && isEditableJsonArtifact(file.id) && <button type="button" onClick={beginEdit}>Edit JSON</button>}<button type="button" onClick={download}>Download file</button></>}</div></header>
          {draft ? <label>Edit {file.name}<textarea aria-label="Artifact JSON editor" spellCheck={false} value={draft.text}
            onChange={event => setDraft(current => current && ({ ...current, text: event.target.value }))} /></label>
            : <pre><code>{file.content ?? 'File content is unavailable.'}</code></pre>}</>
          : <p>No project artifact files are available.</p>}
      </article>
    </div>
  </section>;
}
