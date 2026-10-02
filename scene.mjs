import { parseRunCaptureHeader } from './run-capture.mjs';
const MAX_FOOTPRINTS = 500;
const MAX_VERTICES = 64;
const MAX_PATHS = 200;
const MAX_PATH_POINTS = 16;

const finite = value => typeof value === 'number' && Number.isFinite(value);
const validLongitude = value => finite(value) && value >= -180 && value <= 180;
const validLatitude = value => finite(value) && value >= -90 && value <= 90;
const cleanLabel = (value, fallback, limit = 120) => {
  const label = String(value ?? fallback).trim();
  if (!label || label.length > limit) throw new Error(`Labels must contain 1–${limit} characters`);
  return label;
};

function footprintHeight(properties = {}) {
  const raw = properties.height ?? properties.height_m;
  if (raw !== undefined && raw !== null && raw !== '') {
    const height = typeof raw === 'string' ? Number(raw.trim().replace(/\s*m$/i, '')) : raw;
    if (!finite(height) || height < 1 || height > 500) throw new Error('Building height must be 1–500 m');
    return { heightM: height, assumed: false };
  }
  const levels = properties['building:levels'] ?? properties.levels;
  if (levels !== undefined && levels !== null && levels !== '') {
    const count = Number(levels);
    if (!finite(count) || count < 1 || count > 160) throw new Error('Building levels must be 1–160');
    return { heightM: count * 3, assumed: true };
  }
  return { heightM: 12, assumed: true };
}

function ringIsSimple(points) {
  const cross = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const onSegment = (a, b, c) => Math.min(a[0], b[0]) <= c[0] && c[0] <= Math.max(a[0], b[0]) &&
    Math.min(a[1], b[1]) <= c[1] && c[1] <= Math.max(a[1], b[1]);
  const intersects = (a, b, c, d) => {
    const abC = cross(a, b, c), abD = cross(a, b, d), cdA = cross(c, d, a), cdB = cross(c, d, b);
    return (abC === 0 && onSegment(a, b, c)) || (abD === 0 && onSegment(a, b, d)) ||
      (cdA === 0 && onSegment(c, d, a)) || (cdB === 0 && onSegment(c, d, b)) ||
      ((abC > 0) !== (abD > 0) && (cdA > 0) !== (cdB > 0));
  };
  let area = 0;
  for (let i = 1; i < points.length - 1; i++) area += cross(points[0], points[i], points[i + 1]);
  if (Math.abs(area) < 1e-14) return false;
  for (let i = 0; i < points.length; i++) {
    if (points[i][0] === points[(i + 1) % points.length][0] && points[i][1] === points[(i + 1) % points.length][1]) return false;
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue;
      if (intersects(points[i], points[(i + 1) % points.length], points[j], points[(j + 1) % points.length])) return false;
    }
  }
  return true;
}

function normalizedRing(ring) {
  if (!Array.isArray(ring) || ring.length < 4 || ring.length > MAX_VERTICES + 1) {
    throw new Error(`Each footprint ring needs 4–${MAX_VERTICES + 1} positions`);
  }
  const points = ring.map(position => {
    if (!Array.isArray(position) || !validLongitude(position[0]) || !validLatitude(position[1])) {
      throw new Error('GeoJSON positions must be WGS84 [longitude, latitude] pairs');
    }
    return [position[0], position[1]];
  });
  if (points[0][0] !== points.at(-1)[0] || points[0][1] !== points.at(-1)[1]) {
    throw new Error('GeoJSON polygon rings must close at their first position');
  }
  points.pop();
  if (new Set(points.map(point => point.join(','))).size < 3) throw new Error('Footprint needs three distinct positions');
  const longitudes = points.map(point => point[0]);
  if (Math.max(...longitudes) - Math.min(...longitudes) > 180) {
    throw new Error('Footprints crossing the antimeridian are not supported in this viewer');
  }
  if (!ringIsSimple(points)) throw new Error('Footprint rings must have nonzero area and no self-intersections');
  return points;
}

export function parseGeoJsonScene(input, { fileName = 'scene.geojson', importedAt = new Date().toISOString() } = {}) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features)) {
    throw new Error('Load a GeoJSON FeatureCollection of building footprints');
  }
  const crs = data.crs?.properties?.name;
  if (data.crs && !['EPSG:4326', 'urn:ogc:def:crs:OGC:1.3:CRS84'].includes(crs)) {
    throw new Error('GeoJSON must use WGS84 longitude/latitude coordinates (EPSG:4326)');
  }
  const footprints = [];
  for (const [featureIndex, feature] of data.features.entries()) {
    const geometry = feature?.geometry;
    if (!['Polygon', 'MultiPolygon'].includes(geometry?.type)) continue;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    if (!Array.isArray(polygons)) throw new Error('Invalid GeoJSON polygon coordinates');
    const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties : {};
    const { heightM, assumed } = footprintHeight(properties);
    for (const [partIndex, polygon] of polygons.entries()) {
      if (!Array.isArray(polygon) || polygon.length !== 1) {
        throw new Error('This 3D viewer supports outer building rings without holes');
      }
      footprints.push({
        id: cleanLabel(feature.id ?? properties.id, `footprint-${featureIndex + 1}-${partIndex + 1}`, 80),
        heightM, assumedHeight: assumed, ring: normalizedRing(polygon[0]),
      });
      if (footprints.length > MAX_FOOTPRINTS) throw new Error(`Scene preview supports at most ${MAX_FOOTPRINTS} footprints`);
    }
  }
  if (!footprints.length) throw new Error('GeoJSON contains no Polygon or MultiPolygon footprints');
  const positions = footprints.flatMap(footprint => footprint.ring);
  const bbox = {
    west: Math.min(...positions.map(point => point[0])), south: Math.min(...positions.map(point => point[1])),
    east: Math.max(...positions.map(point => point[0])), north: Math.max(...positions.map(point => point[1])),
  };
  return {
    schemaVersion: 1, kind: 'geojson-footprints', coordinateSystem: 'EPSG:4326',
    fileName: cleanLabel(fileName, 'scene.geojson'), importedAt: cleanLabel(importedAt, importedAt, 40),
    footprints, bbox, assumedHeightCount: footprints.filter(footprint => footprint.assumedHeight).length,
  };
}

export function validateScene(scene) {
  if (scene === null || scene === undefined) return [];
  if (scene?.schemaVersion !== 1 || scene.kind !== 'geojson-footprints' || scene.coordinateSystem !== 'EPSG:4326' ||
      typeof scene.fileName !== 'string' || !scene.fileName.trim() || scene.fileName.length > 120 ||
      !validLongitude(scene.bbox?.west) || !validLongitude(scene.bbox?.east) ||
      !validLatitude(scene.bbox?.south) || !validLatitude(scene.bbox?.north) ||
      scene.bbox.west > scene.bbox.east || scene.bbox.south > scene.bbox.north ||
      !Number.isInteger(scene.assumedHeightCount) || scene.assumedHeightCount < 0 ||
      !Array.isArray(scene.footprints) || !scene.footprints.length || scene.footprints.length > MAX_FOOTPRINTS) {
    return ['Invalid loaded scene metadata'];
  }
  for (const footprint of scene.footprints) {
    if (!footprint || typeof footprint.id !== 'string' || !footprint.id.trim() || footprint.id.length > 80 ||
        !finite(footprint.heightM) || footprint.heightM < 1 || footprint.heightM > 500 ||
        typeof footprint.assumedHeight !== 'boolean' ||
        !Array.isArray(footprint.ring) || footprint.ring.length < 3 || footprint.ring.length > MAX_VERTICES ||
        footprint.ring.some(point => !Array.isArray(point) || !validLongitude(point[0]) || !validLatitude(point[1])) ||
        !ringIsSimple(footprint.ring)) {
      return ['Invalid loaded scene footprint'];
    }
  }
  return [];
}

function normalizedRayPoint(point) {
  if (!point || !validLatitude(point.latitude) || !validLongitude(point.longitude) ||
      !finite(point.heightM) || point.heightM < 0 || point.heightM > 3000) {
    throw new Error('Ray points need valid latitude, longitude, and heightM (0–3000 m)');
  }
  return { latitude: point.latitude, longitude: point.longitude, heightM: point.heightM };
}

function normalizedJobMetadata(job) {
  if (job === undefined || job === null) return null;
  if (typeof job !== 'object' || Array.isArray(job) ||
      !finite(job.frequencyGhz) || job.frequencyGhz < .5 || job.frequencyGhz > 100 ||
      !Number.isInteger(job.samplesPerSrc) || job.samplesPerSrc < 1000 || job.samplesPerSrc > 200000 ||
      !Number.isInteger(job.maxDepth) || job.maxDepth < 0 || job.maxDepth > 4 ||
      typeof job.reflections !== 'boolean' || typeof job.diffraction !== 'boolean' ||
      !Number.isInteger(job.footprints) || job.footprints < 1 || job.footprints > 100) {
    throw new Error('Invalid Sionna-RT job metadata');
  }
  return {
    frequencyGhz: job.frequencyGhz, samplesPerSrc: job.samplesPerSrc, maxDepth: job.maxDepth,
    reflections: job.reflections, diffraction: job.diffraction, footprints: job.footprints,
    siteId: cleanLabel(job.siteId, 'selected-site', 80),
    transmitter: normalizedRayPoint(job.transmitter), receiver: normalizedRayPoint(job.receiver),
  };
}

export function parseRayPaths(input, { fileName = 'ray-paths.json', importedAt = new Date().toISOString(), provenance = 'imported-unverified' } = {}) {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (data?.schemaVersion !== 1 || data.kind !== 'ray-paths' || data.coordinateSystem !== 'EPSG:4326' ||
      !Array.isArray(data.paths) || !data.paths.length || data.paths.length > MAX_PATHS) {
    throw new Error(`Ray file must contain 1–${MAX_PATHS} WGS84 paths with schemaVersion 1`);
  }
  const paths = data.paths.map((path, index) => {
    if (!Array.isArray(path?.points) || path.points.length < 2 || path.points.length > MAX_PATH_POINTS ||
        !finite(path.pathLossDb) || path.pathLossDb < -100 || path.pathLossDb > 400) {
      throw new Error('Ray paths need 2–16 points and pathLossDb in -100–400 dB');
    }
    return { id: cleanLabel(path.id, `path-${index + 1}`, 80),
      pathLossDb: path.pathLossDb, points: path.points.map(normalizedRayPoint) };
  });
  if (new Set(paths.map(path => path.id)).size !== paths.length) throw new Error('Ray path IDs must be unique');
  if (data.totalPaths !== undefined && (!Number.isInteger(data.totalPaths) || data.totalPaths < paths.length || data.totalPaths > 1_000_000)) {
    throw new Error('Invalid total path count');
  }
  if (data.sceneSha256 != null && !/^[0-9a-f]{64}$/.test(data.sceneSha256)) throw new Error('Invalid scene hash');
  return {
    schemaVersion: 1, kind: 'ray-paths', coordinateSystem: 'EPSG:4326',
    fileName: cleanLabel(fileName, 'ray-paths.json'), importedAt: cleanLabel(importedAt, importedAt, 40),
    runId: cleanLabel(data.runId, 'unspecified-run', 80), solver: cleanLabel(data.solver, 'unspecified-solver', 80),
    provenance: provenance === 'sionna-rt-local' ? provenance : 'imported-unverified', paths,
    totalPaths: data.totalPaths ?? paths.length,
    sceneSha256: data.sceneSha256 ?? null,
    assumptions: data.assumptions == null ? null : cleanLabel(data.assumptions, '', 200),
    job: normalizedJobMetadata(data.job),
    ...(data.runCapture === undefined || data.runCapture === null ? {} : { runCapture: parseRunCaptureHeader(data.runCapture) }),
  };
}

export function validateRayPaths(result) {
  if (result === null || result === undefined) return [];
  try { parseRayPaths(result, { provenance: result.provenance }); return []; }
  catch (error) { return [error.message]; }
}

export function geoToLocalMeters(map, latitude, longitude) {
  if (!validLatitude(map?.latitude) || !validLongitude(map?.longitude) ||
      !validLatitude(latitude) || !validLongitude(longitude)) throw new Error('WGS84 coordinates are required');
  const deltaLongitude = ((longitude - map.longitude + 540) % 360) - 180;
  const metersPerDegree = 111_320;
  return {
    eastM: deltaLongitude * metersPerDegree * Math.cos(map.latitude * Math.PI / 180),
    northM: (latitude - map.latitude) * metersPerDegree,
  };
}

export function sceneFit(map, scene) {
  const latitude = (scene.bbox.south + scene.bbox.north) / 2;
  const longitude = (scene.bbox.west + scene.bbox.east) / 2;
  const center = { ...map, latitude, longitude };
  const corners = [
    [scene.bbox.west, scene.bbox.south], [scene.bbox.west, scene.bbox.north],
    [scene.bbox.east, scene.bbox.south], [scene.bbox.east, scene.bbox.north],
  ];
  const radiusMeters = Math.ceil(Math.max(100, ...corners.flatMap(([lon, lat]) => {
    const point = geoToLocalMeters(center, lat, lon);
    return [Math.abs(point.eastM), Math.abs(point.northM)];
  })) * 1.18);
  if (radiusMeters > 20_000) throw new Error('Loaded scene exceeds the 20 km map radius limit');
  return { latitude, longitude, radiusMeters };
}
