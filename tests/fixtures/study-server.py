"""Disposable HTTP integration fixture. The worker returns no physical RF prediction."""
import sys
import time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
import serve

def test_worker(job):
    if job.get("samplesPerSrc") == 2000:
        raise RuntimeError("Fixture interrupted worker; not a physical solver run")
    if job.get("samplesPerSrc") == 3000:
        time.sleep(3)  # Test-only latency: cancellation is pending until this returns.
    return {"schemaVersion": 1, "kind": "ray-paths", "coordinateSystem": "EPSG:4326",
            "solver": "Test transport worker - no physical RF validation", "totalPaths": 0, "paths": [],
            "executionEnvironment": {"engine": "test-fixture", "engineVersion": "1", "pythonVersion": "fixture", "platform": "fixture", "machine": "fixture"}}

serve.sionna_available = lambda: True
serve.LocalDevRequestHandler.job_manager = serve.JobManager(runner=test_worker, store=serve.LocalDevRequestHandler.store)
sys.exit(serve.main())
