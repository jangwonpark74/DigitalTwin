"""Serve this local mockup; reuse an existing server for the same project."""

import argparse
import copy
import errno
import http.client
import importlib.util
import json
import os
import platform
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
from study_run import capture_header, PATH_SOLVER_PROFILE
from urllib.parse import parse_qs, unquote, urlsplit

from rt_worker import validate_job
from storage import ProjectStore, StoreConflict

ROOT = Path(__file__).resolve().parent
FRONTEND_BUILD_ROOT = ROOT / "dist"


def sionna_python():
    return os.environ.get("SIONNA_RT_PYTHON", sys.executable)


def sionna_available():
    python = sionna_python()
    if python == sys.executable:
        return importlib.util.find_spec("sionna") is not None
    try:
        result = subprocess.run([python, "-c", "import importlib.util; print(int(importlib.util.find_spec('sionna') is not None))"],
                                capture_output=True, text=True, timeout=5, check=False)
        return result.returncode == 0 and result.stdout.strip() == "1"
    except (OSError, subprocess.TimeoutExpired):
        return False


class JobCancelled(Exception):
    pass


class JobManager:
    def __init__(self, runner=None, store=None):
        self.lock = threading.Lock()
        self.jobs = {}
        self.active = None
        self.runner = runner
        self.store = store
        self.cancel_events = {}

    def start(self, payload, project_id=None):
        payload = copy.deepcopy(payload)
        validate_job(payload)
        if self.store and not project_id:
            raise ValueError("projectId is required to record a Sionna-RT run")
        with self.lock:
            if self.active is not None:
                raise RuntimeError("A Sionna-RT job is already running")
            job_id = str(uuid.uuid4())
            if self.store:
                self.store.create_run(job_id, project_id, "sionna-rt", payload)
            receipt = self._enqueue(job_id, project_id)
        self._launch(job_id, payload)
        return receipt

    def _enqueue(self, job_id, project_id, retry_of=None):
        record = {"id": job_id, "projectId": project_id, "status": "queued", "createdAt": datetime.now(timezone.utc).isoformat(),
                  "retryOf": retry_of, "cancelRequestedAt": None}
        self.jobs[job_id] = record
        self.cancel_events[job_id] = threading.Event()
        self.active = job_id
        if len(self.jobs) > 10:
            for old_id in list(self.jobs):
                if old_id != job_id and self.jobs[old_id]["status"] in ("complete", "failed", "cancelled", "interrupted"):
                    del self.jobs[old_id]
                    break
        return record.copy()

    def retry(self, parent_id, project_id):
        if not self.store:
            raise ValueError("Exact retry requires server-retained frozen inputs")
        with self.lock:
            if self.active is not None:
                raise RuntimeError("A Sionna-RT job is already running")
            job_id = str(uuid.uuid4())
            payload = self.store.create_retry(job_id, project_id, parent_id)
            receipt = self._enqueue(job_id, project_id, parent_id)
        self._launch(job_id, payload)
        return receipt

    def _launch(self, job_id, payload):
        try:
            threading.Thread(target=self._execute, args=(job_id, payload), daemon=True).start()
        except Exception as exc:
            with self.lock:
                try:
                    self._terminal(job_id, "failed", error=f"Worker launch failed: {exc}"[:500])
                finally:
                    self.active = None
                    self.cancel_events.pop(job_id, None)
            raise RuntimeError(f"Worker launch failed: {exc}"[:500]) from exc

    def cancel(self, job_id, project_id):
        with self.lock:
            record = self.jobs.get(job_id)
            retained = self.store.get_run(job_id) if self.store else record
            if not retained or retained.get("projectId") != project_id:
                raise ValueError("Run is unavailable in this project")
            if retained["status"] == "cancelled":
                return self._job_record(retained)
            if retained["status"] not in ("queued", "running", "cancelling"):
                raise RuntimeError("Only queued or running jobs can be cancelled")
            if job_id != self.active or job_id not in self.cancel_events:
                raise RuntimeError("This server does not own the active worker; refresh run status")
            if retained["status"] != "cancelling":
                if self.store:
                    self.store.update_run(job_id, "cancelling")
                    retained = self.store.get_run(job_id)
                else:
                    retained = {**record, "status": "cancelling", "cancelRequestedAt": datetime.now(timezone.utc).isoformat()}
                record.update(status="cancelling", cancelRequestedAt=retained["cancelRequestedAt"])
            self.cancel_events[job_id].set()
            return record.copy()

    @staticmethod
    def _job_record(run):
        return {key: run[key] for key in ("id", "status", "createdAt", "completedAt", "result", "error", "retryOf", "cancelRequestedAt", "projectId") if key in run}

    def get(self, job_id):
        with self.lock:
            record = self.jobs.get(job_id)
            if record:
                return record.copy()
        run = self.store.get_run(job_id) if self.store else None
        return self._job_record(run) if run else None

    def _terminal(self, job_id, status, result=None, error=None):
        if self.store:
            self.store.update_run(job_id, status, result=result, error=error)
        self.jobs[job_id].update(status=status, result=result, error=error, completedAt=datetime.now(timezone.utc).isoformat())

    def _execute(self, job_id, payload):
        cancel = self.cancel_events[job_id]
        try:
            capture = capture_header(payload["runCapture"]) if payload.get("runCapture") else None
            with self.lock:
                if cancel.is_set():
                    raise JobCancelled()
                if self.store:
                    self.store.update_run(job_id, "running")
                self.jobs[job_id]["status"] = "running"
            result = self.runner(payload) if self.runner else self._run_worker(payload, cancel)
            if capture:
                result["runCapture"] = capture
            result.update({"runId": job_id, "fileName": f"sionna-rt-{job_id}.json",
                           "importedAt": datetime.now(timezone.utc).isoformat()})
            with self.lock:
                if cancel.is_set():
                    raise JobCancelled()
                self._terminal(job_id, "complete", result=result)
        except Exception as exc:
            with self.lock:
                try:
                    retained = self.store.get_run(job_id) if self.store else None
                    if retained and retained["status"] in ("complete", "failed", "cancelled", "interrupted"):
                        self.jobs[job_id].update(self._job_record(retained))
                    else:
                        self._terminal(job_id, "cancelled" if cancel.is_set() or isinstance(exc, JobCancelled) else "failed",
                                       error="Cancelled by user; worker stopped and output discarded" if cancel.is_set() or isinstance(exc, JobCancelled) else str(exc)[:500])
                except (sqlite3.Error, ValueError) as persistence_error:
                    self.jobs[job_id].update(status="failed", error=f"Run persistence failed: {persistence_error}"[:500], completedAt=datetime.now(timezone.utc).isoformat())
        finally:
            with self.lock:
                self.active = None
                self.cancel_events.pop(job_id, None)

    @staticmethod
    def _run_worker(payload, cancel=None):
        cancel = cancel or threading.Event()
        process = subprocess.Popen([sionna_python(), str(ROOT / "rt_worker.py")], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True, cwd=ROOT)
        deadline, first = time.monotonic() + PATH_SOLVER_PROFILE["maxRuntimeSeconds"], True
        try:
            while True:
                if cancel.is_set():
                    process.terminate()
                    try:
                        process.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.communicate(timeout=2)
                    raise JobCancelled()
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise RuntimeError("Sionna-RT job exceeded the 180-second limit")
                try:
                    stdout, stderr = process.communicate(input=json.dumps(payload, allow_nan=False) if first else None, timeout=min(.1, remaining))
                except subprocess.TimeoutExpired:
                    first = False
                    continue
                if cancel.is_set():
                    raise JobCancelled()
                if process.returncode:
                    raise RuntimeError(stderr.strip()[-500:] or "Sionna-RT worker failed")
                return json.loads(stdout)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate(timeout=2)


class LocalDevRequestHandler(SimpleHTTPRequestHandler):
    """Serve fresh local UI assets instead of reusing stale browser modules."""

    store = ProjectStore(Path(os.environ.get("ATLAS_DB_PATH", ROOT / "state" / "atlas-ran-twin.sqlite3")))
    job_manager = JobManager(store=store)

    def translate_path(self, path):
        request_path = unquote(urlsplit(path).path)
        if request_path in ("/", "/index.html", "/frontend-preview.html"):
            relative = PurePosixPath("index.html")
        elif request_path.startswith("/frontend-preview/assets/"):
            relative = PurePosixPath(request_path.lstrip("/"))
        else:
            return super().translate_path(path)
        build_root = FRONTEND_BUILD_ROOT.resolve()
        candidate = (build_root / Path(*relative.parts)).resolve()
        if candidate != build_root and build_root not in candidate.parents:
            return str(build_root / "__invalid_frontend_path__")
        return str(candidate)

    def _json(self, status, payload):
        data = json.dumps(payload, allow_nan=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _allow_local_api_request(self, check_origin=False):
        if self.client_address[0] not in ("127.0.0.1", "::1"):
            self._json(403, {"error": "API requests are local-only"})
            return False
        try:
            host = urlsplit("http://" + self.headers.get("Host", "")).hostname
        except ValueError:
            self._json(403, {"error": "Invalid API host"})
            return False
        if host not in ("127.0.0.1", "localhost", "::1"):
            self._json(403, {"error": "API host must be loopback"})
            return False
        origin = self.headers.get("Origin")
        if check_origin and origin and origin != f"http://{self.headers.get('Host')}":
            self._json(403, {"error": "Cross-origin API requests are not allowed"})
            return False
        return True

    def do_GET(self):
        path = urlsplit(self.path).path
        if path.startswith("/api/") and not self._allow_local_api_request():
            return
        if path == "/api/workspace":
            return self._json(200, self.store.load_workspace())
        if path == "/api/projects":
            return self._json(200, {"projects": self.store.list_projects()})
        parts = [unquote(part) for part in path.strip("/").split("/")]
        if len(parts) >= 4 and parts[:2] == ["api", "projects"]:
            project_id = parts[2]
            if len(parts) == 4 and parts[3] == "tasks":
                tasks = self.store.list_tasks(project_id)
                return self._json(200, {"tasks": tasks}) if tasks is not None else self._json(404, {"error": "Project not found"})
            if len(parts) == 4 and parts[3] == "artifacts":
                include_content = parse_qs(urlsplit(self.path).query).get("content") == ["1"]
                artifacts = self.store.list_artifacts(project_id, include_content=include_content)
                return self._json(200, {"artifacts": artifacts}) if artifacts is not None else self._json(404, {"error": "Project not found"})
            if len(parts) == 5 and parts[3] == "artifacts":
                artifact = self.store.get_artifact(project_id, parts[4])
                return self._json(200, artifact) if artifact else self._json(404, {"error": "Artifact not found"})
            if len(parts) == 4 and parts[3] == "runs":
                query = parse_qs(urlsplit(self.path).query)
                try:
                    limit = int(query.get("limit", ["200"])[0])
                    offset = int(query.get("offset", ["0"])[0])
                except ValueError:
                    return self._json(400, {"error": "Invalid run list pagination"})
                if not 1 <= limit <= 200 or not 0 <= offset <= 1_000_000:
                    return self._json(400, {"error": "Run list limit or offset is out of range"})
                runs = self.store.list_runs(project_id, limit, offset)
                if runs is None:
                    return self._json(404, {"error": "Project not found"})
                total = self.store.count_runs(project_id)
                next_offset = offset + len(runs) if offset + len(runs) < total else None
                return self._json(200, {"runs": runs, "total": total, "nextOffset": next_offset})
        if len(parts) == 3 and parts[:2] == ["api", "runs"]:
            run = self.store.get_run(parts[2])
            return self._json(200, run) if run else self._json(404, {"error": "Run not found"})
        if path == "/api/rt/capability":
            available = sionna_available()
            return self._json(200, {"available": available, "platform": platform.system(),
                                    "runContractVersion": 1,
                                    "jobActions": ["cancel", "retry"],
                                    "message": "Sionna-RT Python environment detected" if available else
                                    "Sionna-RT is not installed in the configured Python environment"})
        if path.startswith("/api/rt/jobs/"):
            record = self.job_manager.get(path.removeprefix("/api/rt/jobs/"))
            return self._json(200, record) if record else self._json(404, {"error": "Unknown job"})
        if path.startswith("/api/"):
            return self._json(404, {"error": "Unknown endpoint"})
        return super().do_GET()

    def _read_json(self, limit):
        if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
            self._json(415, {"error": "Expected application/json"})
            return None
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= limit:
            self._json(413, {"error": f"JSON payload must be under {limit // 1_000_000} MB"})
            return None
        try:
            value = json.loads(self.rfile.read(length))
            if value is None:
                self._json(400, {"error": "JSON body must be an object"})
                return None
            return value
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            self._json(400, {"error": f"Invalid JSON: {exc}"})
            return None

    def do_PUT(self):
        if urlsplit(self.path).path != "/api/workspace":
            return self._json(404, {"error": "Unknown endpoint"})
        if not self._allow_local_api_request(check_origin=True):
            return
        body = self._read_json(30_000_000)
        if body is None:
            return
        try:
            if not isinstance(body, dict):
                raise ValueError("Workspace request must be an object")
            revision = self.store.save_workspace(body.get("workspace"), body.get("artifacts"), body.get("revision"))
        except StoreConflict as exc:
            return self._json(409, {"error": str(exc)})
        except (ValueError, TypeError, OverflowError) as exc:
            return self._json(400, {"error": str(exc)})
        return self._json(200, {"revision": revision})

    def do_POST(self):
        path = urlsplit(self.path).path
        parts = [unquote(part) for part in path.strip("/").split("/")]
        action = parts[4] if len(parts) == 5 and parts[:3] == ["api", "rt", "jobs"] and parts[4] in ("cancel", "retry") else None
        if path != "/api/rt/jobs" and action is None:
            return self._json(404, {"error": "Unknown endpoint"})
        if not self._allow_local_api_request(check_origin=True):
            return
        payload = self._read_json(2_000_000)
        if payload is None:
            return
        try:
            if action:
                if not isinstance(payload, dict) or set(payload) != {"projectId"} or not isinstance(payload["projectId"], str) or not payload["projectId"]:
                    raise ValueError("Run actions require only the projectId; retained inputs cannot be overridden")
                if self.job_manager.get(parts[3]) is None:
                    return self._json(404, {"error": "Run not found"})
            if action != "cancel" and not sionna_available():
                return self._json(503, {"error": "Sionna-RT is unavailable. Configure SIONNA_RT_PYTHON with a Sionna-enabled Python environment."})
            project_id = payload.get("projectId") if isinstance(payload, dict) else None
            record = self.job_manager.cancel(parts[3], project_id) if action == "cancel" else self.job_manager.retry(parts[3], project_id) if action == "retry" else self.job_manager.start(payload, project_id=project_id)
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            return self._json(400, {"error": str(exc)})
        except RuntimeError as exc:
            return self._json(409, {"error": str(exc)})
        return self._json(202, record)

    def send_head(self):
        path = urlsplit(self.path).path
        requested = Path(self.translate_path(self.path)).resolve()
        database = self.store.path.resolve()
        if (any(part.startswith(".") or part in ("state", "graft", "__pycache__") for part in path.split("/") if part)
                or requested in (database, Path(str(database) + "-wal"), Path(str(database) + "-shm"))
                or path.endswith((".sqlite3", ".sqlite3-wal", ".sqlite3-shm"))):
            self.send_error(404, "File not found")
            return None
        for header in ("If-Modified-Since", "If-None-Match"):
            if header in self.headers:
                del self.headers[header]
        return super().send_head()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


def existing_server_status(host, port):
    """Distinguish this live API from an older process serving fresh files."""
    probe_host = "127.0.0.1" if host in ("0.0.0.0", "::") else host
    try:
        for name in ("index.html", "src/main.tsx"):
            expected_path = FRONTEND_BUILD_ROOT / name if name == "index.html" else ROOT / name
            expected = expected_path.read_bytes()
            connection = http.client.HTTPConnection(probe_host, port, timeout=2)
            try:
                connection.request("GET", "/" + name)
                response = connection.getresponse()
                body = response.read(len(expected) + 1)
                if response.status != 200:
                    return "foreign"
                if body != expected:
                    if name == "index.html" and body == (ROOT / name).read_bytes():
                        return "stale"
                    return "foreign"
            finally:
                connection.close()
        connection = http.client.HTTPConnection(probe_host, port, timeout=2)
        try:
            connection.request("GET", "/api/workspace")
            response = connection.getresponse()
            try:
                capability = json.loads(response.read()) if response.status == 200 else {}
            except json.JSONDecodeError:
                capability = {}
            return "current" if isinstance(capability.get("revision"), int) else "stale"
        finally:
            connection.close()
    except (OSError, http.client.HTTPException):
        return "foreign"


class LocalDevHTTPServer(ThreadingHTTPServer):
    # Chromium loads split JS/CSS assets concurrently. Keep their short burst
    # above the standard five-connection backlog instead of resetting a load.
    request_queue_size = 32


def main(argv=None):
    parser = argparse.ArgumentParser(description="Serve the Atlas RAN Twin mockup")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--port-fallback", action="store_true", help="Try up to 10 following ports when the requested port is occupied")
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error("--port must be between 0 and 65535")
    handler = partial(LocalDevRequestHandler, directory=str(ROOT))
    last_port = min(args.port + (10 if args.port_fallback else 0), 65535)
    for port in range(args.port, last_port + 1):
        url = f"http://{args.host}:{port}/"
        try:
            server = LocalDevHTTPServer((args.host, port), handler)
            url = f"http://{args.host}:{server.server_port}/"
            break
        except OSError as exc:
            if exc.errno != errno.EADDRINUSE:
                print(f"Cannot start Atlas RAN Twin at {url}: {exc}", file=sys.stderr)
                return 2
            status = existing_server_status(args.host, port)
            if status == "current":
                print(f"Atlas RAN Twin is already running at {url}", flush=True)
                return 0
            if args.port_fallback:
                owner = "An older Atlas RAN Twin server" if status == "stale" else "Another service"
                print(f"{owner} owns port {port}; checking the next available port.", flush=True)
                continue
            if status == "stale":
                print(f"An older Atlas RAN Twin server owns port {port}. Stop it with Ctrl+C and run make run again, or use PORT={port + 1}.", file=sys.stderr)
                return 2
            print(f"Port {port} is in use by another service. Try make run PORT={port + 1}.", file=sys.stderr)
            return 2
    else:
        print(f"No available port from {args.port} to {last_port}. Try make run PORT=<free-port>.", file=sys.stderr)
        return 2
    try:
        LocalDevRequestHandler.store.interrupt_incomplete_runs()
        print(f"Atlas RAN Twin is serving at {url} (Ctrl+C to stop)", flush=True)
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nAtlas RAN Twin server stopped.", flush=True)
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
