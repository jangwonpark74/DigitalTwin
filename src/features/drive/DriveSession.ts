import { analyzeDmTrace, buildDmAnalysisReport, DM_METRICS, makeDemoTrace, parseDmCsv } from '../../../dm.mjs';
import { drivePlan } from '../../../usecases.mjs';

type Project = Parameters<typeof drivePlan>[0];
type Trace = ReturnType<typeof parseDmCsv> | ReturnType<typeof makeDemoTrace>;
type DriveTab = 'analysis' | 'plan';
type Technology = 'ALL' | 'LTE' | 'NR';
type Metric = keyof typeof DM_METRICS;
type Snapshot = { projectId: string; tab: DriveTab; technology: Technology; metric: Metric;
  position: number; playing: boolean; trace: Trace | null; filename: string };
type CsvFile = { name: string; size: number; text: () => Promise<string> };

/** Ephemeral drive interaction state. SQLite and project mutations stay with AppController. */
export class DriveSession {
  private state: Snapshot;
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private disposed = false;

  constructor(projectId: string, private project: Project) {
    this.state = { projectId, tab: 'analysis', technology: 'ALL', metric: 'rsrp',
      position: 0, playing: false, trace: null, filename: '' };
    this.snapshot = Object.freeze({ ...this.state });
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

  private currentTrace(): Trace {
    return this.state.trace ?? makeDemoTrace(this.project, drivePlan(this.project));
  }

  private sampleCount() {
    return this.state.tab === 'analysis'
      ? analyzeDmTrace(this.currentTrace().samples, { technology: this.state.technology, metric: this.state.metric }).sampleCount
      : drivePlan(this.project).samples.length;
  }

  pause() {
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    if (this.state.playing) {
      this.state.playing = false;
      this.publish();
    }
  }

  play() {
    if (this.disposed) return;
    if (this.state.playing) { this.pause(); return; }
    const last = this.sampleCount() - 1;
    if (last < 0) return;
    this.state.playing = true;
    this.publish();
    this.timer = setInterval(() => {
      if (this.disposed) return;
      if (this.state.position >= last) { this.pause(); return; }
      this.state.position++;
      this.publish();
    }, 250);
  }

  selectTab(tab: DriveTab) {
    if (this.disposed) return;
    if (tab !== 'analysis' && tab !== 'plan') throw new Error('Unknown drive tab');
    this.pause();
    this.state.tab = tab;
    this.state.position = 0;
    this.publish();
  }

  selectTechnology(technology: Technology) {
    if (this.disposed) return;
    if (!['ALL', 'LTE', 'NR'].includes(technology)) throw new Error('Unknown radio technology');
    this.pause();
    this.state.technology = technology;
    this.state.position = 0;
    this.publish();
  }

  selectMetric(metric: Metric) {
    if (this.disposed) return;
    if (!Object.hasOwn(DM_METRICS, metric)) throw new Error('Unknown DM metric');
    this.pause();
    this.state.metric = metric;
    this.publish();
  }

  seek(position: number) {
    if (this.disposed || !Number.isInteger(position) || position < 0 || position >= this.sampleCount()) return false;
    if (this.state.tab === 'analysis') this.pause();
    this.state.position = position;
    this.publish();
    return true;
  }

  jumpToSample(sampleIndex: number) {
    if (this.disposed || this.state.tab !== 'analysis') return false;
    const rows = analyzeDmTrace(this.currentTrace().samples,
      { technology: this.state.technology, metric: this.state.metric }).filtered;
    const position = rows.findIndex((sample: { index: number }) => sample.index === sampleIndex);
    if (position < 0) return false;
    this.pause();
    this.state.position = position;
    this.publish();
    return true;
  }

  async importFile(file: CsvFile): Promise<Trace | null> {
    if (this.disposed) return null;
    if (file.size > 1_000_000) throw new Error('DM CSV must be smaller than 1 MB');
    const generation = ++this.generation;
    const text = await file.text();
    if (this.disposed || generation !== this.generation) return null;
    const trace = parseDmCsv(text);
    if (this.disposed || generation !== this.generation) return null;
    this.pause();
    Object.assign(this.state, { trace, filename: file.name, technology: 'ALL', metric: 'rsrp', position: 0 });
    this.publish();
    return trace;
  }

  resetDemo() {
    if (this.disposed) return;
    this.generation++;
    this.pause();
    Object.assign(this.state, { trace: null, filename: '', position: 0 });
    this.publish();
  }

  buildAnalysisReport() {
    return buildDmAnalysisReport(this.currentTrace(),
      { technology: this.state.technology, metric: this.state.metric, filename: this.state.filename });
  }

  setProject(projectId: string, project: Project) {
    if (this.disposed) return;
    const previousDrive = this.project.useCases.drive, nextDrive = project.useCases.drive;
    const driveChanged = previousDrive.route !== nextDrive.route || previousDrive.samples !== nextDrive.samples
      || previousDrive.speedKph !== nextDrive.speedKph || previousDrive.ueMode !== nextDrive.ueMode;
    this.project = project;
    if (projectId === this.state.projectId) {
      if (driveChanged) { this.generation++; this.pause(); this.state.position = 0; this.publish(); }
      return;
    }
    this.generation++;
    this.pause();
    this.state = { projectId, tab: 'analysis', technology: 'ALL', metric: 'rsrp',
      position: 0, playing: false, trace: null, filename: '' };
    this.publish();
  }

  dispose() {
    if (this.disposed) return;
    this.generation++;
    this.pause();
    this.disposed = true;
    this.listeners.clear();
  }
}
