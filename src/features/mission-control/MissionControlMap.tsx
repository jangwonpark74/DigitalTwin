import { useState, type MouseEvent as ReactMouseEvent, type FormEvent } from 'react';
import type { buildMissionMapModel } from './missionMapModel';
import './mission-control.css';

export type MapLayers = { buildings: boolean; sectors: boolean; ues: boolean };
type LayerId = keyof MapLayers;
const defaultLayers: MapLayers = { buildings: true, sectors: true, ues: true };
type Props = { model: ReturnType<typeof buildMissionMapModel>;
  onSelect: (siteId: string) => void;
  onNavigate: (route: 'site-position' | 'planner') => void;
  placement?: { siteId: string; onPlace: (position: { x: number; y: number }) => void;
    onCancel: () => void; saving?: boolean };
  layers?: MapLayers;
  onToggleLayer?: (layer: LayerId, visible: boolean) => void;
  showInspector?: boolean };

type ReadyMap = Extract<Props['model'], { kind: 'ready' }>;
type Marker = ReadyMap['markers'][number];
function sectorPath(marker: Marker, cell: Marker['cells'][number]) {
  const a = (cell.azimuthDeg - 48) * Math.PI / 180;
  const b = (cell.azimuthDeg + 48) * Math.PI / 180;
  const radius = 92 + (cell.txPowerDbm - 43) * 2;
  return `M${marker.x} ${marker.y} L${marker.x + radius * Math.sin(a)} ${marker.y - radius * Math.cos(a)} ` +
    `A${radius} ${radius} 0 0 1 ${marker.x + radius * Math.sin(b)} ${marker.y - radius * Math.cos(b)} Z`;
}

/** Transient selection belongs to the parent; this map never persists or calculates radio outcomes. */
export default function MissionControlMap({ model, onSelect, onNavigate, placement, layers = defaultLayers,
  onToggleLayer, showInspector = true }: Props) {
  const [placementX, setPlacementX] = useState('50');
  const [placementY, setPlacementY] = useState('50');
  if (model.kind === 'empty') return <p role="status">No active project is available.</p>;
  if (model.kind === 'invalid') return <p role="alert">Project map unavailable · {model.reason}</p>;
  const visible = model.markers.filter(marker => marker.visible);
  const submitPlacement = (event: FormEvent) => {
    event.preventDefault();
    const x = Number(placementX), y = Number(placementY);
    if (!placement || placement.saving || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 100 || y < 0 || y > 100) return;
    placement.onPlace({ x, y });
  };
  const clickMap = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (!placement || placement.saving) return;
    const target = event.target;
    if (target instanceof Element && target.closest('[data-site-marker]')) return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = Math.max(0, Math.min(100, (event.clientX - rect.left) / rect.width * 100));
    const y = Math.max(0, Math.min(100, (event.clientY - rect.top) / rect.height * 100));
    placement.onPlace({ x, y });
  };
  return <div className={`mission-control-map-layout${showInspector ? '' : ' map-only'}`}>
    <section className="mission-control-map-panel" aria-label="City and cluster radio environment">
      <header><div><h2>City / cluster radio environment</h2><p>{model.map.caption}</p></div>
        <span>{model.map.source}</span></header>
      <div className="mission-control-map-stage">
        <div className="mission-control-map-overlays">◇ {model.map.city} / {model.map.cluster} · {model.map.kind === 'footprints' ? 'GEOJSON FOOTPRINTS' : 'SCHEMATIC'}</div>
        {placement && <form className="mission-control-map-placement" aria-label={`Radio map placement for ${placement.siteId}`}
          onSubmit={submitPlacement}>
          <div><strong>Place {placement.siteId} radio</strong>
            <p>Schematic position converts to a map estimate. Verify coordinates before deployment.</p></div>
          <label>Map X position (%)
            <input type="number" min="0" max="100" step="0.1" required disabled={placement.saving} value={placementX}
              onChange={event => setPlacementX(event.target.value)} />
          </label>
          <label>Map Y position (%)
            <input type="number" min="0" max="100" step="0.1" required disabled={placement.saving} value={placementY}
              onChange={event => setPlacementY(event.target.value)} />
          </label>
          <button type="submit" disabled={placement.saving}>Place radio at these coordinates</button>
          <button type="button" disabled={placement.saving} onClick={placement.onCancel}>Cancel map placement</button>
          <p>Or select a point on the map with a pointer. Keyboard users can enter X and Y percentages.</p>
        </form>}
        <svg viewBox="0 0 900 540" role="group"
          aria-label={`${model.map.kind === 'footprints' ? 'Loaded GeoJSON footprint map' : 'Schematic city map'} with selectable 5G sites${placement ? `; click the schematic map to place ${placement.siteId}` : ''}`}
          onClick={clickMap}>
          <rect width="900" height="540" fill="#142333" />
          {model.map.kind === 'footprints'
            ? <g>{layers.buildings && model.footprints.map(footprint => <polygon key={footprint.id} points={footprint.points}
              fill="#366571" stroke="#84b6bd" strokeWidth="1"><title>{footprint.label}</title></polygon>)}</g>
            : <g><path d="M0 478 Q180 408 330 477 T680 463 T900 500 L900 540 L0 540Z" fill="#21475a" opacity=".75" />
              {layers.buildings && Array.from({ length: 58 }, (_, i) => {
                const x = 28 + (i * 137) % 836, y = 20 + (i * 83 + Math.floor(i / 7) * 77) % 485;
                return <rect key={i} data-demo-building="" x={x} y={y} width={25 + (i * 11) % 40} height={16 + (i * 17) % 36}
                  rx="2" fill={i % 7 === 0 ? '#334652' : '#263a4a'} stroke="#52728055" />;
              })}
              <g stroke="#7595a030" strokeWidth="18" fill="none">
                <path d="M0 105 L900 210"/><path d="M0 395 L900 340"/><path d="M155 0 L260 540"/><path d="M560 0 L440 540"/><path d="M865 0 L700 540"/>
              </g>
            </g>}
          {layers.ues && Array.from({ length: 88 }, (_, i) => <circle key={i} data-ue-sample="" cx={20 + (i * 149 + i * i * 3) % 860}
            cy={20 + (i * 91 + i * i * 7) % 490} r="2.4" fill="#8dcbef" opacity=".65" />)}
          {visible.map(marker => <g key={marker.id} data-site-marker={marker.id} role="button" tabIndex={0}
            aria-label={`Select ${marker.name} site on map`} aria-pressed={marker.selected}
            className={marker.selected ? 'mission-control-site selected' : 'mission-control-site'}
            onClick={event => { event.stopPropagation(); onSelect(marker.id); }}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault(); onSelect(marker.id);
            } }}>
            {layers.sectors && marker.cells.map((cell, index) => <path key={index} data-sector="" d={sectorPath(marker, cell)}
              fill={marker.selected ? '#46dabb2c' : '#57a9c319'}
              stroke={marker.selected ? '#6be2c588' : '#60a2bd66'} />)}
            <circle cx={marker.x} cy={marker.y} r={marker.selected ? 21 : 17} fill="#0f3039"
              stroke={marker.selected ? '#74ecd6' : '#6ab3bd'} strokeWidth="3" />
            <text x={marker.x} y={marker.y + 5}>⌁</text>
            <text x={marker.x} y={marker.y + 39}>{marker.name}</text>
            <text x={marker.x} y={marker.y + 53}>{marker.id} · {marker.cells.length} CELLS</text>
          </g>)}
        </svg>
        <p className="mission-control-map-note">● SITES {model.markers.length} · ⌁ SECTORS {model.markers.reduce((total, marker) => total + marker.cells.length, 0)} · ◦ UE MARKERS {layers.ues ? 88 : 0} SAMPLE · {model.map.note}</p>
      </div>
      {onToggleLayer && <fieldset className="mission-control-map-layers">
        <legend>Map layers</legend>
        {([['buildings', 'Buildings'], ['sectors', 'Sector beams'], ['ues', 'UE sample']] as const).map(([id, label]) =>
          <label key={id}><input type="checkbox" checked={layers[id]}
            onChange={event => onToggleLayer(id, event.target.checked)} />{label}</label>)}
        <p>{model.map.kind === 'footprints'
          ? 'Footprint geometry is loaded from your file. Sector beams and UE markers remain illustrative.'
          : 'The 2D city blocks and roads are invented demo artwork. Load GeoJSON to replace them with real footprint coordinates.'}</p>
      </fieldset>}
      <div className="mission-control-site-list" role="group" aria-label="Site list">
        {model.markers.map(marker => <button type="button" key={marker.id} aria-pressed={marker.selected}
          aria-label={`${marker.name} in site list`} onClick={() => onSelect(marker.id)}>
          {marker.name} · {marker.id}{!marker.visible && <small> · Outside visible map</small>}
        </button>)}
      </div>
    </section>
    {showInspector && <MissionControlSiteInspector model={model} onNavigate={onNavigate} />}
  </div>;
}

export function MissionControlSiteInspector({ model, onNavigate }: { model: ReadyMap; onNavigate: Props['onNavigate'] }) {
  return <section className="mission-control-site-inspector" role="region" aria-label="Selected site">
    <h2>Selected site</h2><p>Choose a marker on the map or a site in the list.</p>
    <h3>{model.selectedSite.name}</h3>
    <p>{model.selectedSite.id} · {model.selectedSite.frontEnd} + O-RAN RU</p>
    <dl>
      <div><dt>Site height</dt><dd>{model.selectedSite.height}</dd></div>
      <div><dt>Sectors</dt><dd>{model.selectedSite.sectors}</dd></div>
      <div><dt>RU / RF mode</dt><dd>{model.selectedSite.radioMode}</dd></div>
      <div><dt>Map position</dt><dd>{model.selectedSite.mapPosition}</dd></div>
      <div><dt>Radio coordinates</dt><dd>{model.selectedSite.coordinates}</dd></div>
      <div><dt>Backhaul target</dt><dd>{model.selectedSite.backhaul}</dd></div>
    </dl>
    <button type="button" onClick={() => onNavigate('site-position')}>Configure radio location →</button>
    <button type="button" onClick={() => onNavigate('planner')}>Configure site &amp; cells →</button>
  </section>;
}
