import { defaultProject, validateProject, simulatePreview, applyScenario, addSite, readiness, createManifest, sanitizeProject, upgradeProject } from './model.mjs';
import { restoreWorkspaceState, workspaceProject, addWorkspaceProject, renameWorkspaceProject, duplicateWorkspaceProject, activateWorkspaceProject, archiveWorkspaceProject, restoreArchivedWorkspaceProject, deleteArchivedWorkspaceProject, updateWorkspaceProject, appendWorkspaceLog } from './workspaces.mjs';
import { buildArtifactTree, findArtifact, listArtifactFiles } from './artifacts.mjs';
import { drivePlan, abPlan, datasetPlan } from './usecases.mjs';
import { useCaseCards, driveView, abView, dataView } from './usecase-ui.mjs';
import { tasksView, scheduleView, hardwareView, softwareView, monitoringView } from './ops-ui.mjs';
import { addPlannedTask, rescheduleTask } from './tasks.mjs';
import { makeDemoTrace, parseDmCsv, analyzeDmTrace, DM_METRICS } from './dm.mjs';
import { dmView, dmSampleDetails } from './dm-ui.mjs';

const labels = { overview:'Mission control', projects:'Projects', artifacts:'Project artifacts', map:'cluster map & sites', stack:'RAN topology', planner:'Site & cell config', ray:'Ray-tracing lab', ues:'Virtual UE fleet', drive:'Virtual drive test', ab:'Package A/B test', data:'AI-RAN data gen', tasks:'Task board', schedule:'Schedule', hardware:'H/W inventory', software:'Software management', monitoring:'Monitoring', activity:'Activity' };
const scenarios = { baseline:'Baseline', blockage:'Urban blockage', 'ue-surge':'UE density surge', 'clear-line':'Clear line-of-sight' };
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const format = new Intl.NumberFormat('en-US');
const WORKSPACE_STORAGE_KEY = 'atlas-ran-twin-workspaces';
const LEGACY_PROJECT_STORAGE_KEY = 'atlas-ran-twin-project';
function readStoredJson(key) { try { const value=localStorage.getItem(key); return value ? JSON.parse(value) : null; } catch { return null; } }
let workspaceState = restoreWorkspaceState(readStoredJson(WORKSPACE_STORAGE_KEY), readStoredJson(LEGACY_PROJECT_STORAGE_KEY));
let project = structuredClone(workspaceProject(workspaceState));
try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceState)); } catch { /* Keep the in-memory starter usable when browser storage is unavailable. */ }
let view = 'overview', selectedSite = project.sites[0].id, selectedCell = project.sites[0].cells[0].id;
let drivePosition = 0, drivePlaying = false, driveTimer = null;
let driveTab='analysis', dmTechnology='ALL', dmMetric='rsrp', dmTrace=null, dmFilename='';
let hardwareMode='network', selectedHardwareNode='GH-POOL-01', selectedHardwareLink=null, selectedHardwareServer=null, hardwareIsometric=true;
let selectedArtifactId='project-config';
const closedArtifactFolders = new Set();
let layers = { buildings:true, sectors:true, ues:true };
let events = workspaceState.projects.find(record=>record.id===workspaceState.activeProjectId).activity.map(entry=>({when:new Date(entry.when),title:entry.title,detail:entry.detail}));
const content = document.querySelector('#content');
function note(title, detail, projectId=workspaceState.activeProjectId) {
  const entry={when:new Date(),title,detail};
  try { workspaceState=appendWorkspaceLog(workspaceState,projectId,{title,detail},{now:()=>entry.when.toISOString()}); }
  catch { /* Activity logging must not block a valid planning action. */ }
  if(projectId===workspaceState.activeProjectId) { events.unshift(entry); events.splice(80); }
  saveWorkspace();
}
note('Project opened','Local preparation workspace — no external connections');
function saveWorkspace() { try { localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(workspaceState)); return true; } catch { toast('Local storage unavailable; export a manifest to retain changes.'); return false; } }
function persist() { try { workspaceState=updateWorkspaceProject(workspaceState,workspaceState.activeProjectId,p=>Object.assign(p,structuredClone(project))); saveWorkspace(); } catch { toast('Project changes could not be saved; export a manifest to retain them.'); } }
function toast(text) { const el = document.querySelector('#toast'); el.textContent = text; el.classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => el.classList.remove('show'), 3200); }
function currentSite() { return project.sites.find(s => s.id === selectedSite) || project.sites[0]; }
function currentCell() { const site = currentSite(); return site.cells.find(c => c.id === selectedCell) || site.cells[0]; }
function badge(text, style = '') { return `<span class="mini-pill ${style}">${escapeHtml(text)}</span>`; }
function field(label, path, value, type = 'text', attrs = '') { return `<label class="form-field"><span>${label}</span><input type="${type}" data-field="${path}" value="${escapeHtml(value)}" ${attrs}/></label>`; }
function siteField(label, prop, value, type = 'text', attrs = '') { return `<label class="form-field"><span>${label}</span><input type="${type}" data-site="${currentSite().id}" data-prop="${prop}" value="${escapeHtml(value)}" ${attrs}/></label>`; }
function cellField(label, prop, value, attrs = '') { return `<label class="form-field"><span>${label}</span><input type="number" data-cell="${currentCell().id}" data-prop="${prop}" value="${escapeHtml(value)}" ${attrs}/></label>`; }
function header(title, subtitle, button = '') { return `<div class="page-heading"><div><p class="eyebrow">5G RAN DIGITAL TWIN / ${escapeHtml(project.map.cluster.toUpperCase())}</p><h1>${title}</h1><p class="muted">${subtitle}</p></div><div class="heading-actions">${button}</div></div>`; }
function banner() { return `<div class="summary-banner warn"><div><strong>Preparation workspace · integration not connected</strong><p>Real vCore / vDU endpoints, OpenStreetMap scene, GH200 runtime, and Sionna-RT jobs are configuration targets—not live services in this mockup.</p></div>${badge('DEMO / OFFLINE','warn')}</div>`; }
function panel(title, caption, body, extra = '') { return `<section class="panel"><div class="panel-header"><div><h2 class="panel-title">${title}</h2><p class="panel-caption">${caption}</p></div>${extra}</div>${body}</section>`; }
function metric(label, value, unit, foot, icon) { return `<article class="metric-card"><div class="metric-label"><span>${label}</span><span class="metric-icon">${icon}</span></div><div class="metric-value">${value}<em>${unit}</em></div><div class="metric-foot">${foot}</div></article>`; }
function metrics(preview) { return `<div class="metrics-grid">${metric('SITES / CELLS', project.sites.length + ' / ' + preview.cells, '', 'Three sectors per planned site', '⌖')}${metric('VIRTUAL UE LOAD', format.format(project.ue.count), 'UEs', 'Grace CPU software model · planned', '◎')}${metric('COVERAGE PROXY', preview.coveragePercent, '%', 'Illustrative only · not Sionna-RT', '◌')}${metric('CAPACITY PRESSURE', preview.capacityPressure, '%', 'Synthetic planning indicator', '↗')}</div>`; }
function readinessPanel() { const r = readiness(project); return panel('Deployment readiness','Evidence gates for an actual radio twin', `<div class="check-list">${r.checks.map(x => `<div class="check-item"><span class="check-icon ${x.done ? 'done' : ''}">${x.done ? '✓' : '·'}</span><span>${x.label}</span>${!x.done ? '<small>PENDING</small>' : '<small class="positive">CONFIGURED</small>'}</div>`).join('')}</div><div class="detail-copy">No check is inferred from this browser mockup. A reference file or endpoint string does not prove import, calibration, or connectivity.</div>`, badge(`${r.checks.filter(x => x.done).length} / ${r.checks.length} GATES`,'warn')); }
function architectureStrip() {
  const blocks = [
    ['vCore','REAL NETWORK ELEMENT','CORE','real'],['vDU','REAL NETWORK ELEMENT','RAN DU','real'],['O-RAN RU','VIRTUAL COMPONENT','RU','virtual'],['Antenna / MMU','VIRTUAL RF FRONT END','RF','virtual'],['Sionna-RT','CHANNEL · PLANNED','RT','planned'],['Software UE','VIRTUAL · GRACE CPU','UE','virtual']
  ];
  return panel('End-to-end twin boundary','Physical network to virtual radio and CPU-based UEs', `<div class="stack-flow">${blocks.map(([name,kind,icon,mode],i) => `<div class="stack-part"><div class="stack-block ${mode}"><div class="stack-glyph">${icon}</div><strong>${name}</strong><small>${kind}</small></div>${i < blocks.length - 1 ? '<span class="stack-arrow">→</span>' : ''}</div>`).join('')}</div><div class="stack-foot"><span>PHYSICAL NETWORK SIDE</span><span>VIRTUALIZATION ON GH200 · H200 GPU + GRACE CPU</span></div>`, badge('TARGET ARCHITECTURE'));
}
function gridMap() {
  const roads = `<g stroke="#7595a030" stroke-width="18" fill="none"><path d="M0 105 L900 210"/><path d="M0 395 L900 340"/><path d="M155 0 L260 540"/><path d="M560 0 L440 540"/><path d="M865 0 L700 540"/></g><g stroke="#46566a" stroke-width="1" stroke-dasharray="5 7" fill="none"><path d="M0 105 L900 210"/><path d="M0 395 L900 340"/><path d="M155 0 L260 540"/><path d="M560 0 L440 540"/></g>`;
  const blocks = Array.from({ length: 58 }, (_, i) => {
    const x = 28 + (i * 137) % 836, y = 20 + (i * 83 + Math.floor(i / 7) * 77) % 485;
    const w = 25 + (i * 11) % 40, h = 16 + (i * 17) % 36;
    return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${i % 7 === 0 ? '#334652' : '#263a4a'}" stroke="#52728055"/>`;
  }).join('');
  const ueDots = Array.from({ length: 88 }, (_, i) => { const x = 20 + (i * 149 + i * i * 3) % 860, y = 20 + (i * 91 + i * i * 7) % 490; return `<circle cx="${x}" cy="${y}" r="2.4" fill="#8dcbef" opacity=".65"/>`; }).join('');
  const sites = project.sites.map(s => {
    const x = s.x * 9, y = s.y * 5.4, active = selectedSite === s.id;
    const cones = s.cells.map(c => { const a = (c.azimuthDeg - 48) * Math.PI / 180, b = (c.azimuthDeg + 48) * Math.PI / 180, radius = 92 + (c.txPowerDbm - 43) * 2;
      return `<path d="M${x} ${y} L${x + radius * Math.sin(a)} ${y - radius * Math.cos(a)} A${radius} ${radius} 0 0 1 ${x + radius * Math.sin(b)} ${y - radius * Math.cos(b)} Z" fill="${active ? '#46dabb2c' : '#57a9c319'}" stroke="${active ? '#6be2c588' : '#60a2bd66'}" stroke-width="1"/>`;
    }).join('');
    return `<g class="site-group ${active ? 'selected' : ''}" data-site-select="${s.id}" role="button" tabindex="0" aria-label="Select ${escapeHtml(s.name)} site">${layers.sectors ? cones : ''}<circle cx="${x}" cy="${y}" r="${active ? 21 : 17}" fill="#0f3039" stroke="${active ? '#74ecd6' : '#6ab3bd'}" stroke-width="3"/><text class="site-symbol" x="${x}" y="${y + 5}">⌁</text><text class="site-label" x="${x}" y="${y + 39}">${escapeHtml(s.name)}</text><text class="site-sub" x="${x}" y="${y + 53}">${s.id} · 3 CELLS</text></g>`;
  }).join('');
  return panel('City / cluster radio environment','Schematic preview · not imported OpenStreetMap geometry', `<div class="ran-map"><div class="map-overlays"><span>◇ ${escapeHtml(project.map.city)} / ${escapeHtml(project.map.cluster)}</span>${badge('NOT GEOREFERENCED','warn')}</div><svg viewBox="0 0 900 540" class="city-svg" role="img" aria-label="Schematic city map with selectable 5G sites"><rect width="900" height="540" fill="#142333"/><path d="M0 478 Q180 408 330 477 T680 463 T900 500 L900 540 L0 540Z" fill="#21475a" opacity=".75"/>${layers.buildings ? blocks : ''}${roads}${layers.ues ? ueDots : ''}${sites}</svg><div class="map-bottom"><span>● SITES <b>${project.sites.length}</b></span><span>⌁ SECTORS <b>${project.sites.length * 3}</b></span><span>◦ UE MARKERS <b>${layers.ues ? 88 : 0} SAMPLE</b></span><span class="map-note">Illustration only; not RT output</span></div></div>`, badge('OSM TARGET SOURCE'));
}
function selectedSitePanel() { const s = currentSite(); return panel('Selected site','Choose a marker on the map', `<div class="inspector-body ran-inspector"><div class="inspector-icon">⌁</div><h2>${escapeHtml(s.name)}</h2><p class="subtitle">${s.id} · ${s.frontEnd === 'MMU' ? 'Virtual MMU' : 'Virtual antenna'} + O-RAN RU</p><div class="data-row"><span>Site height</span><strong>${s.heightM} m</strong></div><div class="data-row"><span>Sectors</span><strong>${s.cells.map(c=>c.azimuthDeg + '°').join(' / ')}</strong></div><div class="data-row"><span>RU / RF mode</span><strong>Virtual RU → ${s.frontEnd}</strong></div><div class="data-row"><span>Map position</span><strong>${s.x}%, ${s.y}%</strong></div><div class="data-row"><span>Backhaul target</span><strong>Real vDU · unverified</strong></div><button class="button primary full" data-go="planner">Configure site & cells →</button></div>`, badge(s.id)); }
function layersControls() { return `<div class="layer-controls">${Object.entries({buildings:'Buildings',sectors:'Sector beams',ues:'UE sample'}).map(([id,label]) => `<label><input type="checkbox" data-layer="${id}" ${layers[id] ? 'checked' : ''}/> ${label}</label>`).join('')}</div>`; }
function scenarioControls() { return `<div class="scenario-content"><div class="scenario-presets">${Object.entries(scenarios).map(([id,label]) => `<button class="scenario-chip ${project.scenario === id ? 'active' : ''}" data-scenario="${id}">${label}</button>`).join('')}</div><p class="scenario-description">Changing a preset updates illustrative indicators only. It does not run a channel solver.</p><div class="range-label"><label for="blockage">Blockage assumption</label><strong>${project.channel.blockage}%</strong></div><input type="range" id="blockage" min="0" max="80" step="1" value="${project.channel.blockage}"/><div class="range-scale"><span>Open</span><span>Urban canyon</span><span>Dense obstruction</span></div><div class="form-grid small-gap">${field('Virtual UE count','ue.count',project.ue.count,'number','min="1" max="50000"')}${field('Max trace depth','channel.maxDepth',project.channel.maxDepth,'number','min="1" max="12"')}</div></div>`; }
function eventsPanel(limit = 5) { return panel('Recent activity','Local configuration actions only', `<div class="event-list">${events.slice(0,limit).map(e => `<div class="event-item"><span class="event-bullet warn"></span><div><strong>${escapeHtml(e.title)}</strong><small>${escapeHtml(e.detail)}</small></div><span class="event-time">${e.when.toLocaleTimeString([], { hour:'2-digit',minute:'2-digit' })}</span></div>`).join('')}</div>`, `<button class="button outline" data-go="activity">View all →</button>`); }
function launchpad() {
  const first=project.tasks[0];
  return `<section class="ops-launchpad" aria-label="Planning next actions"><div class="ops-launch-heading"><div><small>WORKFLOW STARTER</small><h2>Move from concept to a verifiable twin</h2><p>Four connected planning steps. Every state below remains offline until a real integration supplies evidence.</p></div>${badge('NO LIVE JOBS','warn')}</div><div class="ops-launch-grid">
    <button data-go="map" class="ops-launch-step"><span class="ops-step-no">01 / SCENE</span><strong>Prepare the city map</strong><small>Set scope, sites and cell layout. Geometry validation is still pending.</small><em>Open map →</em></button>
    <button data-go="tasks" class="ops-launch-step"><span class="ops-step-no">02 / PLAN</span><strong>Review ${project.tasks.length} planned tasks</strong><small>Next: ${escapeHtml(first.title)} · due ${first.dueDate}. Sequence dependencies.</small><em>Open board →</em></button>
    <button data-go="hardware" class="ops-launch-step"><span class="ops-step-no">03 / RESOURCES</span><strong>Define GH200 targets</strong><small>H200, Grace CPU and fronthaul have not been discovered.</small><em>Open inventory →</em></button>
    <button data-go="monitoring" class="ops-launch-step"><span class="ops-step-no">04 / OBSERVE</span><strong>Prepare monitoring</strong><small>Thresholds are configurable. No collector or telemetry is connected.</small><em>Open signals →</em></button>
  </div></section>`;
}
function overview() { const p = simulatePreview(project); return header('5G RAN twin mission control','Prepare a city-scale radio scene, virtualize the RAN edge, and inspect the site/cell design.') + banner() + metrics(p) + launchpad() + `<div class="main-grid">${gridMap()}${readinessPanel()}</div>${panel('Operational use cases','Distinct planning workflows for drive tests, paired releases, and AI-RAN datasets',useCaseCards(),badge('3 WORKFLOWS'))}<div class="lower-grid">${architectureStrip()}${selectedSitePanel()}</div><div class="lower-grid">${panel('Quick scenarios','Illustrative planning controls',scenarioControls())}${eventsPanel()}</div>`; }
function mapView() { return header('City / cluster map','Define the geographic work area and inspect schematic sites before importing real scene geometry.') + banner() + `<div class="map-layout">${gridMap()}${selectedSitePanel()}</div><div class="lower-grid">${panel('Map scope','Plan the eventual georeferenced scene', `<div class="form-grid pad">${field('City / location','map.city',project.map.city)}${field('Cluster name','map.cluster',project.map.cluster)}${field('Center latitude','map.latitude',project.map.latitude,'number','step="0.0001"')}${field('Center longitude','map.longitude',project.map.longitude,'number','step="0.0001"')}${field('Area radius (m)','map.radiusMeters',project.map.radiusMeters,'number','min="100" max="20000"')}${field('OSM / scene reference','map.sceneFile',project.map.sceneFile,'text','placeholder="Select a local scene file" readonly')}</div><div class="pad pad-top"><label class="button outline file-label">⌁ Choose scene reference<input id="scene-file" type="file" accept=".xml,.json,.glb,.gltf,.blend" hidden/></label><p class="muted">Stores filename only. This browser prototype does not import OSM, triangulate geometry, assign materials, or run ray tracing.</p></div>`)}${panel('Map layers','Toggle the schematic rendering', layersControls() + `<div class="detail-copy">Site coordinates above define the future city/cluster target. Geometry on this canvas is invented demo artwork, not OSM data or a georeferenced RF scene.</div>`)}</div>`; }
function stackView() { return header('Physical-to-virtual RAN stack','Trace what is real, what is virtualized, and where the radio channel model belongs.') + banner() + architectureStrip() + `<div class="lower-grid">${panel('Real network integration','Configuration metadata; no authentication or live connection', `<div class="form-grid pad">${field('vCore endpoint label','integration.vCoreEndpoint',project.integration.vCoreEndpoint,'text','placeholder="Unconfigured"')}${field('vDU endpoint label','integration.vDUEndpoint',project.integration.vDUEndpoint,'text','placeholder="Unconfigured"')}</div><div class="detail-copy">Do not enter credentials. This mockup stores labels locally but never contacts these endpoints. The intended handoff is real vCore → real vDU → virtual O-RAN RU.</div>`, badge('NOT CONNECTED','warn'))}${panel('GH200 compute placement','Target deployment allocation', `<div class="hardware-grid"><div><span>HOST</span><strong>GH200</strong><small>Target superchip platform</small></div><div><span>GPU</span><strong>H200</strong><small>Sionna-RT channel / RF rendering target</small></div><div><span>CPU</span><strong>Grace</strong><small>Software-based virtual UE workload</small></div></div><div class="detail-copy">Hardware discovery, job scheduling, RU execution and UE orchestration are not implemented in the browser prototype.</div>`, badge('PLANNED','warn'))}</div>`; }
function sitePlanner() { const s = currentSite(), c = currentCell(); return header('Site & cell planner','Configure virtual RU front ends and three-sector cells for the selected site.', `<button class="button outline" data-go="map">⌖ See city map</button>`) + `<div class="main-grid">${gridMap()}${panel('Site configuration','Changes persist in this browser', `<div class="form-grid pad">${siteField('Site name','name',s.name)}${siteField('Height (m)','heightM',s.heightM,'number','min="1" max="300"')}<label class="form-field"><span>Virtual RF front end</span><select class="select" data-site="${s.id}" data-prop="frontEnd"><option ${s.frontEnd === 'Antenna'?'selected':''}>Antenna</option><option ${s.frontEnd === 'MMU'?'selected':''}>MMU</option></select></label>${siteField('Map X (%)','x',s.x,'number','min="0" max="100"')}${siteField('Map Y (%)','y',s.y,'number','min="0" max="100"')}</div><div class="detail-copy">Each site represents a virtual O-RAN RU connected to a virtual antenna or MMU. The upstream vDU remains a real network element.</div>`, badge(s.id))}</div><div class="lower-grid">${panel('Cell / sector parameters', 'Select a sector, then tune the virtual radio', `<div class="cell-tabs">${s.cells.map(cell => `<button class="scenario-chip ${c.id === cell.id?'active':''}" data-cell-select="${cell.id}">${cell.id} · ${cell.azimuthDeg}°</button>`).join('')}</div><div class="form-grid pad">${cellField('Azimuth (°)','azimuthDeg',c.azimuthDeg,'min="0" max="359"')}${cellField('Downtilt (°)','downtiltDeg',c.downtiltDeg,'min="0" max="30"')}${cellField('Tx power (dBm)','txPowerDbm',c.txPowerDbm,'min="0" max="60"')}${cellField('Bandwidth (MHz)','bandwidthMhz',c.bandwidthMhz,'min="5" max="400"')}</div><div class="detail-copy">Pattern: ${escapeHtml(c.antenna)} · RF calibration is pending.</div>`)}${panel('Add a planned site','A new site starts with three virtual cells', `<form id="add-site-form" class="pad form-grid"><label class="form-field"><span>Site name</span><input name="name" placeholder="e.g. North Tower" required maxlength="60"/></label><label class="form-field"><span>Map X (%)</span><input name="x" type="number" value="43" min="0" max="100" required/></label><label class="form-field"><span>Map Y (%)</span><input name="y" type="number" value="49" min="0" max="100" required/></label><button class="button primary">+ Add site</button></form><div class="detail-copy">Coordinates are canvas percentages until a real scene is imported and georeferenced.</div>`)}</div>`; }
function rayView() { const p = simulatePreview(project); return header('Ray-tracing lab','Set up Sionna-RT job inputs; inspect only an illustrative proxy until the real engine is integrated.') + banner() + `<div class="lower-grid">${panel('Channel job configuration','Engine target: Sionna-RT on H200', `${scenarioControls()}<div class="pad"><label class="checkline"><input type="checkbox" data-channel="reflections" ${project.channel.reflections?'checked':''}/> Reflections</label><label class="checkline"><input type="checkbox" data-channel="diffraction" ${project.channel.diffraction?'checked':''}/> Diffraction</label><p class="muted">Future job: OSM → geometry/materials → site/cell arrays → TX/RX positions → Sionna-RT paths/radio map. Scene preparation and execution are not wired.</p></div>`, badge('CONFIG ONLY','warn'))}${panel('Illustrative outcome','Not a path solver, radio map, or measured KPI', `<div class="proxy-card"><div class="proxy-ring" style="--percent:${p.coveragePercent}%"><strong>${p.coveragePercent}%</strong><span>proxy</span></div><div><h3>Coverage planning index</h3><p>Simple deterministic UI formula using sites, Tx power, downtilt and blockage. Not RSRP, SINR, or ray-traced coverage.</p></div></div><div class="data-row"><span>Capacity pressure proxy</span><strong>${p.capacityPressure}%</strong></div><div class="data-row"><span>SINR proxy (synthetic)</span><strong>${p.avgSinrProxy} dB</strong></div><div class="data-row"><span>RT job state</span><strong class="warning">NOT EXECUTED</strong></div><div class="pad"><button class="button primary" id="preview-btn">↻ Recalculate illustrative preview</button></div>`,badge('SYNTHETIC','warn'))}</div><div style="margin-top:16px">${readinessPanel()}</div>`; }
function ueView() { const count = project.ue.count; return header('Virtual UE fleet','Design a CPU-based software UE population on the GH200 Grace CPU.') + banner() + `<div class="lower-grid">${panel('UE workload configuration','No UE processes are running in the browser', `<div class="form-grid pad">${field('UE population','ue.count',count,'number','min="1" max="50000"')}<label class="form-field"><span>Mobility profile</span><select class="select" data-field="ue.mobility">${['Urban pedestrian','Static hotspots','Vehicular cluster'].map(x => `<option ${project.ue.mobility===x?'selected':''}>${x}</option>`).join('')}</select></label>${field('Reproducibility seed','ue.seed',project.ue.seed,'number','min="0" max="999999"')}</div><div class="detail-copy">UE entities are virtual software models targeted to Grace CPU. No real or emulated 5G protocol stack is running yet.</div>`,badge('CPU TARGET'))}${panel('Fleet allocation preview','Planning-only distribution by selected sites', `<div class="site-rows">${project.sites.map((s,i) => `<button class="site-row" data-site-select="${s.id}"><span><strong>${escapeHtml(s.name)}</strong><small>${s.id} · 3 sectors</small></span><b>${format.format(Math.floor(count/project.sites.length)+(i<count%project.sites.length?1:0))} UEs</b></button>`).join('')}</div><div class="detail-copy">Even distribution for layout preview. Mobility, association, interference, scheduling and KPI collection require an actual UE/RAN simulation backend.</div>`,badge(`${format.format(count)} PLANNED`))}</div>`; }
function activityView() { return header('Activity & handoff','Review local project edits and export a reproducible preparation manifest.') + banner() + `<div class="lower-grid">${eventsPanel(80)}${panel('Integration handoff','What a production 5G twin still needs', `<div class="detail-copy"><p><b>1.</b> Import and georeference OpenStreetMap-derived geometry; add building/terrain RF materials.</p><p><b>2.</b> Bind site/cell parameters and antenna or MMU patterns to virtual O-RAN RU models.</p><p><b>3.</b> Verify the real vCore / vDU interface and time synchronization.</p><p><b>4.</b> Deploy Sionna-RT on H200 and software virtual UEs on Grace CPU in the target GH200 environment.</p><p><b>5.</b> Ingest verified paths, RSRP/SINR and protocol KPIs into versioned artifacts; only then replace the synthetic preview.</p></div><div class="pad"><button class="button primary" id="handoff-export">⇩ Export planning manifest</button></div>`,badge('NOT IMPLEMENTED','warn'))}</div>`; }
function projectCard(record, activeCount) {
  const current=record.id===workspaceState.activeProjectId, archived=record.status==='archived';
  const updated=new Date(record.updatedAt);
  const updatedLabel=Number.isNaN(updated.valueOf())?'Unknown':updated.toLocaleDateString();
  const lifecycle=archived?'ARCHIVED':current?'CURRENT':'ACTIVE';
  return `<article class="project-card ${archived?'archived':''} ${current?'current':''}"><div class="project-card-top"><div><span class="project-kicker">${archived?'ARCHIVED PROJECT':'TWIN WORKSPACE PROJECT'}</span><h2>${escapeHtml(record.name)}</h2><p>${escapeHtml(record.project.map.city)} · ${escapeHtml(record.project.map.cluster)}</p></div><span class="project-status ${archived?'archived':current?'current':''}">${lifecycle}</span></div><div class="project-facts"><span><b>${record.project.sites.length}</b> planned sites</span><span><b>${record.project.tasks.length}</b> preparation tasks</span><span>Updated ${escapeHtml(updatedLabel)}</span></div><div class="project-card-actions">${archived?`<button class="button outline" data-project-action="restore" data-project-id="${escapeHtml(record.id)}">Restore</button><button class="button danger" data-project-action="delete" data-project-id="${escapeHtml(record.id)}">Delete permanently</button>`:`${current?'<span class="project-current-action">Currently open</span>':`<button class="button primary" data-project-action="open" data-project-id="${escapeHtml(record.id)}">Open project</button>`}<button class="button outline" data-project-action="duplicate" data-project-id="${escapeHtml(record.id)}">Duplicate</button>${activeCount>1?`<button class="button outline" data-project-action="archive" data-project-id="${escapeHtml(record.id)}">Archive</button>`:'<span class="project-action-hint">Keep at least one active project.</span>'}`}<details class="project-rename"><summary>Rename</summary><form data-project-rename="${escapeHtml(record.id)}"><label>Project name<input name="name" value="${escapeHtml(record.name)}" maxlength="80" required/></label><button class="button outline" type="submit">Save name</button></form></details></div>${archived?'<p class="project-archive-note">Archived projects stay saved and can be restored. Delete permanently removes this local project.</p>':''}</article>`;
}
function projectsView() {
  const activeCount=workspaceState.projects.filter(record=>record.status==='active').length;
  const ordered=workspaceState.projects.slice().sort((a,b)=>(a.status===b.status?0:a.status==='active'?-1:1)||b.updatedAt.localeCompare(a.updatedAt));
  return header('Twin Workspace projects','Create and manage independent RAN twin planning projects. Each project keeps its own map, sites, use cases, tasks and management plan.',`<button class="button outline" data-project-action="focus-create">+ New project</button>`)+banner()+`<div class="project-summary"><article><strong>${workspaceState.projects.length}</strong><span>Total projects</span></article><article><strong>${activeCount}</strong><span>Active</span></article><article><strong>${workspaceState.projects.length-activeCount}</strong><span>Archived</span></article><p>All project data is stored locally in this browser. Switching projects never merges or overwrites their plans.</p></div><section class="panel project-create" id="project-create"><div class="panel-header"><div><h2 class="panel-title">Create a project</h2><p class="panel-caption">Start an independent planning workspace with its own default RAN twin configuration.</p></div></div><form id="create-project-form" class="project-create-form"><label>Project name<input name="name" placeholder="e.g. Seoul CBD pilot" maxlength="80" required/></label><label>City / location<input name="city" placeholder="e.g. Seoul" maxlength="80" required/></label><label>Cluster<input name="cluster" placeholder="e.g. Central business district" maxlength="80" required/></label><button class="button primary" type="submit">Create project</button></form></section><div class="project-list-heading"><div><h2>Projects</h2><p>Open, duplicate, rename or archive projects. Archived plans remain recoverable.</p></div></div><div class="project-list">${ordered.map(record=>projectCard(record,activeCount)).join('')}</div>`;
}
function artifactPath(tree, id, parents=[]) {
  if(tree.id===id) return [...parents,tree.name];
  for(const child of tree.children||[]) { const path=artifactPath(child,id,[...parents,tree.name]); if(path) return path; }
  return null;
}
function artifactTreeItem(node) {
  if(node.type==='directory') return `<li class="artifact-tree-directory"><details data-artifact-folder="${escapeHtml(node.id)}" ${closedArtifactFolders.has(node.id)?'':'open'}><summary><span class="artifact-folder-icon" aria-hidden="true">▱</span>${escapeHtml(node.name)}</summary><ul>${node.children.length?node.children.map(artifactTreeItem).join(''):'<li class="artifact-empty">No files in this folder.</li>'}</ul></details></li>`;
  return `<li><button type="button" class="artifact-tree-file ${selectedArtifactId===node.id?'selected':''}" data-artifact-select="${escapeHtml(node.id)}" ${selectedArtifactId===node.id?'aria-current="page"':''}><span class="artifact-file-icon" aria-hidden="true">${node.mimeType==='application/json'?'{}':'≡'}</span><span>${escapeHtml(node.name)}<small>${escapeHtml(node.description)}</small></span></button></li>`;
}
function artifactsView() {
  const record=workspaceState.projects.find(item=>item.id===workspaceState.activeProjectId);
  const tree=buildArtifactTree(project,record.activity||[]), files=listArtifactFiles(tree);
  let selected=findArtifact(tree,selectedArtifactId);
  if(!selected||selected.type!=='file') { selected=files[0]; selectedArtifactId=selected.id; }
  const path=artifactPath(tree,selected.id).join(' / '), typeLabel=selected.mimeType==='application/json'?'JSON FILE':selected.mimeType==='application/x-ndjson'?'JSON LINES':'MARKDOWN FILE';
  return header('Project artifacts',`Browse generated configuration, test-result status, project logs and planning reports for ${escapeHtml(project.name)}.`)+`<div class="artifact-boundary"><span class="artifact-boundary-icon" aria-hidden="true">i</span><p><strong>Project-scoped artifact browser</strong> · Files are derived from this project's saved planning state and browser-local activity. No operating-system directories are written; download an individual file to save a copy. Test results remain empty until a real project run supplies evidence.</p><button class="button outline" data-go="projects">Manage projects →</button></div><div class="artifact-browser"><section class="panel artifact-tree-panel"><div class="panel-header"><div><h2 class="panel-title">Project files</h2><p class="panel-caption">${escapeHtml(project.name)} · ${files.length} files</p></div><span class="mini-pill">LOCAL</span></div><nav class="artifact-tree" aria-label="Project artifact file tree">${artifactTreeItem(tree)}</nav></section><section class="panel artifact-preview"><div class="panel-header artifact-preview-header"><div><span class="artifact-type">${typeLabel}</span><h2 class="panel-title">${escapeHtml(selected.name)}</h2><p class="panel-caption">${escapeHtml(selected.description)}</p></div><button class="button outline" data-artifact-download="${escapeHtml(selected.id)}">Download file</button></div><div class="artifact-file-path" aria-label="File path">${escapeHtml(path)}</div><div class="artifact-file-meta"><span>PROJECT <b>${escapeHtml(project.name)}</b></span><span>SIZE <b>${format.format(new TextEncoder().encode(selected.content).length)} bytes</b></span><span>MODE <b>READ ONLY</b></span></div><pre class="artifact-code"><code>${escapeHtml(selected.content)}</code></pre></section></div>`;
}
function resetProjectContext() {
  stopDrive(); drivePosition=0; driveTab='analysis'; dmTechnology='ALL'; dmMetric='rsrp'; dmTrace=null; dmFilename='';
  selectedSite=project.sites[0].id; selectedCell=project.sites[0].cells[0].id;
  hardwareMode='network'; selectedHardwareNode='GH-POOL-01'; selectedHardwareLink=null; selectedHardwareServer=null; hardwareIsometric=true;
  selectedArtifactId='project-config'; closedArtifactFolders.clear();
  events=workspaceState.projects.find(record=>record.id===workspaceState.activeProjectId).activity.map(entry=>({when:new Date(entry.when),title:entry.title,detail:entry.detail}));
}
function openWorkspaceProject(id) {
  try {
    workspaceState=activateWorkspaceProject(workspaceState,id);
    project=structuredClone(workspaceProject(workspaceState));
    resetProjectContext(); saveWorkspace(); view='overview';
    note('Project opened',`${project.name} · local planning only`);
    render(); content.focus({preventScroll:true}); window.scrollTo(0,0);
  } catch(error) { toast(error.message); }
}
function downloadProjectArtifact(id) {
  const record=workspaceState.projects.find(item=>item.id===workspaceState.activeProjectId);
  const file=findArtifact(buildArtifactTree(project,record.activity||[]),id);
  if(!file||file.type!=='file') return toast('Project artifact is unavailable.');
  const url=URL.createObjectURL(new Blob([file.content],{type:file.mimeType||'text/plain'})), anchor=document.createElement('a');
  anchor.href=url; anchor.download=file.name; anchor.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
  note('Project artifact downloaded',artifactPath(buildArtifactTree(project,record.activity||[]),id).join(' / '));
  render(); toast(`${file.name} downloaded`);
}
function activeDmTrace() { return dmTrace || makeDemoTrace(project,drivePlan(project)); }
function driveWorkspace(h) {
  const tabs=`<div class="dm-tabs" role="tablist" aria-label="Virtual drive test workspaces"><button role="tab" data-drive-tab="analysis" aria-selected="${driveTab==='analysis'}" aria-controls="drive-panel">4G/5G DM analysis</button><button role="tab" data-drive-tab="plan" aria-selected="${driveTab==='plan'}" aria-controls="drive-panel">Route & simulation plan</button></div>`;
  const body=driveTab==='analysis' ? dmView(project,h,activeDmTrace(),{technology:dmTechnology,metric:dmMetric,position:drivePosition,filename:dmFilename,playing:drivePlaying}) : driveView(project,h,drivePosition,drivePlaying,false);
  return h.header('Virtual drive test','Plan a software UE route and inspect 4G/5G drive-measurement-style RF evidence with explicit source provenance.') + h.banner() + tabs + `<div id="drive-panel" role="tabpanel">${body}</div>`;
}
function render() {
  const activeRecord=workspaceState.projects.find(record=>record.id===workspaceState.activeProjectId);
  document.querySelector('#workspace-project-name').textContent=activeRecord.name;
  const projectCount=workspaceState.projects.length;
  document.querySelector('#workspace-project-context').textContent=`${activeRecord.project.map.city} · ${activeRecord.project.map.cluster} · ${projectCount} ${projectCount===1?'project':'projects'}`;
  document.querySelector('#crumb-view').textContent = labels[view];
  document.querySelector('#event-count').textContent = events.length;
  document.querySelector('#foot-counts').textContent = `${project.sites.length} SITES · ${project.sites.length*3} CELLS · ${format.format(project.ue.count)} VIRTUAL UES`;
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active',b.dataset.view === view));
  const helpers = { header, banner, panel, badge, escape: escapeHtml };
  content.innerHTML = ({overview,projects:projectsView,artifacts:artifactsView,map:mapView,stack:stackView,planner:sitePlanner,ray:rayView,ues:ueView,
    drive:()=>driveWorkspace(helpers),ab:()=>abView(project,helpers),data:()=>dataView(project,helpers),
    tasks:()=>tasksView(project,helpers),schedule:()=>scheduleView(project,helpers),hardware:()=>hardwareView(project,helpers,{mode:hardwareMode,selectedNode:selectedHardwareNode,selectedLink:selectedHardwareLink,selectedServer:selectedHardwareServer,isometric:hardwareIsometric}),
    software:()=>softwareView(project,helpers),monitoring:()=>monitoringView(project,helpers),activity:activityView}[view])();
}
function changeProject(mutator, label, detail) {
  let next;
  try { next = structuredClone(project); mutator(next); }
  catch (error) { toast(error.message); render(); return false; }
  const errors = validateProject(next);
  if (errors.length) { toast(errors[0]); render(); return false; }
  project = next; persist(); note(label, detail); render(); return true;
}
function stopDrive() { if (driveTimer) clearInterval(driveTimer); driveTimer = null; drivePlaying = false; }
function setNavGroup(group, open=true) {
  document.querySelectorAll('[data-group-toggle]').forEach(button=>{
    const expanded=open && button.dataset.groupToggle===group;
    button.setAttribute('aria-expanded',String(expanded));
    document.getElementById(button.getAttribute('aria-controls')).hidden=!expanded;
  });
}
function navigate(destination) {
  if (destination !== 'drive') stopDrive();
  const group={overview:'twin',projects:'twin',artifacts:'twin',map:'twin',stack:'twin',planner:'twin',ray:'configuration',ues:'configuration',
    drive:'usecases',ab:'usecases',data:'usecases',tasks:'tasks',schedule:'tasks',hardware:'management',software:'management',monitoring:'management'}[destination];
  if(group) setNavGroup(group);
  view = destination; render(); content.focus({preventScroll:true}); window.scrollTo(0,0);
}
function selectSite(id) { selectedSite = id; selectedCell = currentSite().cells[0].id; render(); }
function download() { const manifest = createManifest(project), blob = new Blob([manifest],{type:'application/json'}), url = URL.createObjectURL(blob), a = document.createElement('a'); a.href=url; a.download='atlas-ran-twin-manifest.json'; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000); note('Manifest exported','Local planning configuration downloaded'); render(); toast('Planning manifest exported'); }
function exportUseCase(type) {
  const plan = { drive:drivePlan, ab:abPlan, data:datasetPlan }[type](project);
  const spec = { schemaVersion:1, mode:'PLANNING_ONLY', useCase:type, city:project.map.city,
    cluster:project.map.cluster, config:project.useCases[type], plan,
    note:'Not executed. No RF measurements, A/B verdict or training samples were generated.' };
  const url=URL.createObjectURL(new Blob([JSON.stringify(spec,null,2)],{type:'application/json'}));
  const a=document.createElement('a'); a.href=url; a.download=`atlas-ran-${type}-plan.json`; a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
  note('Use-case plan exported',type); render(); toast('Planning specification downloaded');
}
function exportDmAnalysis() {
  const trace=activeDmTrace(), stats=analyzeDmTrace(trace.samples,{technology:dmTechnology,metric:dmMetric});
  const {filtered,events,...summary}=stats;
  const report={schemaVersion:1,kind:'4G-5G-DM-ANALYSIS',source:trace.source,
    provenance:trace.source==='synthetic-demo'?'illustrative-not-measured':'imported-unverified',
    filename:dmFilename||null,coordinateMode:trace.coordinateMode,filters:{technology:dmTechnology,metric:dmMetric},
    summary,events:events.map(s=>({sampleIndex:s.index,timeS:s.timeS,technology:s.technology,servingCell:s.servingCell,event:s.event})),
    note:'UI-only analysis. No Sionna-RT execution, verified 4G/5G measurement, or network acceptance verdict is implied.'};
  const url=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
  const a=document.createElement('a');a.href=url;a.download='atlas-ran-dm-analysis.json';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);note('DM analysis exported',trace.source);render();toast('Source-labeled analysis downloaded');
}
function updateDrivePosition() {
  if(view==='drive' && driveTab==='analysis') {
    const stats=analyzeDmTrace(activeDmTrace().samples,{technology:dmTechnology,metric:dmMetric});
    const selected=stats.filtered[Math.min(drivePosition,stats.sampleCount-1)];
    if(!selected) return;
    const slider=document.querySelector('#dm-position'); if(slider) slider.value=drivePosition;
    const label=document.querySelector('#dm-position-label'); if(label) label.textContent=`${drivePosition+1} / ${stats.sampleCount}`;
    document.querySelector('#dm-marker')?.setAttribute('transform',`translate(${selected.x*9} ${selected.y*5.4})`);
    const cursor=document.querySelector('#dm-trend-cursor');
    if(cursor) { const x=42+850*drivePosition/Math.max(1,stats.sampleCount-1); cursor.setAttribute('x1',x);cursor.setAttribute('x2',x); }
    const details=document.querySelector('#dm-selected'); if(details) details.innerHTML=dmSampleDetails(selected,DM_METRICS[dmMetric]);
    document.querySelectorAll('.dm-table tbody tr').forEach(row=>row.classList.toggle('dm-row-selected',row.querySelector('[data-dm-jump]')?.dataset.dmJump===String(selected.index)));
    return;
  }
  const samples=drivePlan(project).samples, pos=samples[Math.min(drivePosition,samples.length-1)];
  document.querySelector('#drive-marker')?.setAttribute('transform',`translate(${pos.x*9} ${pos.y*5.4})`);
  const slider=document.querySelector('#drive-position'); if(slider) slider.value=drivePosition;
  const label=document.querySelector('#drive-position-label'); if(label) label.textContent=`${drivePosition+1} / ${samples.length}`;
  const coords=document.querySelector('#drive-coordinates'); if(coords) coords.textContent=`${pos.x.toFixed(2)}%, ${pos.y.toFixed(2)}%`;
}
function toggleDrive() {
  if (drivePlaying) { stopDrive(); render(); return; }
  drivePlaying=true; render();
  const last=driveTab==='analysis' ? analyzeDmTrace(activeDmTrace().samples,{technology:dmTechnology,metric:dmMetric}).sampleCount-1 : project.useCases.drive.samples-1;
  driveTimer=setInterval(()=>{
    if (drivePosition>=last) { stopDrive(); render(); return; }
    drivePosition+=1; updateDrivePosition();
  },250);
}
function handleProjectAction(action, id) {
  if(action==='focus-create') { document.querySelector('#create-project-form [name="name"]')?.focus(); document.querySelector('#project-create')?.scrollIntoView({behavior:'smooth',block:'center'}); return; }
  if(action==='open') return openWorkspaceProject(id);
  try {
    if(action==='duplicate') {
      workspaceState=duplicateWorkspaceProject(workspaceState,id);
      project=structuredClone(workspaceProject(workspaceState)); resetProjectContext(); saveWorkspace(); view='overview';
      note('Project duplicated',`${project.name} · independent local copy`); render(); toast(`Opened ${project.name}`); return;
    }
    if(action==='archive') {
      const previousId=workspaceState.activeProjectId;
      workspaceState=archiveWorkspaceProject(workspaceState,id);
      if(previousId!==workspaceState.activeProjectId) { project=structuredClone(workspaceProject(workspaceState)); resetProjectContext(); }
      saveWorkspace(); note('Project archived',workspaceState.projects.find(record=>record.id===id).name,id); render(); toast('Project archived; its plan can be restored later.'); return;
    }
    if(action==='restore') {
      workspaceState=restoreArchivedWorkspaceProject(workspaceState,id); saveWorkspace();
      note('Project restored',workspaceState.projects.find(record=>record.id===id).name,id); render(); toast('Project restored to the active workspace.'); return;
    }
    if(action==='delete') {
      const record=workspaceState.projects.find(item=>item.id===id);
      if(!record || !window.confirm(`Permanently delete “${record.name}”? This local project cannot be recovered.`)) return;
      workspaceState=deleteArchivedWorkspaceProject(workspaceState,id); saveWorkspace();
      note('Archived project deleted',record.name); render(); toast('Archived project permanently deleted.'); return;
    }
  } catch(error) { toast(error.message); }
}
function importManifestAsProject(data, filename) {
  const imported=upgradeProject({ ...data, map:data.map, runtime:data.runtime, integration:data.integration, architecture:data.architecture,
    channel:data.channel, ue:data.ue, sites:data.sites, useCases:data.useCaseConfig, tasks:data.tasks, management:data.management,
    name:data.project, scenario:'baseline' });
  const safe=sanitizeProject(imported), errors=validateProject(safe);
  if(errors.length) throw new Error(errors[0]);
  workspaceState=addWorkspaceProject(workspaceState,safe,{name:safe.name,uniqueName:true});
  project=structuredClone(workspaceProject(workspaceState)); resetProjectContext(); saveWorkspace(); view='overview';
  note('Manifest imported as new project',`${project.name} · ${filename}`); render(); toast(`Imported as ${project.name}; existing projects were kept.`);
}

document.addEventListener('click', e => {
  const groupButton=e.target.closest('[data-group-toggle]');
  if(groupButton) return setNavGroup(groupButton.dataset.groupToggle,groupButton.getAttribute('aria-expanded')!=='true');
  const tab=e.target.closest('[data-drive-tab]');
  if(tab) { stopDrive(); driveTab=tab.dataset.driveTab; drivePosition=0; render(); document.querySelector(`[data-drive-tab="${driveTab}"]`)?.focus(); return; }
  const jump=e.target.closest('[data-dm-jump]');
  if(jump) { const rows=analyzeDmTrace(activeDmTrace().samples,{technology:dmTechnology,metric:dmMetric}).filtered; const index=rows.findIndex(s=>s.index===Number(jump.dataset.dmJump)); if(index>=0) {stopDrive();drivePosition=index;render();document.querySelector('#dm-selected')?.scrollIntoView({block:'nearest'});} return; }
  if(e.target.closest('#dm-play')) return toggleDrive();
  if(e.target.closest('#dm-reset')) {stopDrive();dmTrace=null;dmFilename='';drivePosition=0;render();return toast('Synthetic demo trace restored');}
  if(e.target.closest('#dm-export')) return exportDmAnalysis();
  const hardwareTab=e.target.closest('[data-hw-view]');
  if(hardwareTab) {hardwareMode=hardwareTab.dataset.hwView;return render();}
  const hardwareSlot=e.target.closest('[data-hw-slot]');
  if(hardwareSlot) {selectedHardwareServer=hardwareSlot.dataset.hwSlot;selectedHardwareNode=selectedHardwareServer.slice(0,-4);selectedHardwareLink=null;hardwareMode='racks';return render();}
  const hardwareLink=e.target.closest('[data-hw-link]');
  if(hardwareLink) {selectedHardwareLink=hardwareLink.dataset.hwLink;selectedHardwareServer=null;return render();}
  const hardwareNode=e.target.closest('[data-hw-node]');
  if(hardwareNode) {selectedHardwareNode=hardwareNode.dataset.hwNode;selectedHardwareLink=null;selectedHardwareServer=null;return render();}
  if(e.target.closest('#hw-rotate')) {hardwareIsometric=!hardwareIsometric;return render();}
  const projectAction=e.target.closest('[data-project-action]');
  if(projectAction) return handleProjectAction(projectAction.dataset.projectAction,projectAction.dataset.projectId);
  const artifactSelect=e.target.closest('[data-artifact-select]');
  if(artifactSelect) { selectedArtifactId=artifactSelect.dataset.artifactSelect; return render(); }
  const artifactDownload=e.target.closest('[data-artifact-download]');
  if(artifactDownload) return downloadProjectArtifact(artifactDownload.dataset.artifactDownload);
  const nav=e.target.closest('[data-view],[data-go]'); if(nav) return navigate(nav.dataset.view || nav.dataset.go);
  const site=e.target.closest('[data-site-select]'); if(site) return selectSite(site.dataset.siteSelect);
  const cell=e.target.closest('[data-cell-select]'); if(cell) { selectedCell=cell.dataset.cellSelect; return render(); }
  const scenario=e.target.closest('[data-scenario]'); if(scenario) { project=applyScenario(project,scenario.dataset.scenario); persist(); note('Scenario selected',scenarios[project.scenario]); render(); return toast('Illustrative proxy updated — no RT job ran'); }
  if(e.target.closest('#export-btn,#handoff-export')) return download();
  const ucExport=e.target.closest('[data-export-usecase]'); if(ucExport) return exportUseCase(ucExport.dataset.exportUsecase);
  if(e.target.closest('#drive-play')) return toggleDrive();
  if(e.target.closest('#import-btn')) return document.querySelector('#manifest-file').click();
  if(e.target.closest('#preview-btn')) { note('Illustrative preview recalculated','No Sionna-RT job was executed'); render(); return toast('Synthetic preview recalculated'); }
});
document.addEventListener('toggle',e=>{
  const folder=e.target.closest('[data-artifact-folder]');
  if(folder) { if(folder.open) closedArtifactFolders.delete(folder.dataset.artifactFolder); else closedArtifactFolders.add(folder.dataset.artifactFolder); }
},true);
document.addEventListener('submit', e => {
  if(e.target.id==='create-project-form') {
    e.preventDefault(); const data=new FormData(e.target), name=String(data.get('name')||'').trim();
    try {
      const next=defaultProject(); next.name=name; next.map.city=String(data.get('city')||'').trim(); next.map.cluster=String(data.get('cluster')||'').trim();
      workspaceState=addWorkspaceProject(workspaceState,next,{name}); project=structuredClone(workspaceProject(workspaceState));
      resetProjectContext(); saveWorkspace(); view='overview'; note('Project created',`${name} · ${next.map.city} / ${next.map.cluster}`);
      render(); content.focus({preventScroll:true}); toast(`Created ${name}`);
    } catch(error) { toast(error.message); }
    return;
  }
  if(e.target.matches('[data-project-rename]')) {
    e.preventDefault(); const id=e.target.dataset.projectRename, data=new FormData(e.target);
    try {
      workspaceState=renameWorkspaceProject(workspaceState,id,data.get('name'));
      if(id===workspaceState.activeProjectId) project=structuredClone(workspaceProject(workspaceState));
      saveWorkspace(); const name=workspaceState.projects.find(record=>record.id===id).name;
      note('Project renamed',name,id); render(); toast(`Renamed to ${name}`);
    } catch(error) { toast(error.message); }
    return;
  }
  if(e.target.id==='add-task-form') {
    e.preventDefault(); const data=new FormData(e.target);
    return changeProject(p=>{p.tasks=addPlannedTask(p.tasks,{title:data.get('title'),dueDate:data.get('dueDate'),priority:data.get('priority'),dependsOn:data.get('dependency')?[data.get('dependency')]:[]});},'Task added to plan',data.get('title'));
  }
  if(e.target.id !== 'add-site-form') return;
  e.preventDefault(); const data=new FormData(e.target);
  try { const next=addSite(project,{name:data.get('name'),x:Number(data.get('x')),y:Number(data.get('y'))}); if(validateProject(next).length) throw new Error(validateProject(next)[0]); project=next; selectedSite=next.sites.at(-1).id; selectedCell=next.sites.at(-1).cells[0].id; persist(); note('Site created',next.sites.at(-1).name); render(); toast('Planned site added'); }
  catch(err) { toast(err.message); }
});
document.addEventListener('change', async e => {
  const el=e.target;
  if(el.id==='dm-csv' && el.files?.[0]) {
    try {
      const file=el.files[0];
      if(file.size>1_000_000) throw new Error('DM CSV must be smaller than 1 MB');
      const parsed=parseDmCsv(await file.text());
      stopDrive();dmTrace=parsed;dmFilename=file.name;dmTechnology='ALL';dmMetric='rsrp';drivePosition=0;
      note('DM trace imported',`${file.name} · ${parsed.samples.length} unverified rows`);render();toast('CSV analyzed locally · source unverified');
    } catch(error) { el.value='';toast(`DM import rejected: ${error.message}`); }
    return;
  }
  if(el.id==='dm-technology') {stopDrive();dmTechnology=el.value;drivePosition=0;render();return;}
  if(el.id==='dm-metric') {stopDrive();dmMetric=el.value;render();return;}
  if(el.id==='dm-position') {stopDrive();drivePosition=Number(el.value);render();return;}
  if(el.id==='manifest-file' && el.files?.[0]) { try { importManifestAsProject(JSON.parse(await el.files[0].text()),el.files[0].name); } catch(err) { toast('Import rejected: '+err.message); } finally { el.value=''; } return; }
  if(el.id==='drive-position') { drivePosition=Number(el.value); updateDrivePosition(); return; }
  if(el.dataset.taskDate) return changeProject(p=>{p.tasks=rescheduleTask(p.tasks,el.dataset.taskDate,el.value);},'Task date changed',`${el.dataset.taskDate} → ${el.value}`);
  if(el.dataset.hwAlias) return changeProject(p=>{p.management.hardware.find(x=>x.id===el.dataset.hwAlias).alias=el.value.trim();},'Hardware target renamed',el.dataset.hwAlias);
  if(el.dataset.poolAlias) return changeProject(p=>{p.management.topology.gh200Pools.find(x=>x.id===el.dataset.poolAlias).alias=el.value.trim();},'GH200 pool renamed',el.dataset.poolAlias);
  if(el.dataset.poolCount) return changeProject(p=>{p.management.topology.gh200Pools.find(x=>x.id===el.dataset.poolCount).plannedServers=Number(el.value);},'GH200 pool capacity planned',el.dataset.poolCount);
  if(el.dataset.hwCount) return changeProject(p=>{p.management.topology[el.dataset.hwCount==='vdu'?'vduServerCount':'switchPortCount']=el.value===''?null:Number(el.value);},'Physical capacity target changed',el.dataset.hwCount);
  if(el.dataset.swVersion) return changeProject(p=>{p.management.software.find(x=>x.id===el.dataset.swVersion).targetVersion=el.value.trim();},'Software target version changed',el.dataset.swVersion);
  if(el.dataset.monitorThreshold) return changeProject(p=>{p.management.monitoring.thresholds[el.dataset.monitorThreshold]=Number(el.value);},'Monitoring threshold changed',el.dataset.monitorThreshold);
  if(el.dataset.ucField) {
    const path=el.dataset.ucField.split('.');
    const value=el.type==='number' ? Number(el.value) : el.value.trim();
    if(path[0]==='drive') { stopDrive(); drivePosition=0; }
    return changeProject(p=>{
      if(path[1]==='seeds') {
        const values=value.split(',').map(s=>s.trim());
        if(!values.every(s=>/^\d+$/.test(s))) throw new Error('Seeds must be comma-separated nonnegative integers');
        p.useCases[path[0]].seeds=values.map(Number);
      } else if(path[1]==='split') {
        p.useCases.data.split[path[2]]=value;
        const split=p.useCases.data.split;
        if(path[2]==='train') split.test=100-split.train-split.validation;
        else if(path[2]==='validation') split.test=100-split.train-split.validation;
        else split.train=100-split.validation-split.test;
      } else p.useCases[path[0]][path[1]]=value;
    },'Use-case setting changed',el.dataset.ucField);
  }
  if(el.id==='scene-file' && el.files?.[0]) return changeProject(p=>{p.map.sceneFile=el.files[0].name;p.map.geometryValidated=false;p.map.coordinateAligned=false;p.map.materialAssigned=false;},'Scene reference selected',el.files[0].name);
  if(el.dataset.layer) { layers[el.dataset.layer]=el.checked; return render(); }
  if(el.dataset.channel) return changeProject(p=>{p.channel[el.dataset.channel]=el.checked;},'Channel flag changed',el.dataset.channel);
  if(el.id==='blockage') return changeProject(p=>{p.channel.blockage=Number(el.value);p.scenario='custom';},'Blockage changed',el.value+'%');
  if(el.dataset.field) { const [group,key]=el.dataset.field.split('.'); const value=el.type==='number'?Number(el.value):el.value; return changeProject(p=>{p[group][key]=value;if(group==='integration')p.integration.connected=false;if(group==='map' && key==='sceneFile')p.map.geometryValidated=false;},'Project setting changed',`${el.dataset.field}: ${value}`); }
  if(el.dataset.site) { const value=el.type==='number'?Number(el.value):el.value; return changeProject(p=>{p.sites.find(s=>s.id===el.dataset.site)[el.dataset.prop]=value;},'Site setting changed',`${el.dataset.site} · ${el.dataset.prop}`); }
  if(el.dataset.cell) { const value=Number(el.value); return changeProject(p=>{p.sites.flatMap(s=>s.cells).find(c=>c.id===el.dataset.cell)[el.dataset.prop]=value;},'Cell setting changed',`${el.dataset.cell} · ${el.dataset.prop}`); }
});
document.addEventListener('input',e=>{
  if(e.target.id==='dm-position') {stopDrive();drivePosition=Number(e.target.value);updateDrivePosition();}
  if(e.target.id==='drive-position') { drivePosition=Number(e.target.value); updateDrivePosition(); }
  if(e.target.id==='blockage') { const value=e.target.parentElement.querySelector('.range-label strong'); value.textContent=e.target.value+'%'; }
});
document.addEventListener('keydown',e=>{
  if(e.key!=='Enter'&&e.key!==' ') return;
  if(e.target.matches('svg [data-site-select]')) {e.preventDefault();selectSite(e.target.dataset.siteSelect);}
  if(e.target.matches('svg [data-hw-node], svg [data-hw-link]')) {e.preventDefault();e.target.dispatchEvent(new MouseEvent('click',{bubbles:true}));}
});
render();
