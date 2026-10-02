type Cell = { id: string };
type Site = { id: string; cells: Cell[] };
type Project = { sites: Site[] };
export type InspectorTab = 'summary' | 'position' | 'rf' | 'antenna' | 'topology';
type Snapshot = { projectId: string; selectedSiteId: string | null; selectedCellId: string | null; inspectorTab: InspectorTab };

/** Transient site/cell selection state, isolated from project persistence. */
export class SitePlannerSession {
  private state: Snapshot;
  private snapshot: Readonly<Snapshot>;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(projectId: string, private project: Project) {
    this.state = this.initial(projectId);
    this.snapshot = Object.freeze({ ...this.state });
  }

  private initial(projectId: string): Snapshot {
    const site = this.project.sites[0];
    return { projectId, selectedSiteId: site?.id ?? null, selectedCellId: site?.cells[0]?.id ?? null, inspectorTab: 'summary' };
  }

  getSnapshot = () => this.snapshot;

  subscribe = (listener: () => void) => {
    if (this.disposed) return () => {};
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  private publish() {
    this.snapshot = Object.freeze({ ...this.state });
    this.listeners.forEach(listener => listener());
  }

  selectSite(siteId: string) {
    if (this.disposed) return false;
    const site = this.project.sites.find(candidate => candidate.id === siteId);
    if (!site) return false;
    const cellId = site.cells[0]?.id ?? null;
    if (this.state.selectedSiteId === siteId) return true;
    this.state.selectedSiteId = siteId;
    this.state.selectedCellId = cellId;
    this.publish();
    return true;
  }

  selectCell(cellId: string) {
    if (this.disposed) return false;
    const site = this.project.sites.find(candidate => candidate.id === this.state.selectedSiteId);
    if (!site?.cells.some(cell => cell.id === cellId)) return false;
    if (this.state.selectedCellId === cellId) return true;
    this.state.selectedCellId = cellId;
    this.publish();
    return true;
  }

  selectInspectorTab(tab: InspectorTab) {
    if (this.disposed || !['summary', 'position', 'rf', 'antenna', 'topology'].includes(tab) || this.state.inspectorTab === tab) return;
    this.state.inspectorTab = tab; this.publish();
  }

  setProject(projectId: string, project: Project) {
    if (this.disposed) return;
    this.project = project;
    if (projectId !== this.state.projectId) {
      this.state = this.initial(projectId);
      this.publish();
      return;
    }
    const site = this.project.sites.find(candidate => candidate.id === this.state.selectedSiteId)
      ?? this.project.sites[0];
    const cellExists = site?.cells.some(cell => cell.id === this.state.selectedCellId) ?? false;
    if (site?.id !== this.state.selectedSiteId || !cellExists) {
      this.state.selectedSiteId = site?.id ?? null;
      this.state.selectedCellId = cellExists ? this.state.selectedCellId : site?.cells[0]?.id ?? null;
      this.publish();
    }
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
