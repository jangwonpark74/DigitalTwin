import { type ReactNode, useState } from 'react';
import { previewRoutes, type PreviewRouteId } from './routeRegistry';
import type { buildPreviewContext } from './selectors';

type PreviewContext = NonNullable<ReturnType<typeof buildPreviewContext>>;

type PreviewWorkspaceShellProps = {
  route: PreviewRouteId;
  context: PreviewContext | null;
  onNavigate: (route: PreviewRouteId) => void;
  children: ReactNode;
};

export default function PreviewWorkspaceShell({ route, context, onNavigate: navigate, children }: PreviewWorkspaceShellProps) {
  const [workspaceOpen, setWorkspaceOpen] = useState(true);
  const [useCasesOpen, setUseCasesOpen] = useState(false);
  const [systemOpen, setSystemOpen] = useState(false);
  const [tasksOpen, setTasksOpen] = useState(false);
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
        <nav aria-label="Application workspaces" className="preview-workspace-nav">
          <button type="button" className="preview-workspace-group" aria-controls="preview-workspace-routes"
            aria-expanded={workspaceOpen} onClick={() => setWorkspaceOpen(open => !open)}>WORKSPACE <span aria-hidden="true">⌄</span></button>
          <div id="preview-workspace-routes" hidden={!workspaceOpen}>
            <button type="button" aria-current={route === 'overview' ? 'page' : undefined}
              onClick={() => onNavigate('overview')}>{previewRoutes.overview.label}</button>
            <button type="button" aria-current={route === 'projects' ? 'page' : undefined}
              onClick={() => onNavigate('projects')}>{previewRoutes.projects.label}</button>
            <button type="button" aria-current={route === 'stack' ? 'page' : undefined}
              onClick={() => onNavigate('stack')}>{previewRoutes.stack.label}</button>
            <button type="button" aria-current={route === 'artifacts' ? 'page' : undefined}
              onClick={() => onNavigate('artifacts')}>{previewRoutes.artifacts.label}</button>
            <button type="button" aria-current={route === 'ues' ? 'page' : undefined}
              onClick={() => onNavigate('ues')}>{previewRoutes.ues.label}</button>
            <button type="button" aria-current={route === 'map' ? 'page' : undefined}
              onClick={() => onNavigate('map')}>{previewRoutes.map.label}</button>
            <button type="button" aria-current={route === 'planner' ? 'page' : undefined}
              onClick={() => onNavigate('planner')}>{previewRoutes.planner.label}</button>
            <button type="button" aria-current={route === 'radio' ? 'page' : undefined}
              onClick={() => onNavigate('radio')}>{previewRoutes.radio.label}</button>
            <button type="button" aria-current={route === 'ray' ? 'page' : undefined}
              onClick={() => onNavigate('ray')}>{previewRoutes.ray.label}</button>
          </div>
          <button type="button" className="preview-workspace-group" aria-controls="preview-usecase-routes"
            aria-expanded={useCasesOpen} onClick={() => setUseCasesOpen(open => !open)}>USE CASES <span aria-hidden="true">⌄</span></button>
          <div id="preview-usecase-routes" hidden={!useCasesOpen}>
            <button type="button" aria-current={route === 'drive' ? 'page' : undefined}
              onClick={() => onNavigate('drive')}>{previewRoutes.drive.label}</button>
            <button type="button" aria-current={route === 'ab' ? 'page' : undefined}
              onClick={() => onNavigate('ab')}>{previewRoutes.ab.label}</button>
            <button type="button" aria-current={route === 'data' ? 'page' : undefined}
              onClick={() => onNavigate('data')}>{previewRoutes.data.label}</button>
          </div>
          <button type="button" className="preview-workspace-group" aria-controls="preview-system-routes"
            aria-expanded={systemOpen} onClick={() => setSystemOpen(open => !open)}>SYSTEM <span aria-hidden="true">⌄</span></button>
          <div id="preview-system-routes" hidden={!systemOpen}>
            <button type="button" aria-current={route === 'hardware' ? 'page' : undefined}
              onClick={() => onNavigate('hardware')}>{previewRoutes.hardware.label}</button>
            <button type="button" aria-current={route === 'software' ? 'page' : undefined}
              onClick={() => onNavigate('software')}>{previewRoutes.software.label}</button>
            <button type="button" aria-current={route === 'monitoring' ? 'page' : undefined}
              onClick={() => onNavigate('monitoring')}>{previewRoutes.monitoring.label}</button>
          </div>
          <button type="button" className="preview-workspace-group" aria-controls="preview-task-routes"
            aria-expanded={tasksOpen} onClick={() => setTasksOpen(open => !open)}>TASKS &amp; SCHEDULE <span aria-hidden="true">⌄</span></button>
          <div id="preview-task-routes" hidden={!tasksOpen}>
            <button type="button" aria-current={route === 'tasks' ? 'page' : undefined}
              onClick={() => onNavigate('tasks')}>{previewRoutes.tasks.label}</button>
            <button type="button" aria-current={route === 'schedule' ? 'page' : undefined}
              onClick={() => onNavigate('schedule')}>{previewRoutes.schedule.label}</button>
          </div>
          <button type="button" aria-current={route === 'activity' ? 'page' : undefined}
            onClick={() => onNavigate('activity')}>{previewRoutes.activity.label}</button>
        </nav>
        <p className="preview-workspace-boundary">Preparation mode<br /><small>RAN endpoints not connected</small></p>
      </aside>
      <div className="preview-workspace-main">
        <header className="preview-workspace-header">
          <nav aria-label="Breadcrumb">Digital Twin <span>/</span> 5G RAN <span>/</span> <strong>{previewRoutes[route].label}</strong></nav>
          <span className="product-header-status"><i aria-hidden="true" /> Planning workspace</span>
        </header>
        <main id="workspace-content" className="preview-workspace-content" tabIndex={-1}>{children}</main>
        <footer role="contentinfo" aria-label="Planning status" className="preview-workspace-footer">
          <span>5G RAN TWIN · PREPARATION</span>
          {context && <span>{context.siteCount} SITES · {context.cellCount} CELLS · {new Intl.NumberFormat('en-US').format(context.ueCount)} VIRTUAL UES</span>}
          <span>MAP · ILLUSTRATIVE METRICS</span>
        </footer>
      </div>
    </div>
  );
}
