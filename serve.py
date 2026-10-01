"""Serve this local mockup; reuse an existing server for the same project."""

import argparse
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
import uuid
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path, PurePosixPath
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


class JobManager:
    def __init__(self, runner=None, store=None):
        self.lock = threading.Lock()
        self.jobs = {}
        self.active = None
        self.runner = runner or self._run_worker
        self.store = store

    def start(self, payload, project_id=None):
        validate_job(payload)
        if self.store and not project_id:
            raise ValueError("projectId is required to record a Sionna-RT run")
        with self.lock:
            if self.active is not None:
                raise RuntimeError("A Sionna-RT job is already running")
            job_id = str(uuid.uuid4())
            if self.store:
                self.store.create_run(job_id, project_id, "sionna-rt", payload)
            record = {"id": job_id, "status": "queued", "createdAt": datetime.now(timezone.utc).isoformat()}
            self.jobs[job_id] = record
            self.active = job_id
            if len(self.jobs) > 10:
                for old_id in list(self.jobs):
                    if old_id != job_id and self.jobs[old_id]["status"] in ("complete", "failed"):
                        del self.jobs[old_id]
                        break
        threading.Thread(target=self._execute, args=(job_id, payload), daemon=True).start()
        return record.copy()

    def get(self, job_id):
        with self.lock:
            record = self.jobs.get(job_id)
            if record:
                return record.copy()
        run = self.store.get_run(job_id) if self.store else None
        return ({"id": run["id"], "status": run["status"], "createdAt": run["createdAt"],
                 "completedAt": run["completedAt"], "result": run["result"], "error": run["error"]}
                if run else None)

    def _execute(self, job_id, payload):
        try:
            with self.lock:
                self.jobs[job_id]["status"] = "running"
            if self.store and self.store.get_run(job_id):
                self.store.update_run(job_id, "running")
            result = self.runner(payload)
            result.update({"runId": job_id, "fileName": f"sionna-rt-{job_id}.json",
                           "importedAt": datetime.now(timezone.utc).isoformat()})
            with self.lock:
                self.jobs[job_id].update(status="complete", result=result,
                                         completedAt=datetime.now(timezone.utc).isoformat())
            if self.store and self.store.get_run(job_id):
                self.store.update_run(job_id, "complete", result=result)
        except Exception as exc:
            with self.lock:
                self.jobs[job_id].update(status="failed", error=str(exc)[:500],
                                         completedAt=datetime.now(timezone.utc).isoformat())
            if self.store and self.store.get_run(job_id):
                try:
                    self.store.update_run(job_id, "failed", error=str(exc)[:500])
                except sqlite3.Error:
                    pass
        finally:
            with self.lock:
                self.active = None

    @staticmethod
    def _run_worker(payload):
        try:
            result = subprocess.run([sionna_python(), str(ROOT / "rt_worker.py")],
                                    input=json.dumps(payload, allow_nan=False), text=True,
                                    capture_output=True, timeout=180, cwd=ROOT, check=False)
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError("Sionna-RT job exceeded the 180-second limit") from exc
        if result.returncode:
            raise RuntimeError(result.stderr.strip()[-500:] or "Sionna-RT worker failed")
        return json.loads(result.stdout)


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
        if urlsplit(self.path).path != "/api/rt/jobs":
            return self._json(404, {"error": "Unknown endpoint"})
        if not self._allow_local_api_request(check_origin=True):
            return
        payload = self._read_json(2_000_000)
        if payload is None:
            return
        try:
            if not sionna_available():
                return self._json(503, {"error": "Sionna-RT is unavailable. Configure SIONNA_RT_PYTHON with a Sionna-enabled Python environment."})
            project_id = payload.get("projectId") if isinstance(payload, dict) else None
            record = self.job_manager.start(payload, project_id=project_id)
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
