type Site = { id: string };
type Project = { sites: Site[] };
type Snapshot = { projectId: string; selectedSiteId: string | null; placementSiteId: string | null };

export class RadioSession {
  private state: Snapshot;
  private snapshot: Readonly<Snapshot>;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(projectId: string, private project: Project) {
    this.state = this.initial(projectId);
    this.snapshot = Object.freeze({ ...this.state });
  }

  private initial(projectId: string): Snapshot {
    return { projectId, selectedSiteId: this.project.sites[0]?.id ?? null, placementSiteId: null };
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
    if (this.disposed || !this.project.sites.some(site => site.id === siteId)) return false;
    if (this.state.selectedSiteId === siteId && this.state.placementSiteId === null) return true;
    this.state.selectedSiteId = siteId;
    if (this.state.placementSiteId !== siteId) this.state.placementSiteId = null;
    this.publish();
    return true;
  }

  startPlacement(siteId: string) {
    if (this.disposed || !this.project.sites.some(site => site.id === siteId)) return false;
    if (this.state.selectedSiteId === siteId && this.state.placementSiteId === siteId) return true;
    this.state.selectedSiteId = siteId;
    this.state.placementSiteId = siteId;
    this.publish();
    return true;
  }

  cancelPlacement() {
    if (this.disposed || this.state.placementSiteId === null) return;
    this.state.placementSiteId = null;
    this.publish();
  }

  setProject(projectId: string, project: Project) {
    if (this.disposed) return;
    this.project = project;
    if (projectId !== this.state.projectId) {
      this.state = this.initial(projectId);
      this.publish();
      return;
    }
    const siteExists = this.state.selectedSiteId !== null
      && this.project.sites.some(site => site.id === this.state.selectedSiteId);
    const placementExists = this.state.placementSiteId !== null
      && this.project.sites.some(site => site.id === this.state.placementSiteId);
    if (!siteExists || (this.state.placementSiteId !== null && !placementExists)) {
      this.state.selectedSiteId = siteExists ? this.state.selectedSiteId : this.project.sites[0]?.id ?? null;
      this.state.placementSiteId = null;
      this.publish();
    }
  }

  dispose() {
    this.disposed = true;
    this.listeners.clear();
  }
}
