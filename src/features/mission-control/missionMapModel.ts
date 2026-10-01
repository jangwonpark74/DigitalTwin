import { validateProject } from '../../../model.mjs';
import { geoToLocalMeters } from '../../../scene.mjs';
import type { WorkspaceSnapshot } from '../../api/schemas';

type ProjectRecord = WorkspaceSnapshot['projects'][number];
type MapScope = { city: string; cluster: string; latitude: number; longitude: number; radiusMeters: number;
  scene: { fileName: string; footprints: { id: string; heightM: number; assumedHeight: boolean;
    ring: [number, number][] }[] } | null };
type Site = { id: string; name: string; x: number; y: number; heightM: number; frontEnd: string;
  radio: { manufacturer: string; technology: string };
  radioLocation: { latitude: number | null; longitude: number | null; source: string };
  cells: { azimuthDeg: number; txPowerDbm: number }[] };
type MapModel = { kind: 'empty' } | { kind: 'invalid'; reason: string } | {
  kind: 'ready'; projectId: string;
  map: { kind: 'schematic' | 'footprints'; city: string; cluster: string;
    source: string; caption: string; note: string };
  markers: { id: string; name: string; x: number; y: number; visible: boolean; selected: boolean;
    cells: { azimuthDeg: number; txPowerDbm: number }[] }[];
  footprints: { id: string; label: string; points: string }[];
  selectedSite: { id: string; name: string; frontEnd: string; height: string;
    sectors: string; radioMode: string; mapPosition: string; coordinates: string; backhaul: string };
};

/** Reuses WGS84 conversion and the original 900×540 schematic projection, without modifying project data. */
export function buildMissionMapModel(record: ProjectRecord | null, selectedSiteId?: string): MapModel {
  if (!record) return { kind: 'empty' };
  const errors: string[] = validateProject(record.project);
  if (errors.length) return { kind: 'invalid', reason: errors[0] };
  const project = record.project as { map: MapScope; sites: Site[] };
  const { map, sites } = project;
  const scene = map.scene;
  const selected = sites.find(site => site.id === selectedSiteId) ?? sites[0];
  const projectPoint = (latitude: number, longitude: number) => {
    const { eastM, northM } = geoToLocalMeters(map, latitude, longitude);
    return { x: 450 + eastM / map.radiusMeters * 450, y: 270 - northM / map.radiusMeters * 270 };
  };
  const markers = sites.map(site => {
    const { latitude, longitude } = site.radioLocation;
    const point = Number.isFinite(latitude) && Number.isFinite(longitude)
      ? projectPoint(latitude!, longitude!) : { x: site.x * 9, y: site.y * 5.4 };
    return { id: site.id, name: site.name, ...point,
      visible: point.x >= 0 && point.x <= 900 && point.y >= 0 && point.y <= 540,
      selected: selected.id === site.id, cells: site.cells.map(cell => ({ ...cell })) };
  });
  const location = selected.radioLocation;
  const coordinates = Number.isFinite(location.latitude) && Number.isFinite(location.longitude)
    ? `${location.latitude!.toFixed(5)}, ${location.longitude!.toFixed(5)} · ${location.source === 'map-estimate' ? 'map estimate' : 'manual'}`
    : 'Not set';
  return {
    kind: 'ready', projectId: record.id,
    map: {
      kind: scene ? 'footprints' : 'schematic', city: map.city, cluster: map.cluster,
      source: scene ? 'LOCAL GEOJSON' : 'OSM TARGET SOURCE',
      caption: scene ? `${scene.fileName} · WGS84 EPSG:4326 footprints in local map scope`
        : 'Schematic preview · no imported geometry',
      note: scene ? 'Footprints imported; UE markers and beams illustrative' : 'Illustration only; not RT output',
    },
    markers,
    footprints: (scene?.footprints ?? []).map(footprint => ({
      id: footprint.id,
      label: `${footprint.id} · ${footprint.heightM} m${footprint.assumedHeight ? ' assumed' : ''}`,
      points: footprint.ring.map(([longitude, latitude]) => {
        const point = projectPoint(latitude, longitude);
        return `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
      }).join(' '),
    })),
    selectedSite: { id: selected.id, name: selected.name,
      frontEnd: selected.frontEnd === 'MMU' ? 'Virtual MMU' : 'Virtual antenna',
      height: `${selected.heightM} m`, sectors: selected.cells.map(cell => `${cell.azimuthDeg}°`).join(' / '),
      radioMode: `${selected.radio.manufacturer} · ${selected.radio.technology} → ${selected.frontEnd}`,
      mapPosition: `${selected.x.toFixed(1)}%, ${selected.y.toFixed(1)}%`, coordinates,
      backhaul: 'Real vDU · unverified',
    },
  };
}
