"""SQLite persistence for local twin projects, artifacts, plans, and RT runs."""

import json
import re
import sqlite3
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path


class StoreConflict(Exception):
    """A different browser tab saved a newer workspace revision."""


def _json(value):
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(",", ":"))


def _now():
    return datetime.now(timezone.utc).isoformat()


class ProjectStore:
    def __init__(self, path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as db:
            db.execute("PRAGMA journal_mode=WAL")
            db.executescript("""
                CREATE TABLE IF NOT EXISTS workspace_meta (
                    id INTEGER PRIMARY KEY CHECK (id = 1), active_project_id TEXT NOT NULL,
                    revision INTEGER NOT NULL
                );
                CREATE TABLE IF NOT EXISTS projects (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE COLLATE NOCASE,
                    status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
                    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, project_json TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS activity (
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    position INTEGER NOT NULL, happened_at TEXT NOT NULL,
                    title TEXT NOT NULL, detail TEXT NOT NULL,
                    PRIMARY KEY (project_id, position)
                );
                CREATE TABLE IF NOT EXISTS tasks (
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    task_id TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL,
                    payload_json TEXT NOT NULL, PRIMARY KEY (project_id, task_id)
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    artifact_id TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL,
                    mime_type TEXT NOT NULL, description TEXT NOT NULL,
                    content TEXT NOT NULL, updated_at TEXT NOT NULL,
                    PRIMARY KEY (project_id, artifact_id)
                );
                CREATE TABLE IF NOT EXISTS task_runs (
                    id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
                    task_id TEXT, kind TEXT NOT NULL, status TEXT NOT NULL,
                    created_at TEXT NOT NULL, completed_at TEXT,
                    input_json TEXT NOT NULL, result_json TEXT, error TEXT
                );
                CREATE INDEX IF NOT EXISTS task_runs_project_created ON task_runs(project_id, created_at DESC);
            """)

    @contextmanager
    def _connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA foreign_keys=ON")
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    @staticmethod
    def _validate(workspace, artifacts):
        if not isinstance(workspace, dict) or workspace.get("schemaVersion") != 1:
            raise ValueError("Unsupported workspace schema")
        records = workspace.get("projects")
        if not isinstance(records, list) or not 1 <= len(records) <= 100:
            raise ValueError("Workspace must contain 1–100 projects")
        if not isinstance(artifacts, dict):
            raise ValueError("Artifact index is required")
        ids, names, active = set(), set(), set()
        for record in records:
            if not isinstance(record, dict):
                raise ValueError("Invalid project record")
            project_id, name = record.get("id"), record.get("name")
            if not isinstance(project_id, str) or not re.fullmatch(r"[\w-]{1,80}", project_id, re.ASCII) or project_id in ids:
                raise ValueError("Project IDs must be unique and valid")
            if not isinstance(name, str) or not 1 <= len(name.strip()) <= 80 or name.casefold() in names:
                raise ValueError("Project names must be unique and valid")
            if record.get("status") not in ("active", "archived"):
                raise ValueError("Invalid project status")
            project = record.get("project")
            if not isinstance(project, dict) or project.get("name") != name or project.get("schemaVersion") != 1:
                raise ValueError("Project configuration does not match its record")
            if not isinstance(project.get("tasks"), list) or len(project["tasks"]) > 500:
                raise ValueError("Invalid task list")
            if any(project.get(key) is not None and not isinstance(project[key], dict)
                   for key in ("runtime", "integration", "channel")):
                raise ValueError("Invalid project runtime, integration, or channel")
            if ((project.get("runtime") or {}).get("status") not in (None, "not-connected") or
                    (project.get("integration") or {}).get("connected") not in (None, False) or
                    (project.get("channel") or {}).get("execution") not in (None, "planned-not-executed")):
                raise ValueError("Project cannot claim unverified runtime or execution")
            task_ids = set()
            for task in project["tasks"]:
                if not isinstance(task, dict) or not isinstance(task.get("id"), str) or task["id"] in task_ids:
                    raise ValueError("Task IDs must be unique and valid")
                task_ids.add(task["id"])
                if (not isinstance(task.get("dueDate"), str) or task.get("status") != "planned" or
                        task.get("execution", "not-executed") != "not-executed"):
                    raise ValueError("Invalid task schedule")
            activity = record.get("activity")
            if not isinstance(activity, list) or len(activity) > 200 or any(
                not isinstance(entry, dict) or not all(isinstance(entry.get(key), str) for key in ("when", "title", "detail"))
                for entry in activity
            ):
                raise ValueError("Invalid project activity")
            if not all(isinstance(record.get(key), str) for key in ("createdAt", "updatedAt")):
                raise ValueError("Invalid project timestamp")
            files = artifacts.get(project_id)
            if not isinstance(files, list) or len(files) > 1000:
                raise ValueError("Each project needs a bounded artifact list")
            file_ids = set()
            for file in files:
                if not isinstance(file, dict) or any(not isinstance(file.get(key), str) for key in
                    ("id", "path", "name", "mimeType", "description", "content")):
                    raise ValueError("Invalid artifact record")
                if not 1 <= len(file["id"]) <= 80 or file["id"] in file_ids or len(file["path"]) > 500 or len(file["content"].encode("utf-8")) > 3_000_000:
                    raise ValueError("Artifact ID, path, or content exceeds its limit")
                file_ids.add(file["id"])
            ids.add(project_id)
            names.add(name.casefold())
            if record["status"] == "active":
                active.add(project_id)
        if not active or workspace.get("activeProjectId") not in active or set(artifacts) != ids:
            raise ValueError("Active project or artifact index does not match the workspace")

    def load_workspace(self):
        with self._connect() as db:
            meta = db.execute("SELECT active_project_id, revision FROM workspace_meta WHERE id=1").fetchone()
            if meta is None:
                return {"revision": 0, "workspace": None}
            records = []
            for row in db.execute("SELECT * FROM projects ORDER BY created_at, id"):
                project = json.loads(row["project_json"])
                project["tasks"] = [json.loads(task["payload_json"]) for task in db.execute(
                    "SELECT payload_json FROM tasks WHERE project_id=? ORDER BY rowid", (row["id"],))]
                activity = [{"when": item["happened_at"], "title": item["title"], "detail": item["detail"]}
                            for item in db.execute("SELECT * FROM activity WHERE project_id=? ORDER BY position", (row["id"],))]
                records.append({"id": row["id"], "name": row["name"], "status": row["status"],
                                "createdAt": row["created_at"], "updatedAt": row["updated_at"],
                                "project": project, "activity": activity})
            return {"revision": meta["revision"], "workspace": {
                "schemaVersion": 1, "activeProjectId": meta["active_project_id"], "projects": records}}

    def save_workspace(self, workspace, artifacts, expected_revision):
        self._validate(workspace, artifacts)
        if not isinstance(expected_revision, int) or isinstance(expected_revision, bool) or expected_revision < 0:
            raise ValueError("Invalid workspace revision")
        with self._connect() as db:
            db.execute("BEGIN IMMEDIATE")
            meta = db.execute("SELECT revision FROM workspace_meta WHERE id=1").fetchone()
            current = meta["revision"] if meta else 0
            if current != expected_revision:
                raise StoreConflict("Workspace changed in another browser tab; reload from the database")
            keep_ids = [record["id"] for record in workspace["projects"]]
            db.execute(f"DELETE FROM projects WHERE id NOT IN ({','.join('?' for _ in keep_ids)})", keep_ids)
            for record in workspace["projects"]:
                project_id = record["id"]
                db.execute("""INSERT INTO projects VALUES (?,?,?,?,?,?)
                    ON CONFLICT(id) DO UPDATE SET name=excluded.name, status=excluded.status,
                    created_at=excluded.created_at, updated_at=excluded.updated_at, project_json=excluded.project_json""",
                    (project_id, record["name"], record["status"], record["createdAt"], record["updatedAt"], _json(record["project"])))
                for table in ("activity", "tasks", "artifacts"):
                    db.execute(f"DELETE FROM {table} WHERE project_id=?", (project_id,))
                db.executemany("INSERT INTO activity VALUES (?,?,?,?,?)", [
                    (project_id, index, entry["when"], entry["title"], entry["detail"])
                    for index, entry in enumerate(record["activity"])])
                db.executemany("INSERT INTO tasks VALUES (?,?,?,?,?)", [
                    (project_id, task["id"], task["dueDate"], task["status"], _json(task))
                    for task in record["project"]["tasks"]])
                db.executemany("INSERT INTO artifacts VALUES (?,?,?,?,?,?,?,?)", [
                    (project_id, file["id"], file["path"], file["name"], file["mimeType"],
                     file["description"], file["content"], record["updatedAt"])
                    for file in artifacts[project_id]])
            db.execute("INSERT INTO workspace_meta(id,active_project_id,revision) VALUES (1,?,?) "
                       "ON CONFLICT(id) DO UPDATE SET active_project_id=excluded.active_project_id, revision=excluded.revision",
                       (workspace["activeProjectId"], current + 1))
            return current + 1

    def list_projects(self):
        with self._connect() as db:
            return [dict(row) for row in db.execute("""SELECT p.id, p.name, p.status, p.created_at AS createdAt,
                p.updated_at AS updatedAt, (SELECT COUNT(*) FROM tasks t WHERE t.project_id=p.id) AS taskCount,
                (SELECT COUNT(*) FROM artifacts a WHERE a.project_id=p.id) AS artifactCount,
                (SELECT COUNT(*) FROM task_runs r WHERE r.project_id=p.id) AS runCount
                FROM projects p ORDER BY p.updated_at DESC, p.id""")]

    def project_exists(self, project_id):
        with self._connect() as db:
            return db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone() is not None

    def list_tasks(self, project_id):
        with self._connect() as db:
            if not db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
                return None
            return [json.loads(row["payload_json"]) for row in db.execute(
                "SELECT payload_json FROM tasks WHERE project_id=? ORDER BY due_date, task_id", (project_id,))]

    def list_artifacts(self, project_id, include_content=False):
        with self._connect() as db:
            if not db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
                return None
            fields = "artifact_id AS id, path, name, mime_type AS mimeType, description, updated_at AS updatedAt, length(content) AS size"
            if include_content:
                fields += ", content"
            return [dict(row) for row in db.execute(
                f"SELECT {fields} FROM artifacts WHERE project_id=? ORDER BY path", (project_id,))]

    def get_artifact(self, project_id, artifact_id):
        with self._connect() as db:
            row = db.execute("""SELECT artifact_id AS id, path, name, mime_type AS mimeType,
                description, content, updated_at AS updatedAt FROM artifacts
                WHERE project_id=? AND artifact_id=?""", (project_id, artifact_id)).fetchone()
            return dict(row) if row else None

    def create_run(self, run_id, project_id, kind, payload):
        if not self.project_exists(project_id):
            raise ValueError("Project not found")
        with self._connect() as db:
            db.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?,?)",
                       (run_id, project_id, None, kind, "queued", _now(), None, _json(payload), None, None))

    def update_run(self, run_id, status, result=None, error=None):
        with self._connect() as db:
            db.execute("UPDATE task_runs SET status=?, completed_at=?, result_json=?, error=? WHERE id=?",
                       (status, _now() if status in ("complete", "failed", "interrupted") else None,
                        _json(result) if result is not None else None, error, run_id))

    def get_run(self, run_id):
        with self._connect() as db:
            row = db.execute("SELECT * FROM task_runs WHERE id=?", (run_id,)).fetchone()
            if not row:
                return None
            return {"id": row["id"], "projectId": row["project_id"], "taskId": row["task_id"],
                    "kind": row["kind"], "status": row["status"], "createdAt": row["created_at"],
                    "completedAt": row["completed_at"], "input": json.loads(row["input_json"]),
                    "result": json.loads(row["result_json"]) if row["result_json"] else None,
                    "error": row["error"]}

    def count_runs(self, project_id):
        with self._connect() as db:
            return db.execute("SELECT COUNT(*) FROM task_runs WHERE project_id=?", (project_id,)).fetchone()[0]

    def list_runs(self, project_id, limit=200, offset=0):
        with self._connect() as db:
            if not db.execute("SELECT 1 FROM projects WHERE id=?", (project_id,)).fetchone():
                return None
            rows = db.execute("""SELECT id, project_id AS projectId, task_id AS taskId, kind, status,
                created_at AS createdAt, completed_at AS completedAt, result_json, error
                FROM task_runs WHERE project_id=? ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?""",
                (project_id, limit, offset))
            return [{"id": row["id"], "projectId": row["projectId"], "taskId": row["taskId"],
                     "kind": row["kind"], "status": row["status"], "createdAt": row["createdAt"],
                     "completedAt": row["completedAt"], "totalPaths":
                     (json.loads(row["result_json"]).get("totalPaths") if row["result_json"] else None),
                     "error": row["error"]} for row in rows]

    def interrupt_incomplete_runs(self):
        with self._connect() as db:
            db.execute("UPDATE task_runs SET status='interrupted', completed_at=?, error=? "
                       "WHERE status IN ('queued','running')",
                       (_now(), "Server stopped before this run completed"))
