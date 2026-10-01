import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { topologySummary } from '../../../management.mjs';
import type { AppController } from '../../app/AppController';
import type { WorkspaceSnapshot } from '../../api/schemas';
import { HardwareSession } from './HardwareSession';
import { applyHardwareField } from './hardwareCommands';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type Pool = { id: string; alias: string; plannedServers: number };
type Link = { id: string; from: string; to: string };
type Asset = { id: string; name: string; role: string; alias: string };
type Management = {
  topology: { gh200Pools: Pool[]; links: Link[]; vduServerCount: number | null; switchPortCount: number | null };
  hardware: Asset[];
};
type Project = { management: Management };
type HardwareField = Parameters<typeof applyHardwareField>[2];
type Mode = 'network' | 'racks' | 'inventory';

const tabs: { mode: Mode; label: string }[] = [
  { mode: 'network', label: 'Fronthaul topology' },
  { mode: 'racks', label: 'Rack & server bays' },
  { mode: 'inventory', label: 'Capacity & registry' },
];
const padSlot = (slot: number) => String(slot).padStart(2, '0');
const serverId = (pool: Pool, slot: number) => `${pool.id}-S${padSlot(slot)}`;
const shortAlias = (alias: string) => alias.length > 23 ? `${alias.slice(0, 22)}…` : alias;
const countLabel = (value: number | null) => value === null ? 'TBD' : value;
const errorMessage = (cause: unknown) => cause instanceof Error ? cause.message : String(cause);

function PagePanel({ children, label }: { children: ReactNode; label: string }) {
  return <section className="hwx-inspector-block" aria-label={label}>{children}</section>;
}

export default function HardwarePreviewLeaf({ controller, record: recordProp, onError }: {
  controller: AppController;
  record: ProjectRecord;
  onError: (message: string) => void;
}) {
  const controllerState = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const activeProjectId = controllerState.workspace?.activeProjectId;
  const record = controllerState.workspace?.projects.find(item => item.id === activeProjectId) ?? recordProp;
  const project = record.project as unknown as Project;
  const management = project.management;
  const topology = management.topology;
  const [session] = useState(() => new HardwareSession(record.id, project));
  const selection = useSyncExternalStore(session.subscribe, session.getSnapshot);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const tabRefs = useRef<Partial<Record<Mode, HTMLButtonElement>>>({});
  const latestCommit = useRef(0);
  const fieldVersions = useRef(new Map<string, number>());
  const summary = topologySummary(management);

  useEffect(() => { session.setProject(record.id, project); }, [record.id, project, session]);

  const selectedLink = topology.links.find(link => link.id === selection.selectedLink) ?? null;
  const selectedPool = topology.gh200Pools.find(pool => pool.id === selection.selectedNode);
  const activePool = selectedPool ?? topology.gh200Pools[0];
  const selectedInfra = selection.selectedNode === 'vdu-pool' || selection.selectedNode === 'ethernet-switch';
  const activeMode = selection.mode;
  const draftKey = (field: HardwareField) => `${record.id}:${'id' in field ? field.id : field.kind}:${field.kind}`;
  const valueFor = (field: HardwareField, canonical: number | string | null) =>
    drafts[draftKey(field)] ?? (canonical === null ? '' : String(canonical));
  const forgetDraft = (key: string) => setDrafts(current => {
    const next = { ...current };
    delete next[key];
    return next;
  });
  const stageDraft = (field: HardwareField, value: string) => {
    setDrafts(current => ({ ...current, [draftKey(field)]: value }));
  };
  const commit = (field: HardwareField, value: string) => {
    const key = draftKey(field);
    const commitId = ++latestCommit.current;
    const fieldVersion = (fieldVersions.current.get(key) ?? 0) + 1;
    fieldVersions.current.set(key, fieldVersion);
    const isCurrentField = () => fieldVersions.current.get(key) === fieldVersion;
    const forgetCurrentDraft = () => { if (isCurrentField()) forgetDraft(key); };
    const reportCurrentError = (message: string) => {
      if (latestCommit.current === commitId) onError(message);
    };
    try {
      const save = applyHardwareField(controller, record.id, field, value);
      if (!save) { forgetCurrentDraft(); return; }
      void save.then(() => { forgetCurrentDraft(); reportCurrentError(''); })
        .catch(cause => { forgetCurrentDraft(); reportCurrentError(errorMessage(cause)); });
    } catch (cause) {
      forgetCurrentDraft();
      reportCurrentError(errorMessage(cause));
    }
  };
  const moveTab = (next: Mode) => {
    session.selectTab(next);
    tabRefs.current[next]?.focus({ preventScroll: true });
  };
  const tabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = tabs.findIndex(tab => tab.mode === activeMode);
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
      : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    moveTab(tabs[nextIndex].mode);
  };
  const svgKeyDown = (event: KeyboardEvent<SVGGElement>, select: () => void) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    select();
  };
  const input = (label: string, field: HardwareField, canonical: number | string | null,
    { min, max, type = 'number', data }: { min?: number; max?: number; type?: 'number' | 'text'; data: string }) =>
    <label className="hwx-field" key={data}><span>{label}</span><input type={type} min={min} max={max}
      maxLength={type === 'text' ? 80 : undefined} placeholder={canonical === null ? 'TBD' : undefined}
      data-pool-alias={'id' in field && field.kind === 'poolAlias' ? field.id : undefined}
      data-pool-count={'id' in field && field.kind === 'poolCount' ? field.id : undefined}
      data-hw-count={field.kind === 'vduCount' ? 'vdu' : field.kind === 'switchCount' ? 'switch' : undefined}
      value={valueFor(field, canonical)}
      onChange={event => stageDraft(field, event.currentTarget.value)}
      onBlur={event => commit(field, event.currentTarget.value)} /></label>;

  const renderNetwork = () => {
    const rows = [78, 178, 278, 378];
    const firstLink = topology.links[0];
    return <>
      <p className="hardware-scroll-hint">Scroll the topology diagram horizontally to inspect all planned links.</p>
      <div className="hwx-graph-wrap" role="region" aria-label="Hardware topology diagram; scroll horizontally to inspect all details" tabIndex={0}>
        <svg className="hwx-graph" viewBox="0 0 870 460" role="img"
          aria-label="Planned fronthaul topology. Select a device or one of five unverified Ethernet paths to inspect it">
          <defs><pattern id="hw-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0 H0 V24" fill="none" stroke="#dbe9ec" strokeWidth="1" />
          </pattern></defs>
          <rect width="870" height="460" fill="#f8fbfc" /><rect width="870" height="460" fill="url(#hw-grid)" />
          <text className="hwx-zone" x="37" y="27">PHYSICAL DU</text><text className="hwx-zone" x="335" y="27">ETHERNET FABRIC</text>
          <text className="hwx-zone" x="635" y="27">GH200 POOLS</text>
          {firstLink && <g className={`hwx-edge${selectedLink?.id === firstLink.id ? ' selected' : ''}`}
            data-hw-link={firstLink.id} role="button" tabIndex={0}
            aria-label={`Inspect unverified ${firstLink.id} Ethernet path`}
            onClick={() => session.selectLink(firstLink.id)} onKeyDown={event => svgKeyDown(event, () => session.selectLink(firstLink.id))}>
            <path className="hwx-edge-line" d="M234 240 H335" /><path className="hwx-edge-hit" d="M234 240 H335" />
            <text x="267" y="226">L01</text>
          </g>}
          {topology.gh200Pools.map((pool, index) => {
            const y = rows[index] ?? 78;
            const link = topology.links[index + 1];
            return <g key={pool.id}>
              {link && <g className={`hwx-edge${selectedLink?.id === link.id ? ' selected' : ''}`}
                data-hw-link={link.id} role="button" tabIndex={0} aria-label={`Inspect unverified ${link.id} Ethernet path`}
                onClick={() => session.selectLink(link.id)} onKeyDown={event => svgKeyDown(event, () => session.selectLink(link.id))}>
                <path className="hwx-edge-line" d={`M504 240 H552 V${y} H628`} />
                <path className="hwx-edge-hit" d={`M504 240 H552 V${y} H628`} /><text x="569" y={y - 9}>L0{index + 2}</text>
              </g>}
              <g className={`hwx-node hwx-pool-node${selection.selectedNode === pool.id && !selectedLink ? ' selected' : ''}`}
                data-hw-node={pool.id} role="button" tabIndex={0} aria-label={`Inspect ${pool.alias}`}
                onClick={() => session.selectNode(pool.id)} onKeyDown={event => svgKeyDown(event, () => session.selectNode(pool.id))}>
                <rect x="629" y={y - 37} width="207" height="75" rx="10" />
                <text className="hwx-node-kicker" x="645" y={y - 16}>POOL 0{index + 1} · GH200</text>
                <text className="hwx-node-title" x="645" y={y + 7}>{shortAlias(pool.alias)}</text>
                <text className="hwx-node-detail" x="645" y={y + 27}>{pool.plannedServers}/6 targeted · 0 discovered</text>
              </g>
            </g>;
          })}
          <g className={`hwx-node${selection.selectedNode === 'vdu-pool' && !selectedLink ? ' selected' : ''}`}
            data-hw-node="vdu-pool" role="button" tabIndex={0} aria-label="Inspect real vDU server pool"
            onClick={() => session.selectNode('vdu-pool')} onKeyDown={event => svgKeyDown(event, () => session.selectNode('vdu-pool'))}>
            <rect x="38" y="198" width="196" height="84" rx="10" />
            <text className="hwx-node-kicker" x="53" y="221">REAL NETWORK ELEMENT</text>
            <text className="hwx-node-title" x="53" y="247">vDU server pool</text>
            <text className="hwx-node-detail" x="53" y="269">{countLabel(topology.vduServerCount)} target hosts</text>
          </g>
          <g className={`hwx-node hwx-switch-node${selection.selectedNode === 'ethernet-switch' && !selectedLink ? ' selected' : ''}`}
            data-hw-node="ethernet-switch" role="button" tabIndex={0} aria-label="Inspect Ethernet switch fabric"
            onClick={() => session.selectNode('ethernet-switch')}
            onKeyDown={event => svgKeyDown(event, () => session.selectNode('ethernet-switch'))}>
            <rect x="335" y="198" width="169" height="84" rx="10" />
            <text className="hwx-node-kicker" x="350" y="221">PHYSICAL FABRIC</text>
            <text className="hwx-node-title" x="350" y="247">Ethernet switch</text>
            <text className="hwx-node-detail" x="350" y="269">{countLabel(topology.switchPortCount)} target ports</text>
          </g>
        </svg>
      </div>
    </>;
  };

  const renderRackRoom = () => <>
    <p className="hardware-scroll-hint">Scroll the rack elevations horizontally to inspect all bays.</p>
    <div className="hwx-room" role="region" aria-label="Hardware rack elevations; scroll horizontally to inspect all details" tabIndex={0}>
      <div className="hwx-room-top">
        <button type="button" className={`hwx-device-summary${selection.selectedNode === 'vdu-pool' ? ' selected' : ''}`}
          data-hw-node="vdu-pool" onClick={() => session.selectNode('vdu-pool')}>
          <span className="hwx-summary-icon">▤</span><span><b>vDU server pool</b><small>Real hosts · count {countLabel(topology.vduServerCount)}</small></span>
        </button>
        <div className="hwx-patchline" aria-hidden="true">······→</div>
        <button type="button" className={`hwx-device-summary${selection.selectedNode === 'ethernet-switch' ? ' selected' : ''}`}
          data-hw-node="ethernet-switch" onClick={() => session.selectNode('ethernet-switch')}>
          <span className="hwx-summary-icon">⇄</span><span><b>Ethernet switch fabric</b><small>Port map {countLabel(topology.switchPortCount)} · no verified links</small></span>
        </button>
        <div className="hwx-patchline" aria-hidden="true">······→</div><span className="hwx-room-caption">Four GH200 pools</span>
      </div>
      <div className="hwx-racks">{topology.gh200Pools.map(pool => <div className={`hwx-rack-unit${selection.selectedNode === pool.id ? ' selected' : ''}`} key={pool.id}>
        <button type="button" className="hwx-rack-heading" data-hw-node={pool.id} aria-label={`Inspect ${pool.alias}`}
          onClick={() => session.selectNode(pool.id)}><span>{pool.alias}</span><strong>{pool.plannedServers} / 6</strong></button>
        <div className={`hwx-rack-cabinet${selection.isometric ? ' isometric' : ''}`}>
          <div className="hwx-rack-side" aria-hidden="true" /><div className="hwx-rack-top" aria-hidden="true" />
          <div className="hwx-rack-face"><div className="hwx-rack-label"><b>{pool.id}</b><small>GH200 GPU SERVER TARGETS</small></div>
            <div className="hwx-rail">{Array.from({ length: 6 }, (_, index) => {
              const id = serverId(pool, index + 1);
              const planned = index < pool.plannedServers;
              return <button type="button" className={`hwx-device ${planned ? 'planned' : 'reserved'}${selection.selectedServer === id ? ' selected' : ''}`}
                key={id} data-hw-slot={id} title={`${id}: ${planned ? 'planned' : 'reserved'}, not discovered`}
                aria-label={`Inspect ${id}, ${planned ? 'planned' : 'reserved'} and not discovered`}
                onClick={() => session.selectServer(id)}>
                <span className="hwx-device-handle" /><span className="hwx-device-face"><b>S{padSlot(index + 1)}</b><small>GH200</small><i /></span>
                <span className="hwx-device-state">{planned ? 'TARGET' : 'EMPTY'}</span>
              </button>;
            })}</div>
            <div className="hwx-rack-foot">H200 / GRACE · TARGET ROLE</div>
          </div>
        </div>
      </div>)}</div>
      <div className="hwx-room-footer">Physical rack elevations are illustrative. Bay positions and chassis proportions are not surveyed; all hardware is undiscovered.</div>
    </div>
  </>;

  const renderInventory = () => <div className="hwx-inventory">
    <div className="hwx-inventory-intro"><strong>Capacity plan</strong><span>Changes save locally on field exit · no device discovery is performed.</span></div>
    <div className="hwx-targets">
      {input('vDU hosts · count unknown', { kind: 'vduCount' }, topology.vduServerCount, { min: 1, max: 64, data: 'vdu' })}
      {input('Ethernet switch · ports unknown', { kind: 'switchCount' }, topology.switchPortCount, { min: 1, max: 512, data: 'switch' })}
    </div>
    <p className="hardware-scroll-hint">Scroll the capacity registry horizontally to inspect all details.</p>
    <div className="hwx-table-wrap" role="region" aria-label="Hardware capacity registry; scroll horizontally to inspect all columns" tabIndex={0}>
      <table className="hwx-table"><thead><tr><th>POOL</th><th>PLANNING ALIAS</th><th>GH200 TARGETS</th><th>DISCOVERED</th></tr></thead>
        <tbody>{topology.gh200Pools.map(pool => <tr key={pool.id}>
          <th><button type="button" className="hwx-table-link" data-hw-node={pool.id} onClick={() => session.selectNode(pool.id)}>{pool.id}</button></th>
          <td><input aria-label={`Planning alias for ${pool.id}`} data-pool-alias={pool.id} maxLength={80}
            value={valueFor({ kind: 'poolAlias', id: pool.id }, pool.alias)}
            onChange={event => stageDraft({ kind: 'poolAlias', id: pool.id }, event.currentTarget.value)}
            onBlur={event => commit({ kind: 'poolAlias', id: pool.id }, event.currentTarget.value)} /></td>
          <td><input aria-label={`Planned server count for ${pool.id}`} data-pool-count={pool.id} type="number" min={0} max={6}
            value={valueFor({ kind: 'poolCount', id: pool.id }, pool.plannedServers)}
            onChange={event => stageDraft({ kind: 'poolCount', id: pool.id }, event.currentTarget.value)}
            onBlur={event => commit({ kind: 'poolCount', id: pool.id }, event.currentTarget.value)} /> / 6</td>
          <td><span className="hwx-status">0 · NOT DISCOVERED</span></td>
        </tr>)}</tbody>
      </table>
    </div>
    <details className="hwx-registry"><summary>Hardware role registry <span>6 target roles · editable aliases</span></summary>
      <div className="hwx-role-list">{management.hardware.map(asset => <label className="hwx-role" key={asset.id}>
        <span><strong>{asset.name}</strong><small>{asset.role}</small></span>
        <input aria-label={`Planning alias for ${asset.name}`} data-hw-alias={asset.id} maxLength={80}
          value={valueFor({ kind: 'hardwareAlias', id: asset.id }, asset.alias)}
          onChange={event => stageDraft({ kind: 'hardwareAlias', id: asset.id }, event.currentTarget.value)}
          onBlur={event => commit({ kind: 'hardwareAlias', id: asset.id }, event.currentTarget.value)} />
      </label>)}</div>
    </details>
  </div>;

  const renderPoolInspector = () => {
    if (!activePool) return null;
    const slotIndex = Array.from({ length: 6 }, (_, index) => serverId(activePool, index + 1)).indexOf(selection.selectedServer ?? '');
    const selectedSlot = slotIndex >= 0;
    const slotName = selectedSlot ? selection.selectedServer : null;
    return <>
      <div className="hwx-inspector-head"><span className="hwx-overline">{selectedSlot ? 'SERVER BAY · NO DISCOVERY' : 'SELECTED COMPUTE POOL'}</span>
        <h2>{slotName ?? activePool.alias}</h2><p>{activePool.id} · {activePool.plannedServers} of 6 planned GH200 hosts</p>
        <span className="hwx-status">{selectedSlot && slotIndex >= activePool.plannedServers ? 'RESERVED' : 'PLANNED'} · NOT DISCOVERED</span>
      </div>
      {selectedSlot ? <PagePanel label="Target roles"><h3>Target roles</h3>
        <div className="hwx-pair"><span>GPU workload</span><b>H200 · target</b></div>
        <div className="hwx-pair"><span>CPU workload</span><b>Grace CPU · target</b></div>
        <div className="hwx-pair"><span>Serial / model</span><b>TBD</b></div>
        <div className="hwx-pair"><span>Cabling</span><b>Unverified</b></div>
      </PagePanel> : <PagePanel label="Plan this pool"><h3>Plan this pool</h3>
        {input('Alias', { kind: 'poolAlias', id: activePool.id }, activePool.alias, { type: 'text', data: `pool-alias-${activePool.id}` })}
        {input('GH200 hosts · up to six', { kind: 'poolCount', id: activePool.id }, activePool.plannedServers,
          { min: 0, max: 6, data: `pool-count-${activePool.id}` })}
      </PagePanel>}
      <PagePanel label="Server bays"><div className="hwx-inspector-line"><h3>Server bays</h3><small>0 DISCOVERED</small></div>
        <div className="hwx-bay-list">{Array.from({ length: 6 }, (_, index) => {
          const id = serverId(activePool, index + 1);
          return <button type="button" key={id} className={selection.selectedServer === id ? 'selected' : ''} data-hw-slot={id}
            onClick={() => session.selectServer(id)}><b>S{padSlot(index + 1)}</b><span>{id}</span>
            <em>{index < activePool.plannedServers ? 'TARGET' : 'RESERVED'}</em></button>;
        })}</div>
      </PagePanel>
      <button type="button" className="hwx-inspector-action" data-hw-view="racks" onClick={() => moveTab('racks')}>View physical rack →</button>
    </>;
  };

  const renderInspector = () => {
    if (selectedLink) return <>
      <div className="hwx-inspector-head"><span className="hwx-overline">SELECTED FRONTHAUL PATH</span><h2>{selectedLink.id}</h2>
        <p>Logical Ethernet design connection</p><span className="hwx-status">UNVERIFIED · NOT WIRED</span></div>
      <PagePanel label="Path record"><h3>Path record</h3>
        <div className="hwx-pair"><span>FROM</span><b>{selectedLink.from}</b></div>
        <div className="hwx-pair"><span>TO</span><b>{selectedLink.to}</b></div>
        <div className="hwx-pair"><span>MEDIUM</span><b>Ethernet · planned</b></div>
        <div className="hwx-pair"><span>PORT MAP</span><b>TBD</b></div><div className="hwx-pair"><span>VLAN</span><b>TBD</b></div>
        <div className="hwx-pair"><span>TIMING</span><b>TBD</b></div>
      </PagePanel>
      <div className="hwx-inspector-note">No port wiring, reachability, synchronization or physical switch discovery has been checked.</div>
    </>;
    if (selectedInfra) {
      const vdu = selection.selectedNode === 'vdu-pool';
      const field: HardwareField = { kind: vdu ? 'vduCount' : 'switchCount' };
      const canonical = vdu ? topology.vduServerCount : topology.switchPortCount;
      return <>
        <div className="hwx-inspector-head"><span className="hwx-overline">{vdu ? 'REAL RAN COMPUTE' : 'PHYSICAL INTERCONNECT'} · TARGET</span>
          <h2>{vdu ? 'vDU server pool' : 'Ethernet switch fabric'}</h2>
          <p>{vdu ? 'Upstream of virtual O-RAN RU' : 'Interconnects vDU and four GH200 pools'}</p><span className="hwx-status">NOT DISCOVERED</span>
        </div>
        <PagePanel label="Known plan"><h3>Known plan</h3>
          {input(vdu ? 'Target vDU hosts' : 'Target switch ports', field, canonical,
            { min: 1, max: vdu ? 64 : 512, data: vdu ? 'vdu' : 'switch' })}
          <div className="hwx-pair"><span>{vdu ? 'Host identity' : 'Switch model'}</span><b>TBD</b></div>
          <div className="hwx-pair"><span>Physical port map</span><b>TBD</b></div><div className="hwx-pair"><span>Validated links</span><b>0</b></div>
        </PagePanel>
        <div className="hwx-inspector-note">Document physical host and switch identifiers before an integration can report real inventory.</div>
      </>;
    }
    return renderPoolInspector();
  };

  const heading = tabs.find(tab => tab.mode === activeMode)!;
  const stageTitle = activeMode === 'network' ? 'LOGICAL NETWORK'
    : activeMode === 'racks' ? 'PHYSICAL ELEVATION · ILLUSTRATIVE' : 'LOCAL CONFIGURATION';
  const stageCaption = activeMode === 'network' ? 'Select a node or dashed path to inspect its evidence.'
    : activeMode === 'racks' ? 'Select a cabinet or bay; these are not scanned 3D assets.'
      : 'Set capacities and aliases; unknown values can remain blank.';

  return <section className="hardware-preview" role="region" aria-label="Hardware preview route">
    <div className="page-heading"><div><p className="eyebrow">5G RAN DIGITAL TWIN / {String((record.project as { map?: { cluster?: string } }).map?.cluster ?? '').toUpperCase()}</p>
      <h1>Hardware topology &amp; inventory</h1><p className="muted">Inspect the planned physical path from vDU through Ethernet fabric to four GH200 server pools.</p>
    </div></div>
    <section className="hwx-statusbar" role="status"><span className="hwx-status-icon" aria-hidden="true">!</span>
      <div><div className="hwx-status-title"><strong>Planning only</strong><span className="hwx-status-pill">No live hardware connected</span></div>
        <p>Illustrative target layout · verify rack placement, port maps and five Ethernet links onsite.</p></div>
      <button type="button" data-hw-view="inventory" onClick={() => moveTab('inventory')}>Edit capacity plan <span aria-hidden="true">→</span></button>
    </section>
    <div className="hwx-stats">
      <article><small>GH200 TARGET CAPACITY</small><strong>{summary.plannedGh200Servers} / 24</strong><span>4 pools · 6 bays maximum each</span></article>
      <article><small>DISCOVERED HOSTS</small><strong>0</strong><span>No hardware source connected</span></article>
      <article><small>FRONTHAUL PATHS</small><strong>0 / {summary.unverifiedLinks}</strong><span>0 verified · Ethernet design links</span></article>
      <article><small>PHYSICAL INPUTS</small><strong>{topology.vduServerCount === null || topology.switchPortCount === null ? 'TBD' : 'PLANNED'}</strong>
        <span>vDU hosts / switch ports</span></article>
    </div>
    <nav className="hwx-tabs" role="tablist" aria-label="Hardware workbench views">
      {tabs.map(tab => <button type="button" id={`hwx-tab-${tab.mode}`} key={tab.mode} role="tab" data-hw-view={tab.mode}
        aria-selected={activeMode === tab.mode} tabIndex={activeMode === tab.mode ? 0 : -1} aria-controls="hwx-stage"
        ref={node => { if (node) tabRefs.current[tab.mode] = node; }}
        onClick={() => session.selectTab(tab.mode)} onKeyDown={tabKeyDown}>{tab.label}</button>)}
    </nav>
    <div className="hwx-workspace">
      <section id="hwx-stage" role="tabpanel" aria-labelledby={`hwx-tab-${activeMode}`} tabIndex={0} className="hwx-stage">
        <div className="hwx-stage-head"><div><span className="hwx-overline">{stageTitle}</span><h2>{heading.label}</h2><p>{stageCaption}</p></div>
          {activeMode === 'racks' ? <button type="button" id="hw-rotate" className="hwx-tool"
            aria-pressed={selection.isometric} onClick={() => session.rotate()}>{selection.isometric ? 'Front elevation' : 'Isometric view'} ↻</button>
            : <span className="hwx-stage-badge">{activeMode === 'network' ? '5 UNVERIFIED LINKS' : 'LOCAL PLAN ONLY'}</span>}
        </div>
        {activeMode === 'network' ? renderNetwork() : activeMode === 'racks' ? renderRackRoom() : renderInventory()}
        <div className="hwx-legend"><span><i className="hwx-legend-target" /> Planned target</span>
          <span><i className="hwx-legend-link" /> Unverified Ethernet</span><span><i className="hwx-legend-none" /> No discovery data</span></div>
      </section>
      <aside className="hwx-inspector" aria-label="Selected hardware details">
        {renderInspector()}<div className="hwx-inspector-foot">Changes save locally on field exit. No action here connects to a network element.</div>
      </aside>
    </div>
  </section>;
}
