import { useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { AppController } from '../../app/AppController';
import { archiveProject, createProject, deleteProject, duplicateProject, openProject, renameProject, restoreProject } from './projectCommands';
import './projects-preview.css';

type ProjectRecord = { id: string; name: string; status: 'active' | 'archived'; updatedAt: string;
  project: { map: { city: string; cluster: string }; sites: unknown[]; tasks: unknown[] } };

export default function ProjectsPreviewLeaf({ controller, onNavigate }: { controller: AppController; onNavigate: (route: string) => void }) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const workspace = snapshot.workspace;
  const projects = (workspace?.projects ?? []) as unknown as ProjectRecord[];
  const ordered = [...projects].sort((left, right) => (left.status === right.status ? 0 : left.status === 'active' ? -1 : 1)
    || right.updatedAt.localeCompare(left.updatedAt));
  const activeCount = projects.filter(project => project.status === 'active').length;
  const form = useRef<HTMLFormElement>(null);
  const [draft, setDraft] = useState({ name: '', city: '', cluster: '' });
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<void> | null, success: string, destination?: string) => {
    setError(''); setNotice('');
    try {
      const request = action();
      if (!request) return;
      setBusy(true);
      await request;
      setNotice(success);
      if (destination) onNavigate(destination);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };

  const submitCreate = (event: FormEvent) => {
    event.preventDefault();
    void act(() => createProject(controller, draft), 'Project created and opened.', 'overview')
      .then(() => setDraft({ name: '', city: '', cluster: '' }));
  };
  const submitRename = (event: FormEvent, project: ProjectRecord) => {
    event.preventDefault();
    void act(() => renameProject(controller, project.id, names[project.id] ?? project.name), 'Project name saved.');
  };

  return <section className="projects-preview" role="region" aria-label="Projects preview route">
    <header><div><p className="eyebrow">WORKSPACE · LOCAL SQLITE</p><h1>Twin Workspace projects</h1>
      <p>Create and manage independent RAN planning projects. Each project keeps its own map, sites, use cases, tasks, and management plan.</p></div>
      <button type="button" className="button outline" onClick={() => form.current?.querySelector<HTMLInputElement>('[name="name"]')?.focus()}>+ New project</button></header>
    <p className="artifacts-boundary">Projects, tasks, artifacts, and run records are stored in the local workspace database.</p>
    {error && <p role="alert">Project action failed · {error}</p>}
    {notice && <p role="status" aria-live="polite">{notice}</p>}
    {workspace && <div className="projects-summary" role="group" aria-label="Project counts">
      <div><strong>{projects.length}</strong><span>Total projects</span></div>
      <div><strong>{activeCount}</strong><span>Active</span></div>
      <div><strong>{projects.length - activeCount}</strong><span>Archived</span></div>
    </div>}
    <section className="panel projects-create">
      <header><div><h2>Create a project</h2><p>Start an independent workspace with a default RAN twin planning configuration.</p></div></header>
      <form ref={form} className="projects-create-form" onSubmit={submitCreate}>
        <label>Project name<input name="name" maxLength={80} required value={draft.name}
          placeholder="e.g. Seoul CBD pilot" onChange={event => setDraft(previous => ({ ...previous, name: event.target.value }))} /></label>
        <label>City / location<input name="city" maxLength={80} required value={draft.city}
          placeholder="e.g. Seoul" onChange={event => setDraft(previous => ({ ...previous, city: event.target.value }))} /></label>
        <label>Cluster<input name="cluster" maxLength={80} required value={draft.cluster}
          placeholder="e.g. Central business district" onChange={event => setDraft(previous => ({ ...previous, cluster: event.target.value }))} /></label>
        <button className="button primary" type="submit" disabled={busy}>Create project</button>
      </form>
    </section>
    <div className="projects-list-heading"><div><h2>Projects</h2><p>Open, duplicate, rename, or archive projects. Archived plans stay recoverable.</p></div></div>
    {snapshot.status === 'loading' && <p role="status">Loading local workspace…</p>}
    {ordered.length === 0 && <p>No projects are available.</p>}
    <div className="projects-list">{ordered.map(project => {
      const current = project.id === workspace?.activeProjectId;
      const archived = project.status === 'archived';
      const updated = new Date(project.updatedAt);
      const updatedLabel = Number.isNaN(updated.valueOf()) ? 'Unknown' : updated.toLocaleDateString();
      return <article className={`project-card${archived ? ' archived' : ''}${current ? ' current' : ''}`} key={project.id}>
        <div className="project-card-top"><div><span className="project-kicker">{archived ? 'ARCHIVED PROJECT' : 'TWIN WORKSPACE PROJECT'}</span>
          <h3>{project.name}</h3><p>{project.project.map.city} · {project.project.map.cluster}</p></div>
          <span className={`project-status${archived ? ' archived' : current ? ' current' : ''}`}>{archived ? 'ARCHIVED' : current ? 'CURRENT' : 'ACTIVE'}</span></div>
        <div className="project-facts"><span><b>{project.project.sites.length}</b> planned sites</span>
          <span><b>{project.project.tasks.length}</b> preparation tasks</span><span>Updated {updatedLabel}</span></div>
        <div className="project-card-actions">
          {archived ? <><button type="button" className="button outline" disabled={busy}
            onClick={() => void act(() => restoreProject(controller, project.id), 'Project restored to the active workspace.')}>Restore</button>
            <button type="button" className="button danger" disabled={busy}
              onClick={() => { if (window.confirm(`Permanently delete “${project.name}”? This local project cannot be recovered.`))
                void act(() => deleteProject(controller, project.id), 'Archived project permanently deleted.'); }}>Delete permanently</button></>
            : <>{current ? <span className="project-current-action">Currently open</span> : <button type="button" className="button primary" disabled={busy}
              onClick={() => void act(() => openProject(controller, project.id), `Opened ${project.name}.`, 'overview')}>Open project</button>}
              <button type="button" className="button outline" disabled={busy}
                onClick={() => void act(() => duplicateProject(controller, project.id), 'Project duplicated and opened.', 'overview')}>Duplicate</button>
              {activeCount > 1 ? <button type="button" className="button outline" disabled={busy}
                onClick={() => void act(() => archiveProject(controller, project.id), 'Project archived.')}>Archive</button>
                : <span className="project-action-hint">Keep at least one active project.</span>}</>}
          <details className="project-rename"><summary>Rename</summary><form onSubmit={event => submitRename(event, project)}>
            <label>Project name<input aria-label={`New name for ${project.name}`} maxLength={80} required
              value={names[project.id] ?? project.name} onChange={event => setNames(previous => ({ ...previous, [project.id]: event.target.value }))} /></label>
            <button className="button outline" type="submit" disabled={busy}>Save name</button>
          </form></details>
        </div>
        {archived && <p className="project-archive-note">Archived projects stay saved and can be restored. Delete permanently removes this local project.</p>}
      </article>;
    })}</div>
  </section>;
}
