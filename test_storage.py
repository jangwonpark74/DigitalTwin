"""Database and HTTP list API regression tests."""

import http.client
import json
import tempfile
import threading
import unittest
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
from unittest.mock import patch

from serve import JobManager, LocalDevRequestHandler, ROOT
from storage import ProjectStore, StoreConflict
from test_rt_worker import JOB


def workspace(name="Pilot", project_id="pilot"):
    task = {"id": "TASK-01", "title": "Prepare scene", "dueDate": "2026-10-01", "status": "planned"}
    return {"schemaVersion": 1, "activeProjectId": project_id, "projects": [{
        "id": project_id, "name": name, "status": "active",
        "createdAt": "2026-09-30T00:00:00Z", "updatedAt": "2026-09-30T00:00:00Z",
        "activity": [{"when": "2026-09-30T00:00:00Z", "title": "Created", "detail": name}],
        "project": {"schemaVersion": 1, "name": name, "tasks": [task]},
    }]}


def artifacts(project_id="pilot"):
    return {project_id: [{"id": "project-config", "path": "Pilot/configuration/project.json",
                         "name": "project.json", "mimeType": "application/json", "description": "Configuration",
                         "content": '{"schemaVersion":1}'}]}


class ProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "atlas.sqlite3"
        self.store = ProjectStore(self.path)

    def tearDown(self):
        self.temp.cleanup()

    def test_projects_tasks_artifacts_survive_reopen_and_list(self):
        self.assertEqual(self.store.load_workspace(), {"revision": 0, "workspace": None})
        revision = self.store.save_workspace(workspace(), artifacts(), 0)
        self.assertEqual(revision, 1)
        reopened = ProjectStore(self.path)
        state = reopened.load_workspace()
        self.assertEqual(state["workspace"]["projects"][0]["project"]["tasks"][0]["title"], "Prepare scene")
        self.assertEqual(reopened.list_projects()[0]["artifactCount"], 1)
        self.assertEqual(reopened.list_tasks("pilot")[0]["id"], "TASK-01")
        self.assertEqual(reopened.list_artifacts("pilot")[0]["id"], "project-config")
        self.assertEqual(reopened.get_artifact("pilot", "project-config")["content"], '{"schemaVersion":1}')

    def test_revision_conflict_and_failed_validation_do_not_replace_data(self):
        self.store.save_workspace(workspace(), artifacts(), 0)
        changed = workspace("Changed")
        with self.assertRaises(StoreConflict):
            self.store.save_workspace(changed, artifacts(), 0)
        with self.assertRaisesRegex(ValueError, "artifact list"):
            self.store.save_workspace(changed, {}, 1)
        self.assertEqual(self.store.load_workspace()["workspace"]["projects"][0]["name"], "Pilot")

    def test_run_history_is_server_owned_and_survives_restart(self):
        self.store.save_workspace(workspace(), artifacts(), 0)
        self.store.create_run("run-1", "pilot", "sionna-rt", JOB)
        self.store.update_run("run-1", "complete", result={"totalPaths": 2, "paths": []})
        self.store.create_run("run-2", "pilot", "sionna-rt", JOB)
        self.store.update_run("run-2", "failed", error="worker failed")
        reopened = ProjectStore(self.path)
        self.assertEqual(reopened.count_runs("pilot"), 2)
        self.assertEqual(reopened.list_runs("pilot", limit=1, offset=1)[0]["totalPaths"], 2)
        self.assertEqual(reopened.get_run("run-1")["result"]["totalPaths"], 2)
        self.assertEqual(reopened.list_projects()[0]["runCount"], 2)


class ProjectApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        store = ProjectStore(Path(self.temp.name) / "api.sqlite3")

        class Handler(LocalDevRequestHandler):
            pass

        Handler.store = store
        Handler.job_manager = JobManager(runner=lambda _payload: {"schemaVersion": 1, "kind": "ray-paths",
            "coordinateSystem": "EPSG:4326", "paths": [], "totalPaths": 0}, store=store)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), partial(Handler, directory=str(ROOT)))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port, timeout=3)

    def tearDown(self):
        self.connection.close()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp.cleanup()

    def request(self, method, path, value=None, headers=None):
        body = json.dumps(value) if value is not None else None
        request_headers = {"Content-Type": "application/json", **(headers or {})}
        self.connection.request(method, path, body=body, headers=request_headers)
        response = self.connection.getresponse()
        return response.status, json.loads(response.read())

    def test_workspace_and_lists_can_be_retrieved_over_http(self):
        status, data = self.request("GET", "/api/workspace")
        self.assertEqual((status, data["revision"]), (200, 0))
        status, data = self.request("PUT", "/api/workspace", {"revision": 0, "workspace": workspace(), "artifacts": artifacts()})
        self.assertEqual((status, data["revision"]), (200, 1))
        for path, key in (("/api/projects", "projects"), ("/api/projects/pilot/tasks", "tasks"),
                          ("/api/projects/pilot/artifacts", "artifacts"), ("/api/projects/pilot/runs", "runs")):
            status, data = self.request("GET", path)
            self.assertEqual(status, 200)
            self.assertIn(key, data)
        status, data = self.request("GET", "/api/projects/pilot/artifacts/project-config")
        self.assertEqual(data["content"], '{"schemaVersion":1}')
        status, data = self.request("GET", "/api/projects/pilot/artifacts?content=1")
        self.assertEqual(data["artifacts"][0]["content"], '{"schemaVersion":1}')
        status, data = self.request("PUT", "/api/workspace", {"revision": 0, "workspace": workspace(), "artifacts": artifacts()})
        self.assertEqual(status, 409)

    def test_rt_result_is_listed_and_static_database_file_is_private(self):
        self.request("PUT", "/api/workspace", {"revision": 0, "workspace": workspace(), "artifacts": artifacts()})
        with patch("serve.sionna_available", return_value=True):
            status, data = self.request("POST", "/api/rt/jobs", {**JOB, "projectId": "pilot"})
        self.assertEqual(status, 202)
        run_id = data["id"]
        for _ in range(30):
            status, job = self.request("GET", f"/api/rt/jobs/{run_id}")
            if job["status"] == "complete":
                break
            threading.Event().wait(0.01)
        self.assertEqual(job["status"], "complete")
        status, data = self.request("GET", "/api/projects/pilot/runs")
        self.assertEqual(data["runs"][0]["id"], run_id)
        status, data = self.request("GET", f"/api/runs/{run_id}")
        self.assertEqual(data["result"]["totalPaths"], 0)
        self.connection.request("GET", "/state/atlas-ran-twin.sqlite3")
        response = self.connection.getresponse()
        response.read()
        self.assertEqual(response.status, 404)

    def test_local_origin_boundary_applies_to_database_writes(self):
        status, _ = self.request("PUT", "/api/workspace",
                                 {"revision": 0, "workspace": workspace(), "artifacts": artifacts()},
                                 {"Origin": "https://example.com"})
        self.assertEqual(status, 403)


if __name__ == "__main__":
    unittest.main()
