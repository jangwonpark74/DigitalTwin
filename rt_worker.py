"""Run one bounded Sionna-RT path job in an isolated process.

The server passes validated, local WGS84 scene data through stdin. This module
keeps the Sionna dependency optional so the planning UI still starts without it.
"""

import json
import math
import sys
import tempfile
import hashlib
import platform
from importlib.metadata import version
from pathlib import Path
from study_run import PATH_SOLVER_PROFILE

METERS_PER_DEGREE = 111_320.0


def local_xy(map_scope, latitude, longitude):
    east = (longitude - map_scope["longitude"]) * METERS_PER_DEGREE * math.cos(math.radians(map_scope["latitude"]))
    north = (latitude - map_scope["latitude"]) * METERS_PER_DEGREE
    return east, north


def geographic_point(map_scope, xyz):
    east, north, height = (float(value) for value in xyz)
    return {
        "latitude": map_scope["latitude"] + north / METERS_PER_DEGREE,
        "longitude": map_scope["longitude"] + east / (METERS_PER_DEGREE * math.cos(math.radians(map_scope["latitude"]))),
        "heightM": max(0.0, height),
    }


def _cross(a, b, c):
    return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])


def _inside_triangle(point, a, b, c):
    signs = (_cross(a, b, point), _cross(b, c, point), _cross(c, a, point))
    return min(signs) >= -1e-8 or max(signs) <= 1e-8


def _segments_intersect(a, b, c, d):
    def on_segment(start, end, point):
        return min(start[0], end[0]) <= point[0] <= max(start[0], end[0]) and min(start[1], end[1]) <= point[1] <= max(start[1], end[1])

    ab_c, ab_d = _cross(a, b, c), _cross(a, b, d)
    cd_a, cd_b = _cross(c, d, a), _cross(c, d, b)
    return ((ab_c == 0 and on_segment(a, b, c)) or (ab_d == 0 and on_segment(a, b, d)) or
            (cd_a == 0 and on_segment(c, d, a)) or (cd_b == 0 and on_segment(c, d, b)) or
            ((ab_c > 0) != (ab_d > 0) and (cd_a > 0) != (cd_b > 0)))


def triangulate(ring):
    """Ear clip a simple polygon; reject self-intersections or degenerate rings."""
    for i in range(len(ring)):
        if ring[i] == ring[(i + 1) % len(ring)]:
            raise ValueError("Footprint has a repeated edge position")
        for j in range(i + 2, len(ring)):
            if i == 0 and j == len(ring) - 1:
                continue
            if _segments_intersect(ring[i], ring[(i + 1) % len(ring)], ring[j], ring[(j + 1) % len(ring)]):
                raise ValueError("Footprint is self-intersecting")
    area = sum(ring[i][0] * ring[(i + 1) % len(ring)][1] - ring[(i + 1) % len(ring)][0] * ring[i][1] for i in range(len(ring)))
    if abs(area) < 1e-6:
        raise ValueError("Footprint has zero area")
    remaining = list(range(len(ring))) if area > 0 else list(reversed(range(len(ring))))
    faces = []
    while len(remaining) > 3:
        for index in range(len(remaining)):
            a, b, c = (remaining[(index + offset) % len(remaining)] for offset in (-1, 0, 1))
            if _cross(ring[a], ring[b], ring[c]) <= 1e-8:
                continue
            if any(_inside_triangle(ring[other], ring[a], ring[b], ring[c]) for other in remaining if other not in (a, b, c)):
                continue
            faces.append((a, b, c))
            remaining.pop(index)
            break
        else:
            raise ValueError("Footprint is self-intersecting or cannot be triangulated")
    faces.append(tuple(remaining))
    return faces


def footprint_obj(map_scope, footprint):
    ring = [local_xy(map_scope, latitude, longitude) for longitude, latitude in footprint["ring"]]
    triangles = triangulate(ring)
    count = len(ring)
    vertices = [(east, north, 0.0) for east, north in ring] + [(east, north, footprint["heightM"]) for east, north in ring]
    lines = [f"v {east:.6f} {north:.6f} {height:.6f}" for east, north, height in vertices]
    for a, b, c in triangles:
        lines.append(f"f {c + 1} {b + 1} {a + 1}")
        lines.append(f"f {a + count + 1} {b + count + 1} {c + count + 1}")
    for i in range(count):
        j = (i + 1) % count
        lines.extend((f"f {i + 1} {j + 1} {j + count + 1}", f"f {i + 1} {j + count + 1} {i + count + 1}"))
    return "\n".join(lines) + "\n"


def validate_job(job):
    if not isinstance(job, dict):
        raise ValueError("Job body must be an object")
    scope, scene = job.get("map"), job.get("scene")
    if "siteId" in job and (not isinstance(job["siteId"], str) or not 1 <= len(job["siteId"]) <= 80):
        raise ValueError("Invalid siteId")
    if not isinstance(scope, dict) or not isinstance(scene, dict) or scene.get("coordinateSystem") != "EPSG:4326":
        raise ValueError("Load a WGS84 GeoJSON scene before running Sionna-RT")
    for key, low, high in (("latitude", -85, 85), ("longitude", -180, 180), ("radiusMeters", 100, 20000)):
        value = scope.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"Invalid map {key}")
    footprints = scene.get("footprints")
    if not isinstance(footprints, list) or not 1 <= len(footprints) <= 100:
        raise ValueError("Sionna-RT jobs require 1–100 footprints")
    for footprint in footprints:
        if not isinstance(footprint, dict) or not isinstance(footprint.get("ring"), list) or not 3 <= len(footprint["ring"]) <= 64:
            raise ValueError("Invalid footprint ring")
        height = footprint.get("heightM")
        if isinstance(height, bool) or not isinstance(height, (int, float)) or not math.isfinite(height) or not 1 <= height <= 500:
            raise ValueError("Invalid footprint height")
        local_ring = []
        for position in footprint["ring"]:
            if not isinstance(position, list) or len(position) < 2 or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in position[:2]) or not -180 <= position[0] <= 180 or not -90 <= position[1] <= 90:
                raise ValueError("Invalid WGS84 footprint position")
            east, north = local_xy(scope, position[1], position[0])
            if max(abs(east), abs(north)) > scope["radiusMeters"]:
                raise ValueError("Footprint is outside the map scope")
            local_ring.append((east, north))
        triangulate(local_ring)
    for label in ("transmitter", "receiver"):
        point = job.get(label)
        if not isinstance(point, dict):
            raise ValueError(f"Configure a {label} coordinate")
        for key, low, high in (("latitude", -90, 90), ("longitude", -180, 180), ("heightM", 0, 300)):
            value = point.get(key)
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"Invalid {label} {key}")
        east, north = local_xy(scope, point["latitude"], point["longitude"])
        if max(abs(east), abs(north)) > scope["radiusMeters"]:
            raise ValueError(f"{label.capitalize()} is outside the map scope")
    for key, low, high in (("frequencyGhz", 0.5, 100), ("samplesPerSrc", 1000, 200000), ("maxDepth", 0, 4)):
        value = job.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high or (key != "frequencyGhz" and not isinstance(value, int)):
            raise ValueError(f"Invalid {key}; expected {low}–{high}")
    for flag in ("reflections", "diffraction"):
        if not isinstance(job.get(flag), bool):
            raise ValueError(f"Invalid {flag} setting")
    return job


def run_sionna(job):
    try:
        import numpy as np
        from sionna.rt import ITURadioMaterial, PathSolver, PlanarArray, Receiver, SceneObject, Transmitter, load_scene
    except ImportError as exc:
        raise RuntimeError("Sionna-RT is unavailable in the configured Python environment") from exc

    scope = job["map"]
    with tempfile.TemporaryDirectory(prefix="atlas-rt-") as temp_dir:
        scene = load_scene()
        scene.frequency = job["frequencyGhz"] * 1e9
        building_material = ITURadioMaterial(name="atlas-concrete", itu_type="concrete", thickness=0.2)
        objects = []
        for index, footprint in enumerate(job["scene"]["footprints"]):
            mesh = Path(temp_dir) / f"building-{index:03d}.obj"
            mesh.write_text(footprint_obj(scope, footprint), encoding="ascii")
            objects.append(SceneObject(fname=str(mesh), name=f"building-{index:03d}", radio_material=building_material))
        radius = scope["radiusMeters"]
        ground = Path(temp_dir) / "ground.obj"
        ground.write_text(f"v {-radius} {-radius} 0\nv {radius} {-radius} 0\nv {radius} {radius} 0\nv {-radius} {radius} 0\nf 1 2 3\nf 1 3 4\n", encoding="ascii")
        objects.append(SceneObject(fname=str(ground), name="ground", radio_material=ITURadioMaterial(name="atlas-ground", itu_type="concrete", thickness=0.1)))
        scene.edit(add=objects)
        scene.tx_array = PlanarArray(num_rows=1, num_cols=1, pattern="iso", polarization="V")
        scene.rx_array = PlanarArray(num_rows=1, num_cols=1, pattern="iso", polarization="V")
        tx = job["transmitter"]
        rx = job["receiver"]
        scene.add(Transmitter(name="selected-site", position=[*local_xy(scope, tx["latitude"], tx["longitude"]), tx["heightM"]]))
        scene.add(Receiver(name="receiver", position=[*local_xy(scope, rx["latitude"], rx["longitude"]), rx["heightM"]]))
        solver = PathSolver(deterministic=True)
        paths = solver(scene, max_depth=job["maxDepth"], samples_per_src=job["samplesPerSrc"],
                       max_num_paths_per_src=PATH_SOLVER_PROFILE["maxPathsPerSource"], synthetic_array=PATH_SOLVER_PROFILE["syntheticArray"], los=PATH_SOLVER_PROFILE["los"],
                       specular_reflection=job["reflections"], diffuse_reflection=PATH_SOLVER_PROFILE["diffuseReflection"],
                       refraction=PATH_SOLVER_PROFILE["refraction"], diffraction=job["diffraction"], seed=PATH_SOLVER_PROFILE["seed"])
        def link_values(tensor):
            values = np.asarray(tensor.numpy())
            return values[(0,) * (values.ndim - 1) + (slice(None),)]

        valid = link_values(paths.valid)
        real = link_values(paths.a[0])
        imag = link_values(paths.a[1])
        interactions = np.asarray(paths.interactions.numpy())
        interactions = interactions[(slice(None),) + (0,) * (interactions.ndim - 2) + (slice(None),)]
        vertices = np.asarray(paths.vertices.numpy())
        vertices = vertices[(slice(None),) + (0,) * (vertices.ndim - 3) + (slice(None), slice(None))]
        results = []
        for index, active in enumerate(valid):
            if not active:
                continue
            gain = float(real[index] ** 2 + imag[index] ** 2)
            if gain <= 0 or not math.isfinite(gain):
                continue
            loss = -10 * math.log10(gain)
            if not math.isfinite(loss) or not -100 <= loss <= 400:
                continue
            points = [tx]
            for depth in range(interactions.shape[0]):
                if interactions[depth, index] != 0:
                    points.append(geographic_point(scope, vertices[depth, index]))
            points.append(rx)
            results.append({"id": f"sionna-path-{index + 1}", "pathLossDb": round(loss, 3), "points": points})
        results.sort(key=lambda item: item["pathLossDb"])
        return {"schemaVersion": 1, "kind": "ray-paths", "coordinateSystem": "EPSG:4326",
                "solver": f"Sionna-RT {version('sionna-rt')}",
                "provenance": "sionna-rt-local", "paths": results[:PATH_SOLVER_PROFILE["retainedPaths"]], "totalPaths": len(results),
                "executionEnvironment": {"engine": "sionna-rt", "engineVersion": version('sionna-rt'),
                                         "pythonVersion": platform.python_version(), "platform": platform.system(), "machine": platform.machine()},
                "assumptions": "Concrete buildings/ground, isotropic single-element antennas, no refraction; uncalibrated geometry",
                "sceneSha256": hashlib.sha256(json.dumps(job["scene"], sort_keys=True, separators=(",", ":")).encode()).hexdigest(),
                "job": {"frequencyGhz": job["frequencyGhz"], "samplesPerSrc": job["samplesPerSrc"],
                        "maxDepth": job["maxDepth"], "reflections": job["reflections"],
                        "diffraction": job["diffraction"], "siteId": job.get("siteId", "selected-site"),
                        "transmitter": tx, "receiver": rx,
                        "footprints": len(job["scene"]["footprints"])}}


def main():
    try:
        job = validate_job(json.load(sys.stdin))
        print(json.dumps(run_sionna(job), allow_nan=False))
    except Exception as exc:  # The parent server reports a bounded failure without a traceback.
        print(str(exc)[:500], file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
