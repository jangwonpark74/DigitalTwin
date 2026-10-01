type Project = { management: { topology: { gh200Pools: { id: string }[]; links: { id: string }[] } } };
type Mode = 'network' | 'racks' | 'inventory';
type Snapshot = { projectId: string; mode: Mode; selectedNode: string; selectedLink: string | null;
  selectedServer: string | null; isometric: boolean };

/** Hardware UI selection only; project aliases and capacities remain in AppController. */
export class HardwareSession {
  private state: Snapshot;
  private snapshot: Readonly<Snapshot>;
  private listeners = new Set<() => void>();
  private disposed = false;

  constructor(projectId: string, private project: Project) {
    this.state = this.initial(projectId);
    this.snapshot = Object.freeze({ ...this.state });
  }

  private initial(projectId: string): Snapshot {
    return { projectId, mode: 'network', selectedNode: this.project.management.topology.gh200Pools[0].id,
      selectedLink: null, selectedServer: null, isometric: true };
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
  private hasNode(node: string) {
    return node === 'vdu-pool' || node === 'ethernet-switch'
      || this.project.management.topology.gh200Pools.some((pool: { id: string }) => pool.id === node);
  }
  private poolForServer(server: string) {
    return this.project.management.topology.gh200Pools.find((pool: { id: string }) =>
      Array.from({ length: 6 }, (_, index) => `${pool.id}-S${String(index + 1).padStart(2, '0')}`).includes(server));
  }

  selectTab(mode: Mode) {
    if (this.disposed) return;
    if (mode !== 'network' && mode !== 'racks' && mode !== 'inventory') throw new Error('Unknown hardware tab');
    if (this.state.mode === mode) return;
    this.state.mode = mode;
    this.publish();
  }
  selectNode(node: string) {
    if (this.disposed || !this.hasNode(node)) return false;
    Object.assign(this.state, { selectedNode: node, selectedLink: null, selectedServer: null });
    this.publish();
    return true;
  }
  selectLink(link: string) {
    if (this.disposed || !this.project.management.topology.links.some((item: { id: string }) => item.id === link)) return false;
    Object.assign(this.state, { selectedLink: link, selectedServer: null });
    this.publish();
    return true;
  }
  selectServer(server: string) {
    if (this.disposed) return false;
    const pool = this.poolForServer(server);
    if (!pool) return false;
    Object.assign(this.state, { mode: 'racks', selectedNode: pool.id, selectedServer: server, selectedLink: null });
    this.publish();
    return true;
  }
  rotate() {
    if (this.disposed) return;
    this.state.isometric = !this.state.isometric;
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
    let changed = false;
    if (!this.hasNode(this.state.selectedNode)) {
      this.state.selectedNode = this.project.management.topology.gh200Pools[0].id;
      changed = true;
    }
    if (this.state.selectedLink && !this.project.management.topology.links.some((item: { id: string }) => item.id === this.state.selectedLink)) {
      this.state.selectedLink = null;
      changed = true;
    }
    if (this.state.selectedServer && !this.poolForServer(this.state.selectedServer)) {
      this.state.selectedServer = null;
      changed = true;
    }
    if (changed) this.publish();
  }
  dispose() { this.disposed = true; this.listeners.clear(); }
}
