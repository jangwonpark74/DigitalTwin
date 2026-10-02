import { type ReactNode, useEffect, useState } from 'react';
import { previewRoutes, type PreviewRouteId } from './routeRegistry';
import type { buildPreviewContext } from './selectors';
import { sectionForRoute, visibleSections, type WorkspacePreset } from './workflowNavigation';

type PreviewContext = NonNullable<ReturnType<typeof buildPreviewContext>>;

type PreviewWorkspaceShellProps = {
  route: PreviewRouteId;
  context: PreviewContext | null;
  onNavigate: (route: PreviewRouteId) => void;
  children: ReactNode;
};

export default function PreviewWorkspaceShell({ route, context, onNavigate: navigate, children }: PreviewWorkspaceShellProps) {
  const menuRoute = route === 'radio' ? 'planner' : route;
  const section = sectionForRoute(route);
  const [preset, setPreset] = useState<WorkspacePreset>('all');
  const [openSections, setOpenSections] = useState<string[]>(() => section ? [section.id] : []);
  useEffect(() => {
    if (section) setOpenSections(open => open.includes(section.id) ? open : [...open, section.id]);
  }, [section]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const onNavigate = (next: PreviewRouteId) => { navigate(next); setMobileOpen(false); };
  return (
    <div className="preview-workspace-grid" data-mobile-nav={mobileOpen}>
      <a className="product-skip-link" href="#workspace-content">Skip to workspace</a>
      <div className="product-mobile-bar"><strong>ATLAS<span>RAN</span></strong>
        <button type="button" aria-expanded={mobileOpen} aria-controls="workspace-navigation" onClick={() => setMobileOpen(open => !open)}>Navigation {mobileOpen ? '−' : '+'}</button></div>
      <aside id="workspace-navigation" className="preview-workspace-sidebar" role="complementary" aria-label="Primary navigation">
        <div className="preview-workspace-brand"><div className="product-brand-line"><span className="product-brand-mark" aria-hidden="true">▥</span><strong>ATLAS<span>RAN</span></strong></div><small>DIGITAL TWIN STUDIO</small></div>
        {context && <div role="region" aria-label="Active project context" className="preview-workspace-context">
          <strong>{context.name}</strong>
          <small>{context.city} · {context.cluster} · {context.projectCount} {context.projectCount === 1 ? 'project' : 'projects'}</small>
        </div>}
        <button type="button" className="workspace-project-library" aria-current={route === 'projects' ? 'page' : undefined}
          onClick={() => onNavigate('projects')}>Projects <span aria-hidden="true">↗</span></button>
        <label className="workspace-preset">Workspace preset
          <select aria-label="Workspace preset" value={preset} onChange={event => setPreset(event.currentTarget.value as WorkspacePreset)}>
            <option value="all">All workspaces</option><option value="rf">RF engineer</option>
            <option value="operations">Operations</option><option value="platform">Platform administrator</option>
          </select>
        </label>
        <nav aria-label="Application workspaces" className="preview-workspace-nav">
          {visibleSections(preset, route).map(group => <div key={group.id} className={group.utility ? 'workspace-utility' : undefined}>
            <button type="button" className="preview-workspace-group" aria-controls={`workspace-${group.id}-routes`}
              aria-expanded={openSections.includes(group.id)} onClick={() => setOpenSections(open => open.includes(group.id)
                ? open.filter(id => id !== group.id) : [...open, group.id])}>
              {group.label}<span aria-hidden="true">{openSections.includes(group.id) ? '−' : '+'}</span>
            </button>
            <div id={`workspace-${group.id}-routes`} hidden={!openSections.includes(group.id)}>
              {group.routes.filter(id => id !== 'radio').map(id => <button type="button" key={id} data-nav-route={id} aria-label={previewRoutes[id].label}
                aria-current={menuRoute === id ? 'page' : undefined} onClick={() => onNavigate(id)}>
                {previewRoutes[id].label}{id === 'monitoring' && <small>Setup</small>}
              </button>)}
            </div>
          </div>)}
        </nav>
        <p className="preview-workspace-boundary">Preparation mode<br /><small>RAN endpoints not connected</small></p>
      </aside>
      <div className="preview-workspace-main">
        <header className="preview-workspace-header">
          <nav aria-label="Breadcrumb">5G RAN <span>/</span> {section?.label ?? 'Project library'} <span>/</span> <strong>{previewRoutes[menuRoute].label}</strong></nav>
          <span className="product-header-status"><i aria-hidden="true" /> Planning workspace</span>
        </header>
        <main id="workspace-content" className="preview-workspace-content" tabIndex={-1}>{children}</main>
        <footer role="contentinfo" aria-label="Planning status" className="preview-workspace-footer">
          <span>5G RAN TWIN · PREPARATION</span>
          {context && <span>{context.siteCount} SITES · {context.cellCount} CELLS · {new Intl.NumberFormat('en-US').format(context.ueCount)} VIRTUAL UES</span>}
          <span>OFFLINE STUDY · SOURCE STATUS PER DATASET</span>
        </footer>
      </div>
    </div>
  );
}
