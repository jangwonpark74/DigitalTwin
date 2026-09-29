"""Deterministic tests for RT geometry conversion and the local job boundary."""

import http.client
import json
import threading
import time
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from unittest.mock import patch

from rt_worker import footprint_obj, geographic_point, local_xy, triangulate, validate_job
from serve import JobManager, LocalDevRequestHandler, ROOT


SCOPE = {"latitude": 37.5665, "longitude": 126.978, "radiusMeters": 1200}
FOOTPRINT = {"id": "building-1", "heightM": 18, "ring": [
    [126.9779, 37.5664], [126.9781, 37.5664], [126.9781, 37.5666], [126.9779, 37.5666],
]}
JOB = {
    "map": SCOPE, "scene": {"coordinateSystem": "EPSG:4326", "footprints": [FOOTPRINT]},
    "transmitter": {"latitude": 37.5665, "longitude": 126.978, "heightM": 28},
    "receiver": {"latitude": 37.5666, "longitude": 126.9781, "heightM": 1.5},
    "frequencyGhz": 3.5, "samplesPerSrc": 10000, "maxDepth": 2,
    "reflections": True, "diffraction": False,
}


class WorkerGeometryTests(unittest.TestCase):
    def test_wgs84_round_trip_and_closed_extrusion(self):
        x, y = local_xy(SCOPE, 37.5666, 126.9781)
        point = geographic_point(SCOPE, (x, y, 1.5))
        self.assertAlmostEqual(point["latitude"], 37.5666)
        self.assertAlmostEqual(point["longitude"], 126.9781)
        mesh = footprint_obj(SCOPE, FOOTPRINT)
        self.assertEqual(sum(line.startswith("v ") for line in mesh.splitlines()), 8)
        self.assertEqual(sum(line.startswith("f ") for line in mesh.splitlines()), 12)

    def test_concave_polygon_triangulates_and_degenerate_ring_fails(self):
        ring = [(0, 0), (3, 0), (3, 3), (1.5, 1), (0, 3)]
        self.assertEqual(len(triangulate(ring)), 3)
        with self.assertRaisesRegex(ValueError, "zero area"):
            triangulate([(0, 0), (1, 1), (2, 2)])
        with self.assertRaisesRegex(ValueError, "self-intersecting"):
            triangulate([(0, 0), (3, 3), (3, 0), (0, 3), (1, 4)])

    def test_job_validation_rejects_bad_coordinates_and_workload(self):
        self.assertIs(validate_job(JOB), JOB)
        bad = json.loads(json.dumps(JOB))
        bad["receiver"]["longitude"] = 200
        with self.assertRaisesRegex(ValueError, "receiver longitude"):
            validate_job(bad)
        bad = json.loads(json.dumps(JOB))
        bad["samplesPerSrc"] = 1_000_000
        with self.assertRaisesRegex(ValueError, "samplesPerSrc"):
            validate_job(bad)


class JobEndpointTests(unittest.TestCase):
    def setUp(self):
        result = {"schemaVersion": 1, "kind": "ray-paths", "coordinateSystem": "EPSG:4326",
                  "solver": "test-solver", "provenance": "sionna-rt-local", "paths": [], "totalPaths": 0}

        class Handler(LocalDevRequestHandler):
            job_manager = JobManager(runner=lambda _payload: result.copy())

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

    def request(self, method, path, body=None, headers=None):
        self.connection.request(method, path, body=body, headers=headers or {})
        response = self.connection.getresponse()
        return response.status, json.loads(response.read())

    def test_capability_is_truthful_without_installed_package(self):
        with patch("serve.sionna_available", return_value=False):
            status, data = self.request("GET", "/api/rt/capability")
            self.assertEqual(status, 200)
            self.assertFalse(data["available"])
            status, data = self.request("POST", "/api/rt/jobs", json.dumps(JOB), {"Content-Type": "application/json"})
            self.assertEqual(status, 503)
            self.assertIn("unavailable", data["error"])

    def test_bounded_job_starts_and_completes_with_run_id(self):
        with patch("serve.sionna_available", return_value=True):
            status, data = self.request("POST", "/api/rt/jobs", json.dumps(JOB), {"Content-Type": "application/json"})
            self.assertEqual(status, 202)
            job_id = data["id"]
            for _ in range(20):
                status, result = self.request("GET", f"/api/rt/jobs/{job_id}")
                if result["status"] == "complete":
                    break
                time.sleep(0.01)
            self.assertEqual(result["status"], "complete")
            self.assertEqual(result["result"]["runId"], job_id)

    def test_cross_origin_and_bad_host_are_rejected(self):
        headers = {"Content-Type": "application/json", "Origin": "https://example.com"}
        status, _ = self.request("POST", "/api/rt/jobs", json.dumps(JOB), headers)
        self.assertEqual(status, 403)
        status, _ = self.request("GET", "/api/rt/capability", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)
        status, _ = self.request("GET", "/api/rt/jobs/unknown", headers={"Host": "evil.example"})
        self.assertEqual(status, 403)
        headers = {"Content-Type": "application/json", "Host": "evil.example"}
        status, _ = self.request("POST", "/api/rt/jobs", json.dumps(JOB), headers)
        self.assertEqual(status, 403)
