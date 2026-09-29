import { geoToLocalMeters, validateScene } from './scene.mjs';

export function buildRtJob(project, siteId, receiver, { frequencyGhz = 3.5, samplesPerSrc = 10000, maxDepth = 2 } = {}) {
  const map = project?.map, scene = map?.scene;
  if (validateScene(scene).length || !scene) throw new Error('Load valid GeoJSON footprints before running Sionna-RT');
  if (scene.footprints.length > 100) throw new Error('Sionna-RT jobs support at most 100 footprints');
  const site = project.sites.find(item => item.id === siteId);
  const coordinates = site?.radioLocation;
  if (!Number.isFinite(coordinates?.latitude) || !Number.isFinite(coordinates?.longitude)) {
    throw new Error('Set WGS84 coordinates for the selected radio site first');
  }
  const transmitter = { latitude: coordinates.latitude, longitude: coordinates.longitude, heightM: site.heightM };
  const withinScope = point => {
    const local=geoToLocalMeters(map,point.latitude,point.longitude);
    return Math.max(Math.abs(local.eastM),Math.abs(local.northM)) <= map.radiusMeters;
  };
  if (!withinScope(transmitter)) throw new Error('Selected radio site is outside the map scope');
  const rx = { latitude: Number(receiver.latitude), longitude: Number(receiver.longitude), heightM: Number(receiver.heightM) };
  if (!Number.isFinite(rx.latitude) || rx.latitude < -90 || rx.latitude > 90 ||
      !Number.isFinite(rx.longitude) || rx.longitude < -180 || rx.longitude > 180 ||
      !Number.isFinite(rx.heightM) || rx.heightM < 0 || rx.heightM > 300 || !withinScope(rx)) {
    throw new Error('Receiver must have valid WGS84 coordinates and height inside the map scope');
  }
  if (!Number.isFinite(frequencyGhz) || frequencyGhz < .5 || frequencyGhz > 100) throw new Error('Frequency must be 0.5–100 GHz');
  if (!Number.isInteger(samplesPerSrc) || samplesPerSrc < 1000 || samplesPerSrc > 200000) throw new Error('Samples per source must be 1,000–200,000');
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 4) throw new Error('Job depth must be 0–4');
  return {
    map: { latitude: map.latitude, longitude: map.longitude, radiusMeters: map.radiusMeters },
    scene, siteId, transmitter, receiver: rx, frequencyGhz, samplesPerSrc, maxDepth,
    reflections: Boolean(project.channel.reflections), diffraction: Boolean(project.channel.diffraction),
  };
}
