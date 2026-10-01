import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react';
import { analyzeDmTrace, DM_METRICS, makeDemoTrace } from '../../../dm.mjs';
import { drivePlan, ROUTES } from '../../../usecases.mjs';
import { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { DriveSession } from './DriveSession';
import { createDriveCommands } from './driveCommands';

type RecordItem = WorkspaceSnapshot['projects'][number];
type DriveTab = 'analysis' | 'plan';
type Technology = 'ALL' | 'LTE' | 'NR';
type Metric = keyof typeof DM_METRICS;
type Sample = { [key: string]: string | number; index: number; x: number; y: number; timeS: number; technology: 'LTE' | 'NR'; servingCell: string;
  rsrpDbm: number; rsrqDb: number; sinrDb: number; dlMbps: number; ulMbps: number; event: string; provenance: string };
type MetricSpec = { label: string; key: string; unit: string; poor: number; good: number };
type Field = 'drive.route' | 'drive.samples' | 'drive.speedKph';
type DriveProject = { map: { cluster: string }; sites: { id: string; name: string; x: number; y: number }[];
  useCases: { drive: { route: string; samples: number; speedKph: number } } };
type DrivePlan = { route: { name: string; points: { x: number; y: number }[] };
  samples: { x: number; y: number }[]; requestedMetrics: string[] };
type Trace = { source: string; samples: Sample[] };
type Stats = { filtered: Sample[]; sampleCount: number; techCounts: { LTE: number; NR: number };
  average: number | null; p10: number | null; weakCount: number; weakPercent: number | null;
  weakZones: { start: number; end: number }[]; events: Sample[]; handoverCount: number; cellChangeCount: number };
const metrics = DM_METRICS as Record<Metric, MetricSpec>;
const routeOptions = ROUTES as Record<string, { name: string }>;

const tabs: { id: DriveTab; label: string }[] = [
  { id: 'analysis', label: '4G/5G DM analysis' }, { id: 'plan', label: 'Route & simulation plan' },
];
const colors = { good: '#149b84', watch: '#df9c39', poor: '#cb655b' };
const number = (value: number | null | undefined) => value == null ? '—' : value.toFixed(1);
const grade = (value: number, spec: MetricSpec) => value < spec.poor ? 'poor' : value < spec.good ? 'watch' : 'good';

export default function DrivePreviewLeaf({ controller, record: recordProp, onError }: {
  controller: AppController; record: RecordItem; onError: (message: string) => void;
}) {
  const controllerState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activeId = controllerState.workspace?.activeProjectId;
  const record = controllerState.workspace?.projects.find(item => item.id === activeId) ?? recordProp;
  const project = record.project as unknown as DriveProject;
  const [session] = useState(() => new DriveSession(record.id, project));
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [settingDrafts, setSettingDrafts] = useState({
    route: project.useCases.drive.route, samples: String(project.useCases.drive.samples), speedKph: String(project.useCases.drive.speedKph),
  });
  const [busy, setBusy] = useState(false);
  const tabsRef = useRef<Partial<Record<DriveTab, HTMLButtonElement>>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const plan = drivePlan(project) as DrivePlan;
  const signature = `${record.id}:${project.useCases.drive.route}:${project.useCases.drive.samples}:${project.useCases.drive.speedKph}`;
  const download = (filename: string, payload: string) => {
    const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const commands = createDriveCommands(controller, session, { download, onError, onSuccess: () => onError('') });

  useEffect(() => { session.setProject(record.id, project); }, [record.id, project, session]);
  useEffect(() => { setSettingDrafts({ route: project.useCases.drive.route,
    samples: String(project.useCases.drive.samples), speedKph: String(project.useCases.drive.speedKph) }); }, [signature]);
  useEffect(() => () => session.pause(), [session]);

  const trace = (state.trace ?? makeDemoTrace(project, plan)) as Trace;
  const stats = analyzeDmTrace(trace.samples, { technology: state.technology, metric: state.metric }) as Stats;
  const spec = metrics[state.metric];
  const selected = stats.filtered[Math.min(state.position, Math.max(0, stats.sampleCount - 1))];
  const fieldPath = (key: keyof typeof settingDrafts): Field => key === 'route' ? 'drive.route'
    : key === 'samples' ? 'drive.samples' : 'drive.speedKph';

  const chooseTab = (tab: DriveTab) => {
    session.selectTab(tab);
    tabsRef.current[tab]?.focus({ preventScroll: true });
  };
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const current = tabs.findIndex(tab => tab.id === state.tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    chooseTab(tabs[next].id);
  };
  const run = (action: () => void | Promise<void>) => {
    try {
      const pending = action();
      if (pending) void Promise.resolve(pending).catch(cause => onError(cause instanceof Error ? cause.message : String(cause)));
    } catch (cause) { onError(cause instanceof Error ? cause.message : String(cause)); }
  };
  const changeSetting = (key: keyof typeof settingDrafts, value: string) => {
    setSettingDrafts(previous => ({ ...previous, [key]: value }));
    onError('');
  };
  const commitSetting = (key: keyof typeof settingDrafts, value: string) => {
    const path = fieldPath(key);
    const current = project.useCases.drive[key];
    const next = key === 'route' ? value.trim() : Number(value);
    if (next === current) return;
    try {
      const pending = commands.onSetting(path, value);
      if (pending) void pending.catch(cause => {
        setSettingDrafts(current => ({ ...current, [key]: String(project.useCases.drive[key === 'route' ? 'route' : key]) }));
        onError(cause instanceof Error ? cause.message : String(cause));
      });
    } catch (cause) {
      setSettingDrafts(current => ({ ...current, [key]: String(project.useCases.drive[key]) }));
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const imported = await session.importFile(file);
      if (imported) await commands.onImport(file.name, imported.samples.length);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
      if (fileInput.current) fileInput.current.value = '';
    } finally { setBusy(false); }
  };

  const panel = (title: string, caption: string, content: React.ReactNode, badge?: React.ReactNode) =>
    <section className="panel"><header className="panel-header"><div><h2>{title}</h2><p className="panel-caption">{caption}</p></div>{badge}</header>{content}</section>;
  const badge = (label: string, style = '') => <span className={`mini-pill ${style}`}>{label}</span>;

  const renderPlan = () => {
    const position = Math.min(state.position, plan.samples.length - 1);
    const point = plan.samples[position] ?? { x: 0, y: 0 };
    const routePoints = plan.route.points.map(item => `${item.x * 9},${item.y * 5.4}`).join(' ');
    return <>
      <div className="workflow-steps" aria-label="Drive simulation workflow">Choose city route → Sample UE waypoints → EM + RAN job → Compare RF / mobility evidence</div>
      <div className="main-grid">
        {panel('Route playback · schematic canvas', 'No georeferenced street network or measured RF trace', <>
          <div className="uc-map"><svg viewBox="0 0 900 540" role="img" aria-label="Planned drive route with software UE marker">
            <rect width="900" height="540" fill="#142333"/><path d="M0 460 Q340 410 900 485 L900 540 L0 540Z" fill="#204359"/>
            <g stroke="#45657866" strokeWidth="12" fill="none"><path d="M0 120 L900 230"/><path d="M80 400 L900 345"/><path d="M160 0 L265 540"/><path d="M600 0 L445 540"/></g>
            <polyline points={routePoints} fill="none" stroke="#55dec2" strokeWidth="5" strokeLinejoin="round" strokeDasharray="10 6"/>
            {plan.route.points.map((item, index) => <g key={index}><circle cx={item.x * 9} cy={item.y * 5.4} r="5" fill="#dbfff2"/><text x={item.x * 9 + 9} y={item.y * 5.4 - 8} fill="#b5d7d3" fontSize="12">{index + 1}</text></g>)}
            <g id="drive-marker" transform={`translate(${point.x * 9} ${point.y * 5.4})`}><circle r="18" fill="#50d7b655" stroke="#8af5d9" strokeWidth="3"/><circle r="6" fill="#e2fff3"/></g>
          </svg><span>SCHEMATIC PATH · {plan.route.name}</span></div>
          <div className="uc-playback"><button id="drive-play" className="button primary" onClick={() => session.play()}>{state.playing ? 'Ⅱ Pause' : '▶ Play route'}</button>
            <input id="drive-position" type="range" aria-label="UE route position" min="0" max={plan.samples.length - 1} step="1" value={position} onChange={event => session.seek(Number(event.currentTarget.value))}/>
            <span id="drive-position-label">{position + 1} / {plan.samples.length}</span></div>
          <div className="detail-copy">Marker: <span id="drive-coordinates">{point.x.toFixed(2)}%, {point.y.toFixed(2)}%</span> of schematic canvas · {project.useCases.drive.speedKph} km/h planned. Not GPS or ray-traced measurements.</div>
        </>, badge('UE ROUTE PLAN'))}
        {panel('Drive-test design', 'Shared city scene + CPU software UE', <>
          <div className="form-grid pad">
            <label className="form-field"><span>Route</span><select className="select" data-uc-field="drive.route" value={settingDrafts.route}
              onChange={event => changeSetting('route', event.currentTarget.value)} onBlur={event => commitSetting('route', event.currentTarget.value)}>
              {Object.entries(routeOptions).map(([id, route]) => <option value={id} key={id}>{route.name}</option>)}</select></label>
            <label className="form-field"><span>Samples along route</span><input type="number" min="8" max="500" data-uc-field="drive.samples"
              value={settingDrafts.samples} onChange={event => changeSetting('samples', event.currentTarget.value)} onBlur={event => commitSetting('samples', event.currentTarget.value)}/></label>
            <label className="form-field"><span>Planned speed (km/h)</span><input type="number" min="1" max="130" data-uc-field="drive.speedKph"
              value={settingDrafts.speedKph} onChange={event => changeSetting('speedKph', event.currentTarget.value)} onBlur={event => commitSetting('speedKph', event.currentTarget.value)}/></label>
          </div>
          <div className="detail-copy"><b>Requested metrics:</b> {plan.requestedMetrics.join(' · ')}. EM-only can provide channel/path-gain inputs; throughput and handover require a verified RAN execution path.</div>
          <div className="uc-placeholder"><span>RSRP</span><strong>—</strong><span>SINR</span><strong>—</strong><span>Throughput</span><strong>—</strong><span>Handover</span><strong>—</strong></div>
          <div className="uc-placeholder"><strong>PLANNED · NOT EXECUTED</strong><p>No Sionna-RT scene, RAN job, or virtual UE process has run.</p></div>
          <div className="pad"><button type="button" className="button outline" data-export-usecase="drive" onClick={() => void run(() => commands.onPlanExport())}>⇩ Export drive job plan</button></div>
        </>, badge('NO MEASUREMENTS', 'warn'))}
      </div>
    </>;
  };

  const renderSample = (sample: Sample | undefined) => sample ? <>
    <div className="dm-sample-summary"><strong>{sample.technology === 'NR' ? '5G NR' : '4G LTE'}</strong><span>{sample.servingCell}</span></div>
    <div className="dm-sample-main"><span>Sample #{sample.index + 1} · t={number(sample.timeS)} s</span><strong className={`dm-value ${grade(Number(sample[spec.key]), spec)}`}>{number(Number(sample[spec.key]))} {spec.unit}</strong></div>
    <div className="dm-sample-rows">{[
      ['RSRP / SS-RSRP', `${number(sample.rsrpDbm)} dBm`], ['RSRQ / SS-RSRQ', `${number(sample.rsrqDb)} dB`],
      ['SINR / SS-SINR', `${number(sample.sinrDb)} dB`], ['DL / UL throughput', `${number(sample.dlMbps)} / ${number(sample.ulMbps)} Mbps`],
      ['Event annotation', sample.event || 'none'], ['Plot location', `${number(sample.x)}%, ${number(sample.y)}%`],
    ].map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
    <p className="dm-caveat">{trace.source === 'synthetic-demo' ? 'Synthetic demonstration · no radio model produced this point.' : 'CSV import · source and RF calibration not verified.'}</p>
  </> : <div className="dm-empty">No samples for this radio technology. Choose another filter or import a trace containing it.</div>;

  const renderAnalysis = () => {
    const sourceDemo = trace.source === 'synthetic-demo';
    const sourceBadge = sourceDemo ? 'SYNTHETIC DEMO · NOT MEASURED' : 'IMPORTED CSV · UNVERIFIED';
    const cursor = Math.min(state.position, Math.max(0, stats.sampleCount - 1));
    const windowStart = Math.max(0, cursor - 10);
    const rows = stats.filtered.slice(windowStart, windowStart + 25);
    const sampleValue = (sample: Sample) => Number(sample[spec.key]);
    const mapLine = stats.filtered.map(sample => `${sample.x * 9},${sample.y * 5.4}`).join(' ');
    const trendValues = stats.filtered.map(sampleValue);
    const min = trendValues.length ? Math.min(...trendValues, spec.poor) - (spec.unit === 'Mbps' ? 4 : 5) : 0;
    const max = trendValues.length ? Math.max(...trendValues, spec.good) + (spec.unit === 'Mbps' ? 4 : 5) : 1;
    const xTrend = (index: number) => 42 + 850 * index / Math.max(1, stats.sampleCount - 1);
    const yTrend = (value: number) => 200 - 165 * (value - min) / (max - min || 1);
    const stride = Math.max(1, Math.ceil(stats.sampleCount / 500));
    return <>
      <div className="dm-source"><div><strong>{sourceBadge}</strong><span>{sourceDemo
        ? 'Deterministic UI illustration derived from the planned route, not Sionna-RT, measured RF, or an executed UE/RAN job.'
        : `Local file ${state.filename}; provenance, calibration and network origin have not been verified.`}</span></div><small>ANALYSIS MODE</small></div>
      <div className="dm-toolbar">
        <label className="form-field"><span>Radio access</span><select className="select" id="dm-technology" aria-label="Radio access" value={state.technology}
          onChange={event => session.selectTechnology(event.currentTarget.value as Technology)}>
          <option value="ALL">4G + 5G</option><option value="LTE">4G LTE</option><option value="NR">5G NR</option></select></label>
        <label className="form-field"><span>Color route by</span><select className="select" id="dm-metric" aria-label="Color route by" value={state.metric}
          onChange={event => session.selectMetric(event.currentTarget.value as Metric)}>
          {Object.entries(metrics).map(([id, metric]) => <option value={id} key={id}>{metric.label}</option>)}</select></label>
        <label className="button outline dm-import" role="button" tabIndex={0} aria-label="Import DM CSV" onKeyDown={event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click(); }
        }}>↥ Import DM CSV<input ref={fileInput} type="file" id="dm-csv" accept=".csv,text/csv" hidden disabled={busy}
          onChange={event => { void importFile(event.currentTarget.files?.[0]); }}/></label>
        <button type="button" className="button outline" id="dm-reset" onClick={() => session.resetDemo()}>Reset demo</button>
        <button type="button" className="button outline" id="dm-export" onClick={() => void run(() => commands.onAnalysisExport(session.buildAnalysisReport()))}>⇩ Analysis JSON</button>
      </div>
      <div className="dm-stats">
        <article><span>AVERAGE {spec.label}</span><strong>{number(stats.average)} <small>{spec.unit}</small></strong><em>{stats.sampleCount} selected · LTE {stats.techCounts.LTE} / NR {stats.techCounts.NR}</em></article>
        <article><span>10TH PERCENTILE</span><strong>{number(stats.p10)} <small>{spec.unit}</small></strong><em>Lower-tail diagnostic · example threshold {spec.poor} {spec.unit}</em></article>
        <article><span>WEAK SAMPLES</span><strong>{stats.weakCount} <small>/ {stats.sampleCount}</small></strong><em>{number(stats.weakPercent)}% below example threshold · {stats.weakZones.length} zones</em></article>
        <article><span>RAN MOBILITY EVENTS</span><strong>{stats.handoverCount} <small>annotated HO</small></strong><em>{stats.cellChangeCount} adjacent serving-cell changes</em></article>
      </div>
      <div className="dm-main">
        {panel('Drive trace & RF quality', `Colored by ${spec.label} · click timeline events or scrub the cursor`, <>
          <div className="dm-legend"><span><i className="dm-dot good"/> ≥ {spec.good} {spec.unit} · strong</span><span><i className="dm-dot watch"/> {spec.poor}–{spec.good} · watch</span><span><i className="dm-dot poor"/> &lt; {spec.poor} · weak</span><em>Example bands for UI review; tune against a real network acceptance policy.</em></div>
          <div className="dm-map"><svg viewBox="0 0 900 540" role="img" aria-label={`${spec.label} map of the drive trace`}>
            <rect width="900" height="540" fill="#f3f8f8"/><g stroke="#dde8e8" strokeWidth="18" fill="none"><path d="M0 120 L900 230"/><path d="M80 400 L900 345"/><path d="M160 0 L265 540"/><path d="M600 0 L445 540"/></g>
            <polyline points={mapLine} fill="none" stroke="#91aaa9" strokeWidth="4" strokeDasharray="7 7"/>
            {stats.filtered.filter((_, index) => index % Math.max(1, Math.ceil(stats.sampleCount / 350)) === 0).map(sample => <circle key={sample.index}
              cx={sample.x * 9} cy={sample.y * 5.4} r="6" fill={colors[grade(sampleValue(sample), spec)]} opacity=".84"/>)}
            {selected && <g id="dm-marker" transform={`translate(${selected.x * 9} ${selected.y * 5.4})`}><circle r="16" fill="#153b4e33" stroke="#153b4e" strokeWidth="3"/><circle r="5" fill="#153b4e"/></g>}
          </svg><span>{sourceDemo ? 'SCHEMATIC TRACE · SYNTHETIC DEMO' : `IMPORTED TRACE · ${state.filename}`}</span></div>
          <div className="dm-playback"><button type="button" id="dm-play" className="button primary" disabled={!stats.sampleCount} onClick={() => session.play()}>{state.playing ? 'Ⅱ Pause' : '▶ Play trace'}</button>
            <input id="dm-position" type="range" aria-label="DM trace sample" min="0" max={Math.max(0, stats.sampleCount - 1)} value={cursor} disabled={!stats.sampleCount}
              onChange={event => session.seek(Number(event.currentTarget.value))}/><strong id="dm-position-label">{stats.sampleCount ? cursor + 1 : 0} / {stats.sampleCount}</strong></div>
        </>, badge(sourceDemo ? 'DEMO TRACE' : 'IMPORTED TRACE', 'warn'))}
        {panel('Selected sample', 'Per-sample LTE/NR DM inspector; all sources disclosed', <div id="dm-selected">{renderSample(selected)}</div>, badge(selected?.technology === 'NR' ? '5G NR' : selected ? '4G LTE' : 'NO DATA'))}
      </div>
      {panel('KPI trend / sample sequence', 'Compare quality over the drive trace; dashed reference is a UI-only threshold',
        stats.sampleCount ? <div className="dm-trend"><svg viewBox="0 0 940 235" role="img" aria-label={`${spec.label} trend by sample number, with illustrative quality thresholds`}>
          <g stroke="#e3edf0" strokeWidth="1"><line x1="42" y1="35" x2="900" y2="35"/><line x1="42" y1="117" x2="900" y2="117"/><line x1="42" y1="200" x2="900" y2="200"/></g>
          <line x1="42" y1={yTrend(spec.poor)} x2="900" y2={yTrend(spec.poor)} stroke="#de948b" strokeWidth="1.5" strokeDasharray="6 5"/>
          {Array.from({ length: Math.ceil(Math.max(0, stats.sampleCount - 1) / stride) }, (_, step) => {
            const index = (step + 1) * stride; if (index >= stats.sampleCount) return null;
            const previous = stats.filtered[index - stride], current = stats.filtered[index];
            if (current.index - previous.index > stride) return null;
            return <line key={current.index} x1={xTrend(index - stride)} y1={yTrend(sampleValue(previous))} x2={xTrend(index)} y2={yTrend(sampleValue(current))}
              stroke={colors[grade(sampleValue(current), spec)]} strokeWidth="3" strokeLinecap="round"/>;
          })}
          <line id="dm-trend-cursor" x1={xTrend(cursor)} x2={xTrend(cursor)} y1="30" y2="204" stroke="#153b4e" strokeWidth="2" strokeDasharray="5 5"/>
          <g fill="#577381" fontSize="11"><text x="42" y="224">start</text><text x="857" y="224">end</text></g>
        </svg></div> : <div className="dm-empty">No matching samples for the trend chart.</div>)}
      <div className="lower-grid">
        {panel('Event timeline', `${stats.events.length} event annotations · not all cell changes imply successful handovers`, stats.events.length
          ? <div className="dm-event-list">{stats.events.slice(0, 20).map(sample => <button type="button" className="dm-event" key={sample.index} data-dm-jump={sample.index} onClick={() => session.jumpToSample(sample.index)}>
            <span>#{sample.index + 1} · {number(sample.timeS)} s</span><strong>{sample.event}</strong><small>{sample.technology} · {sample.servingCell}</small></button>)}</div>
          : <div className="dm-empty">No handover or RAT events in the selected technology. This is not proof of zero mobility failures.</div>)}
        {panel('Weak-zone review', `${stats.weakZones.length} contiguous segments below example ${spec.label} threshold`, stats.weakZones.length
          ? <div className="dm-event-list">{stats.weakZones.slice(0, 12).map(zone => <button type="button" className="dm-event dm-weak" key={zone.start} data-dm-jump={zone.start} onClick={() => session.jumpToSample(zone.start)}>
            <span>SAMPLES {zone.start + 1}–{zone.end + 1}</span><strong>{spec.label} below {spec.poor} {spec.unit}</strong><small>Review trace segment →</small></button>)}</div>
          : <div className="dm-empty">No points below the example threshold in this filtered trace. Not a coverage guarantee.</div>)}
      </div>
      {panel('Sample explorer', 'Showing a 25-row window around the selected cursor; imported measurements remain unverified', <>
        <p className="drive-scroll-hint">Scroll the sample table horizontally to inspect all measurements.</p>
        <div className="table-wrap" role="region" aria-label="Drive measurement sample table; scroll horizontally to inspect all columns" tabIndex={0}><table className="data-table dm-table"><thead><tr><th>POINT</th><th>TIME</th><th>RAT</th><th>SERVING CELL</th><th>RSRP / SS-RSRP</th><th>RSRQ / SS-RSRQ</th><th>SINR / SS-SINR</th><th>DL Mbps</th><th>EVENT</th></tr></thead><tbody>
          {rows.length ? rows.map(sample => <tr key={sample.index} className={sample.index === selected?.index ? 'dm-row-selected' : ''}>
            <td><button type="button" data-dm-jump={sample.index} onClick={() => session.jumpToSample(sample.index)}>#{sample.index + 1}</button></td><td>{number(sample.timeS)} s</td>
            <td>{sample.technology === 'NR' ? '5G NR' : '4G LTE'}</td><td>{sample.servingCell}</td><td className={grade(sample.rsrpDbm, DM_METRICS.rsrp)}>{number(sample.rsrpDbm)}</td>
            <td>{number(sample.rsrqDb)}</td><td className={grade(sample.sinrDb, metrics.sinr)}>{number(sample.sinrDb)}</td><td>{number(sample.dlMbps)}</td><td>{sample.event || '—'}</td></tr>)
            : <tr><td colSpan={9}>No samples match this radio filter.</td></tr>}
        </tbody></table></div>
        <div className="detail-copy">For a real drive-test verdict, integrate georeferenced trace alignment, run ID, Sionna-RT/channel provenance, RAN package and UE runtime evidence, calibration and acceptance limits. This browser does not infer pass/fail.</div>
      </>, badge('NO ACCEPTANCE VERDICT', 'warn'))}
    </>;
  };

  return <section className="drive-preview" role="region" aria-label="Drive preview route">
    <div className="page-heading"><div><p className="eyebrow">5G RAN DIGITAL TWIN / {String((project.map as { cluster?: string }).cluster ?? '').toUpperCase()}</p>
      <h1>Virtual drive test</h1><p className="muted">Plan a software UE route and inspect 4G/5G drive-measurement-style RF evidence with explicit source provenance.</p></div></div>
    <div className="summary-banner warn"><div><strong>Preparation workspace · RAN integration not connected</strong><p>Local GeoJSON and Sionna-RT path jobs are available when a compatible runtime is configured. Real vCore / vDU, GH200 discovery, and calibrated RF results remain unverified.</p></div><span className="mini-pill warn">RAN OFFLINE</span></div>
    <div className="dm-tabs" role="tablist" aria-label="Virtual drive test workspaces">
      {tabs.map(tab => <button type="button" role="tab" key={tab.id} data-drive-tab={tab.id} aria-selected={state.tab === tab.id}
        aria-controls="drive-panel" tabIndex={state.tab === tab.id ? 0 : -1} ref={node => { if (node) tabsRef.current[tab.id] = node; }}
        onClick={() => session.selectTab(tab.id)} onKeyDown={tabKeyDown}>{tab.label}</button>)}
    </div>
    <div id="drive-panel" role="tabpanel">{state.tab === 'analysis' ? renderAnalysis() : renderPlan()}</div>
  </section>;
}
