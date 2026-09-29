"""Optional real Sionna-RT smoke test; run with make test-rt after installing it."""

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent
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
        python = os.environ.get("SIONNA_RT_PYTHON", sys.executable)
        result = subprocess.run(
            [python, str(ROOT / "rt_worker.py")], input=json.dumps(JOB), text=True,
            capture_output=True, timeout=180, cwd=ROOT, check=False,
        )
        self.assertEqual(result.returncode, 0, result.stderr[-500:])
        rays = json.loads(result.stdout)
        self.assertTrue(rays["solver"].startswith("Sionna-RT "))
        self.assertEqual(rays["coordinateSystem"], "EPSG:4326")
        self.assertEqual(rays["job"]["siteId"], "SITE-01")
        self.assertEqual(len(rays["sceneSha256"]), 64)
        self.assertTrue(any(len(path["points"]) == 2 for path in rays["paths"]))
        self.assertTrue(any(len(path["points"]) > 2 for path in rays["paths"]))


if __name__ == "__main__":
    unittest.main()
