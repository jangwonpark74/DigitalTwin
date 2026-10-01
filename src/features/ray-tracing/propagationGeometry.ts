export type GeoPoint = { latitude: number; longitude: number; heightM: number };
export type BeamSettings = { azimuthDeg: number; downtiltDeg: number; widthDeg: number };
export type Footprint = { id: string; heightM: number; ring: [number, number][] };
export type PreviewPath = { id: string; kind: 'direct' | 'reflection' | 'blocked'; points: GeoPoint[];
  distanceM: number; delayNs: number; inBeam: boolean; buildingId?: string };
type Point = { x: number; y: number; z: number };
type Wall = { a: Point; b: Point; height: number; id: string };
const radians = Math.PI / 180;
const metersPerDegree = 111_195;
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;
const subtract = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

function intersection(a: Point, b: Point, c: Point, d: Point) {
  const r = subtract(b, a), s = subtract(d, c), denominator = cross(r, s);
  if (Math.abs(denominator) < 1e-8) return null;
  const t = cross(subtract(c, a), s) / denominator;
  const u = cross(subtract(c, a), r) / denominator;
  if (t < 1e-5 || t > 1 - 1e-5 || u < 0 || u > 1) return null;
  return { t, point: { x: a.x + t * r.x, y: a.y + t * r.y, z: a.z + t * r.z } };
}
function inside(point: Point, ring: Point[]) {
  let contained = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) contained = !contained;
  }
  return contained;
}
export function aimBeam(tx: GeoPoint, rx: GeoPoint): Omit<BeamSettings, 'widthDeg'> {
  const north = (rx.latitude - tx.latitude) * metersPerDegree;
  const east = (rx.longitude - tx.longitude) * metersPerDegree * Math.cos(tx.latitude * radians);
  return { azimuthDeg: (Math.atan2(east, north) / radians + 360) % 360,
    downtiltDeg: Math.atan2(tx.heightM - rx.heightM, Math.hypot(east, north)) / radians };
}
export function validPoint(point: GeoPoint) {
  return Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 85 &&
    Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180 && Number.isFinite(point.heightM) && point.heightM >= 0 && point.heightM <= 300;
}
export function beamOutline(tx: GeoPoint, beam: BeamSettings, range: number): GeoPoint[][] {
  const end = (azimuth: number, tilt: number) => {
    const horizontal = range * Math.cos(tilt * radians);
    return { latitude: tx.latitude + horizontal * Math.cos(azimuth * radians) / metersPerDegree,
      longitude: tx.longitude + horizontal * Math.sin(azimuth * radians) / (metersPerDegree * Math.cos(tx.latitude * radians)),
      heightM: Math.max(0, tx.heightM - range * Math.sin(tilt * radians)) };
  };
  const corners = [end(beam.azimuthDeg - beam.widthDeg / 2, beam.downtiltDeg - 15),
    end(beam.azimuthDeg + beam.widthDeg / 2, beam.downtiltDeg - 15),
    end(beam.azimuthDeg + beam.widthDeg / 2, beam.downtiltDeg + 15),
    end(beam.azimuthDeg - beam.widthDeg / 2, beam.downtiltDeg + 15)];
  return [...corners.map(point => [tx, point]), [...corners, corners[0]], [tx, end(beam.azimuthDeg, beam.downtiltDeg)]];
}

// Bounded 2.5D image-method preview: direct visibility and one specular bounce
// on vertical imported walls. No material losses, roof bounces or diffraction.
export function tracePreview(tx: GeoPoint, rx: GeoPoint, footprints: Footprint[], beam: BeamSettings): PreviewPath[] {
  if (!validPoint(tx) || !validPoint(rx) || !footprints.length ||
    ![beam.azimuthDeg, beam.downtiltDeg, beam.widthDeg].every(Number.isFinite)) return [];
  const cosine = Math.cos(tx.latitude * radians);
  const local = (point: GeoPoint): Point => ({ x: (point.longitude - tx.longitude) * metersPerDegree * cosine,
    y: (point.latitude - tx.latitude) * metersPerDegree, z: point.heightM });
  const global = (point: Point): GeoPoint => ({ longitude: tx.longitude + point.x / (metersPerDegree * cosine),
    latitude: tx.latitude + point.y / metersPerDegree, heightM: point.z });
  const source = local(tx), receiver = local(rx);
  const walls: Wall[] = [];
  const rings = footprints.map(footprint => ({ id: footprint.id, height: footprint.heightM,
    ring: footprint.ring.map(([longitude, latitude]) => local({ longitude, latitude, heightM: 0 })) }));
  // An indoor terminal cannot have an unobstructed outdoor segment merely
  // because no wall crossing exists before the other terminal.
  if (rings.some(item => (inside(source, item.ring) && source.z < item.height) ||
    (inside(receiver, item.ring) && receiver.z < item.height))) return [];
  for (const item of rings) for (let i = 0; i < item.ring.length; i++)
    walls.push({ a: item.ring[i], b: item.ring[(i + 1) % item.ring.length], height: item.height, id: item.id });
  const blocker = (a: Point, b: Point) => {
    let first: { t: number; point: Point; id: string } | null = null;
    for (const wall of walls) {
      const hit = intersection(a, b, wall.a, wall.b);
      if (hit && hit.point.z >= 0 && hit.point.z < wall.height && (!first || hit.t < first.t)) first = { ...hit, id: wall.id };
    }
    // Also test segment midpoints against volumes to catch near-wall endpoints.
    const midpoint = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 };
    if (!first) for (const item of rings) if (inside(midpoint, item.ring) && midpoint.z < item.height)
      return { t: .5, point: midpoint, id: item.id };
    return first;
  };
  const path = (id: string, kind: PreviewPath['kind'], points: Point[], buildingId?: string): PreviewPath => {
    const distanceM = points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
    const departure = aimBeam(tx, global(points[1]));
    const delta = Math.abs(((departure.azimuthDeg - beam.azimuthDeg + 540) % 360) - 180);
    return { id, kind, points: points.map(global), distanceM, delayNs: distanceM / 299_792_458 * 1e9,
      inBeam: delta <= beam.widthDeg / 2 && Math.abs(departure.downtiltDeg - beam.downtiltDeg) <= 15, buildingId };
  };
  const directHit = blocker(source, receiver);
  const paths = [directHit ? path('preview-blocked', 'blocked', [source, directHit.point], directHit.id)
    : path('preview-los', 'direct', [source, receiver])];
  const candidates = [...walls].sort((a, b) => distance(a.a, source) - distance(b.a, source)).slice(0, 120);
  for (const wall of candidates) {
    const direction = subtract(wall.b, wall.a), lengthSq = direction.x ** 2 + direction.y ** 2;
    if (lengthSq < .0001) continue;
    const sideTx = cross(direction, subtract(source, wall.a)), sideRx = cross(direction, subtract(receiver, wall.a));
    if (sideTx * sideRx <= 0) continue;
    const t = ((source.x - wall.a.x) * direction.x + (source.y - wall.a.y) * direction.y) / lengthSq;
    const image = { x: 2 * (wall.a.x + t * direction.x) - source.x,
      y: 2 * (wall.a.y + t * direction.y) - source.y, z: source.z };
    const hit = intersection(image, receiver, wall.a, wall.b);
    if (!hit || hit.point.z <= 0 || hit.point.z >= wall.height || blocker(source, hit.point) || blocker(hit.point, receiver)) continue;
    if (paths.some(item => item.kind === 'reflection' && distance(local(item.points[1]), hit.point) < .1)) continue;
    paths.push(path(`preview-reflection-${paths.length}`, 'reflection', [source, hit.point, receiver], wall.id));
  }
  return [paths[0], ...paths.slice(1).sort((a, b) => a.distanceM - b.distanceM).slice(0, 12)];
}
