"""Optional real Sionna-RT smoke test; run with make test-rt after installing it."""

import unittest
from serve import JobManager


JOB = {
    "map": {"latitude": 37.56655, "longitude": 126.9779, "radiusMeters": 300},
    "scene": {"coordinateSystem": "EPSG:4326", "footprints": [
        {"id": "demo-office", "heightM": 32, "ring": [[126.9774, 37.5662], [126.9777, 37.5662], [126.9777, 37.5665], [126.9774, 37.5665]]},
        {"id": "demo-residential", "heightM": 18, "ring": [[126.9781, 37.5666], [126.9784, 37.5666], [126.9784, 37.5669], [126.9781, 37.5669]]},
    ]},
    "siteId": "SITE-01",
    "transmitter": {"latitude": 37.5662, "longitude": 126.977, "heightM": 20},
    "receiver": {"latitude": 37.5663, "longitude": 126.9772, "heightM": 1.5},
    "frequencyGhz": 3.5,
    "samplesPerSrc": 1000,
    "maxDepth": 1,
    "reflections": True,
    "diffraction": False,
}


class RealSionnaSmokeTest(unittest.TestCase):
    def test_line_of_sight_and_reflected_path(self):
        # Exercise the production process wrapper, including its bounded polling.
        rays = JobManager._run_worker(JOB)
        self.assertTrue(rays["solver"].startswith("Sionna-RT "))
        self.assertEqual(rays["coordinateSystem"], "EPSG:4326")
        self.assertEqual(rays["job"]["siteId"], "SITE-01")
        self.assertEqual(len(rays["sceneSha256"]), 64)
        self.assertTrue(any(len(path["points"]) == 2 for path in rays["paths"]))
        self.assertTrue(any(len(path["points"]) > 2 for path in rays["paths"]))
        self.assertLessEqual(len(rays["paths"]), 200)
        environment = rays["executionEnvironment"]
        self.assertEqual(environment["engine"], "sionna-rt")
        self.assertIn(environment["engineVersion"], rays["solver"])
        for key in ("pythonVersion", "platform", "machine"):
            self.assertTrue(environment[key])


if __name__ == "__main__":
    unittest.main()
