"""Database and HTTP list API regression tests."""

import http.client
import json
import hashlib
import copy
import subprocess
import sqlite3
import sys
import time
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
    def test_frozen_cell_inventory_declarations_survive_working_edits_and_reject_forged_payloads(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/cell-inventory.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 0)
        previous = self.store.load_workspace()
        draft = copy.deepcopy(fixture["workspace"])
        project = draft["projects"][0]["project"]
        project["sites"][1]["cells"][1]["inventoryIdentity"]["carrierName"] = "Working carrier B"
        self.store.save_workspace(draft, fixture["artifacts"], 1)
        saved = self.store.load_workspace()
        self.assertEqual(saved["workspace"]["projects"][0]["project"]["study"], previous["workspace"]["projects"][0]["project"]["study"])
        forged = copy.deepcopy(draft)
        baseline = forged["projects"][0]["project"]["study"]["baselines"][-1]
        inputs = json.loads(baseline["inputJson"])
        inputs["inputs"]["sites"][1]["cells"][1]["inventoryIdentity"]["verification"] = "verified"
        baseline["inputJson"] = json.dumps(inputs, sort_keys=True, separators=(",", ":"))
        baseline["sha256"] = hashlib.sha256(baseline["inputJson"].encode()).hexdigest()
        with self.assertRaisesRegex(ValueError, "identity"):
            self.store.save_workspace(forged, fixture["artifacts"], 2)
        self.assertEqual(self.store.load_workspace(), saved)

    def test_cell_inventory_identity_validation_and_atomic_rejection(self):
        value = workspace()
        identity = {"schemaVersion": 1, "technology": "NR", "mcc": "001", "mnc": "01", "cellId": "68719476735", "pci": 1007,
                    "arfcn": 3279165, "carrierName": "Test carrier", "sourceReference": "Manual reference", "source": "manual", "verification": "unverified"}
        value["projects"][0]["project"]["sites"] = [{"id": "SITE-01", "radio": {"technology": "4G LTE + 5G NR"},
                                                   "cells": [{"id": "SITE-01-C1", "inventoryIdentity": identity}]}]
        self.store.save_workspace(value, artifacts(), 0)
        previous = self.store.load_workspace()
        for change in ({"mnc": "1"}, {"mnc": 1}, {"mcc": None}, {"cellId": "68719476736"}, {"cellId": "01"}, {"pci": True},
                       {"pci": 1008}, {"pci": 10 ** 400}, {"arfcn": 3279166}, {"verification": "verified"}, {"extra": True}, {"schemaVersion": True},
                       {"technology": ["NR"]}, {"carrierName": "\ufeffuntrimmed"}):
            with self.subTest(change=change):
                draft = copy.deepcopy(value)
                draft["projects"][0]["project"]["sites"][0]["cells"][0]["inventoryIdentity"].update(change)
                with self.assertRaises(ValueError):
                    self.store.save_workspace(draft, artifacts(), 1)
                self.assertEqual(self.store.load_workspace(), previous)
        duplicate = copy.deepcopy(value)
        duplicate["projects"][0]["project"]["sites"][0]["cells"].append({"id": "SITE-01-C2", "inventoryIdentity": copy.deepcopy(identity)})
        with self.assertRaisesRegex(ValueError, "Duplicate"):
            self.store.save_workspace(duplicate, artifacts(), 1)
        self.assertEqual(self.store.load_workspace(), previous)
        duplicate["projects"][0]["project"]["sites"][0]["cells"][1]["inventoryIdentity"]["mnc"] = "001"
        self.store.save_workspace(duplicate, artifacts(), 1)
        self.assertEqual(ProjectStore(self.path).load_workspace()["workspace"], duplicate)

    def test_nullable_measurements_retain_mapping_and_reject_source_recipe_and_sample_tampering(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/drive-import.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 0)
        original = self.store.load_workspace()
        trace = original["workspace"]["projects"][0]["project"]["driveMeasurements"]
        self.assertEqual(trace["samples"][1]["rsrpDbm"], None)
        self.assertEqual(trace["samples"][1]["dlMbps"], 0)
        self.assertEqual(trace["samples"][1]["timeS"], 1.5)
        for mutation in ("source", "mapping", "digest", "sample", "version", "baseline"):
            with self.subTest(mutation=mutation):
                draft = copy.deepcopy(fixture["workspace"])
                target = draft["projects"][0]["project"]["driveMeasurements"]
                if mutation == "source": target["evidence"]["rawCsv"] += "\n"
                if mutation == "mapping": target["evidence"]["transformations"][0]["mapping"]["dl_mbps"]["unit"] = "MBps"
                if mutation == "digest": target["evidence"]["normalizationSha256"] = "a" * 64
                if mutation == "sample": target["samples"][0]["rsrpDbm"] = -90
                if mutation == "version": target["schemaVersion"] = 99
                if mutation == "baseline":
                    baseline = draft["projects"][0]["project"]["study"]["baselines"][0]
                    payload = json.loads(baseline["inputJson"])
                    payload["inputs"]["driveMeasurements"]["evidence"]["sha256"] = "a" * 64
                    baseline["inputJson"] = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
                    baseline["sha256"] = hashlib.sha256(baseline["inputJson"].encode()).hexdigest()
                with self.assertRaisesRegex(ValueError, "(?i)drive|measurement|mapping|digest|version"):
                    self.store.save_workspace(draft, fixture["artifacts"], 1)
                self.assertEqual(self.store.load_workspace(), original)

    def frozen_fixture(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/study-run.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 0)
        return fixture

    def wait_terminal(self, manager, run_id):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            value = manager.get(run_id)
            if value["status"] not in ("queued", "running", "cancelling"):
                return value
            threading.Event().wait(0.01)
        self.fail("Worker did not reach a terminal state")

    def test_retry_retains_original_working_inputs_parent_evidence_and_scope(self):
        fixture = self.frozen_fixture()
        original = fixture["workingJob"]
        self.store.create_run("original", "project-1", "sionna-rt", original)
        self.store.update_run("original", "failed", error="original failure")
        saved = copy.deepcopy(fixture["workspace"])
        saved["projects"][0]["project"]["sites"][0]["heightM"] = 99
        other = workspace("Other", "other")["projects"][0]
        saved["projects"].append(other)
        self.store.save_workspace(saved, {**fixture["artifacts"], **artifacts("other")}, 1)
        payload = self.store.create_retry("retry", "project-1", "original")
        self.assertEqual(payload, original)
        retry = ProjectStore(self.path).get_run("retry")
        self.assertEqual(retry["input"], original)
        self.assertEqual(retry["retryOf"], "original")
        self.assertEqual(retry["events"][0]["status"], "queued")
        self.assertEqual(self.store.get_run("original")["error"], "original failure")
        with self.assertRaisesRegex(ValueError, "project"):
            self.store.create_retry("cross-project", "other", "original")
        with self.assertRaisesRegex(ValueError, "terminal|failed|interrupted|cancelled"):
            self.store.create_retry("active-retry", "project-1", "retry")
        self.store.create_run("legacy", "other", "sionna-rt", JOB)
        self.store.update_run("legacy", "failed", error="legacy failure")
        with self.assertRaisesRegex(ValueError, "frozen|capture"):
            self.store.create_retry("legacy-retry", "other", "legacy")
        saved["projects"][0]["status"] = "archived"
        saved["activeProjectId"] = "other"
        self.store.save_workspace(saved, {**fixture["artifacts"], **artifacts("other")}, 2)
        with self.assertRaisesRegex(ValueError, "Archived"):
            self.store.create_retry("archived-retry", "project-1", "original")
        self.assertEqual(self.store.count_runs("project-1"), 2)

    def test_cancel_waits_for_worker_exit_discards_late_output_and_preserves_terminal_evidence(self):
        fixture = self.frozen_fixture()
        entered, release = threading.Event(), threading.Event()
        def runner(_):
            entered.set()
            release.wait(3)
            return {"totalPaths": 0, "paths": []}
        manager = JobManager(runner=runner, store=self.store)
        native_thread, workers = threading.Thread, []
        def thread_factory(**kwargs):
            worker = native_thread(**kwargs)
            workers.append(worker)
            return worker
        with patch("serve.threading.Thread", side_effect=thread_factory):
            receipt = manager.start(fixture["workingJob"], project_id="project-1")
        self.assertTrue(entered.wait(2))
        try:
            with self.assertRaisesRegex(ValueError, "project"):
                manager.cancel(receipt["id"], "other")
            requested = manager.cancel(receipt["id"], "project-1")
            self.assertEqual(requested["status"], "cancelling")
            self.assertTrue(requested["cancelRequestedAt"])
            self.assertEqual(self.store.get_run(receipt["id"])["status"], "cancelling")
            with self.assertRaisesRegex(RuntimeError, "already running"):
                manager.start(fixture["workingJob"], project_id="project-1")
        finally:
            release.set()
            workers[0].join(3)
        self.assertEqual(self.wait_terminal(manager, receipt["id"])["status"], "cancelled")
        retained = self.store.get_run(receipt["id"])
        self.assertIsNone(retained["result"])
        self.assertEqual(retained["input"], fixture["workingJob"])
        self.assertEqual([item["status"] for item in retained["events"]], ["queued", "running", "cancelling", "cancelled"])
        self.assertEqual(manager.cancel(receipt["id"], "project-1")["status"], "cancelled")
        self.assertEqual(self.store.get_run(receipt["id"])["events"], retained["events"])
        with self.assertRaisesRegex(ValueError, "(?i)terminal|transition"):
            self.store.update_run(receipt["id"], "complete", result={"totalPaths": 999})

    def test_cancel_before_execution_prevents_the_worker_from_starting(self):
        fixture = self.frozen_fixture()
        pending = []
        class DeferredThread:
            def __init__(self, target, args, **_): pending.append(lambda: target(*args))
            def start(self): pass
        calls = []
        manager = JobManager(runner=lambda job: calls.append(job), store=self.store)
        with patch("serve.threading.Thread", DeferredThread):
            receipt = manager.start(fixture["workingJob"], project_id="project-1")
        manager.cancel(receipt["id"], "project-1")
        pending[0]()
        self.assertEqual(manager.get(receipt["id"])["status"], "cancelled")
        self.assertEqual(calls, [])

    def test_cancellation_terminates_and_reaps_the_owned_worker_process(self):
        cancel, spawned = threading.Event(), threading.Event()
        real_popen, children, errors = subprocess.Popen, [], []
        def popen(_command, **kwargs):
            child = real_popen([sys.executable, "-c", "import time; time.sleep(30)"], **kwargs)
            children.append(child)
            spawned.set()
            return child
        def execute():
            try: JobManager._run_worker(JOB, cancel)
            except Exception as exc: errors.append(exc)
        with patch("serve.subprocess.Popen", side_effect=popen):
            worker = threading.Thread(target=execute)
            worker.start()
            try:
                self.assertTrue(spawned.wait(2))
                cancel.set()
                worker.join(3)
                self.assertFalse(worker.is_alive())
                self.assertIsNotNone(children[0].poll())
                self.assertEqual(type(errors[0]).__name__, "JobCancelled")
            finally:
                cancel.set()
                for child in children:
                    if child.poll() is None: child.kill()
                    child.communicate()
                worker.join(3)

    def test_worker_launch_failure_records_failure_and_releases_the_slot_for_start_and_retry(self):
        fixture = self.frozen_fixture()
        manager = JobManager(runner=lambda _: {"totalPaths": 0, "paths": []}, store=self.store)
        with patch("serve.threading.Thread.start", side_effect=RuntimeError("Cannot start worker")):
            with self.assertRaisesRegex(RuntimeError, "Cannot start worker"):
                manager.start(fixture["workingJob"], "project-1")
            self.assertIsNone(manager.active)
            runs = self.store.list_runs("project-1")
            parent = self.store.get_run(runs[0]["id"])
            self.assertEqual(parent["status"], "failed")
            self.assertEqual(parent["events"][-1]["status"], "failed")
            with self.assertRaisesRegex(RuntimeError, "Cannot start worker"):
                manager.retry(parent["id"], "project-1")
            self.assertIsNone(manager.active)
            runs = self.store.list_runs("project-1")
            self.assertEqual(len(runs), 2)
            child = self.store.get_run(runs[0]["id"])
            self.assertEqual(child["status"], "failed")
            self.assertEqual(child["retryOf"], parent["id"])
            self.assertEqual(child["input"], parent["input"])
            self.assertEqual(self.store.get_run(parent["id"]), parent)

    def test_run_migration_preserves_legacy_evidence_and_restart_records_cancel_interruption(self):
        legacy_path = Path(self.temp.name) / "legacy.sqlite3"
        with sqlite3.connect(legacy_path) as db:
            db.execute("CREATE TABLE task_runs (id TEXT PRIMARY KEY, project_id TEXT, task_id TEXT, kind TEXT, status TEXT, created_at TEXT, completed_at TEXT, input_json TEXT, result_json TEXT, error TEXT)")
            db.execute("INSERT INTO task_runs VALUES (?,?,?,?,?,?,?,?,?,?)", ("legacy", "pilot", None, "sionna-rt", "failed", "2026-01-01", "2026-01-01", json.dumps(JOB), None, "original failure"))
        legacy = ProjectStore(legacy_path).get_run("legacy")
        self.assertEqual(legacy["error"], "original failure")
        self.assertIsNone(legacy["retryOf"])
        self.assertEqual(legacy["events"], [])
        self.store.save_workspace(workspace(), artifacts(), 0)
        self.store.create_run("cancel-requested", "pilot", "sionna-rt", JOB)
        self.store.update_run("cancel-requested", "cancelling")
        requested_at = self.store.get_run("cancel-requested")["cancelRequestedAt"]
        self.store.interrupt_incomplete_runs()
        retained = self.store.get_run("cancel-requested")
        self.assertEqual(retained["status"], "interrupted")
        self.assertEqual(retained["cancelRequestedAt"], requested_at)
        self.assertEqual(retained["events"][-1]["status"], "interrupted")
        with self.assertRaisesRegex(ValueError, "(?i)terminal|transition"):
            self.store.update_run("cancel-requested", "running")

    def test_fast_worker_returns_a_queued_receipt_and_terminal_status_is_polled_separately(self):
        manager = JobManager(runner=lambda _: {"totalPaths": 0, "paths": []})
        class InlineThread:
            def __init__(self, target, args, **_):
                self.target, self.args = target, args
            def start(self):
                self.target(*self.args)
        with patch("serve.threading.Thread", InlineThread):
            receipt = manager.start(JOB)
        self.assertEqual(receipt["status"], "queued")
        self.assertEqual(manager.get(receipt["id"])["status"], "complete")

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

    def test_measurement_library_switches_retain_history_and_reject_rewrites_atomically(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/measurement-library.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 0)
        self.store.save_workspace(fixture["restored"], fixture["restoredArtifacts"], 1)
        saved = self.store.load_workspace()
        project = saved["workspace"]["projects"][0]["project"]
        self.assertEqual(project["driveMeasurements"]["samples"][0]["rsrpDbm"], -120)
        self.assertEqual(len(project["measurementLibrary"]["records"]), 2)
        self.assertEqual(project["study"], fixture["workspace"]["projects"][0]["project"]["study"])
        for kind in ("removed", "rewritten", "digest", "inactive-source", "selection", "mirror"):
            with self.subTest(kind=kind):
                draft = copy.deepcopy(saved["workspace"])
                data = draft["projects"][0]["project"]
                library = data["measurementLibrary"]
                if kind == "removed":
                    del data["measurementLibrary"]
                elif kind == "rewritten":
                    library["records"][0]["registeredAt"] = "2026-10-02T04:00:00Z"
                elif kind == "digest":
                    library["records"][1]["sha256"] = "0" * 64
                    library["records"][1]["id"] = "dataset-" + "0" * 64
                elif kind == "inactive-source":
                    row = library["records"][1]
                    payload = json.loads(row["inputJson"])
                    payload["samples"][0]["rsrpDbm"] = -80
                    row["inputJson"] = json.dumps(payload, sort_keys=True, separators=(",", ":"))
                    row["sha256"] = hashlib.sha256(row["inputJson"].encode()).hexdigest()
                    row["id"] = "dataset-" + row["sha256"]
                elif kind == "selection":
                    library["activeId"] = "missing-dataset"
                else:
                    data["driveMeasurements"] = None
                with self.assertRaises(ValueError):
                    self.store.save_workspace(draft, fixture["restoredArtifacts"], 2)
                self.assertEqual(self.store.load_workspace(), saved)

    def test_cell_identity_versions_preserve_sources_and_reject_invalid_interpretations_atomically(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/cell-identity.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["previous"], fixture["previousArtifacts"], 0)
        previous = self.store.load_workspace()
        for kind in ("duplicate", "unobserved", "technology", "target", "verified", "bool-version", "null"):
            with self.subTest(kind=kind):
                draft = copy.deepcopy(fixture["workspace"])
                project = draft["projects"][0]["project"]
                payload = project["driveMeasurements"]
                identity = payload["cellIdentity"]
                if kind == "duplicate":
                    identity["bindings"].append(copy.deepcopy(identity["bindings"][0]))
                elif kind == "unobserved":
                    identity["bindings"][0]["sourceCell"] = "unobserved"
                elif kind == "technology":
                    identity["bindings"][0]["technology"] = "WIFI"
                elif kind == "target":
                    identity["bindings"][0]["targetCellId"] = "PCI-42"
                elif kind == "verified":
                    identity["verification"] = "verified"
                elif kind == "bool-version":
                    identity["schemaVersion"] = True
                else:
                    payload["cellIdentity"] = None
                row = project["measurementLibrary"]["records"][-1]
                row["inputJson"] = json.dumps(payload, sort_keys=True, separators=(",", ":"))
                row["sha256"] = hashlib.sha256(row["inputJson"].encode()).hexdigest()
                row["id"] = project["measurementLibrary"]["activeId"] = "dataset-" + row["sha256"]
                with self.assertRaises(ValueError):
                    self.store.save_workspace(draft, fixture["artifacts"], 1)
                self.assertEqual(self.store.load_workspace(), previous)
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 1)
        project = self.store.load_workspace()["workspace"]["projects"][0]["project"]
        old = fixture["previous"]["projects"][0]["project"]
        self.assertEqual(project["driveMeasurements"]["samples"], old["driveMeasurements"]["samples"])
        self.assertEqual(project["driveMeasurements"]["evidence"], old["driveMeasurements"]["evidence"])
        self.assertEqual(project["study"], old["study"])
        self.assertEqual(len(project["measurementLibrary"]["records"]), 3)

    def test_retained_legacy_source_metadata_cannot_claim_verified_measurements(self):
        from measurement_storage import validate_measurement_library
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/measurement-library.mjs")], cwd=ROOT))
        original = fixture["workspace"]["projects"][0]["project"]
        for kind in ("valid", "verified", "origin", "version", "digest", "recipe", "date"):
            with self.subTest(kind=kind):
                project = copy.deepcopy(original)
                row = project["measurementLibrary"]["records"][0]
                value = json.loads(row["inputJson"])
                evidence = value["evidence"]
                evidence["schemaVersion"] = 1
                evidence["datasetId"] = "sha256-" + evidence["sha256"]
                evidence["transformations"] = [{"type": "strict-gps-csv-parse", "version": 1}]
                if kind == "verified":
                    evidence["verification"] = "verified"
                elif kind == "origin":
                    evidence["origin"] = "observed-network"
                elif kind == "version":
                    evidence["schemaVersion"] = True
                elif kind == "digest":
                    evidence["sha256"] = "not-a-digest"
                elif kind == "recipe":
                    evidence["transformations"] = []
                elif kind == "date":
                    evidence["sourceDate"] = "2026-02-30"
                row["inputJson"] = json.dumps(value, sort_keys=True, separators=(",", ":"))
                row["sha256"] = hashlib.sha256(row["inputJson"].encode()).hexdigest()
                row["id"] = "dataset-" + row["sha256"]
                if kind == "valid":
                    validate_measurement_library(project)
                    continue
                with self.assertRaises(ValueError):
                    validate_measurement_library(project)

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

    def test_study_payload_digest_and_append_only_history_are_enforced_atomically(self):
        from study_storage import validate_study
        definition = {"objective": "Weak streets", "operator": "Declared operator", "rat": "NR", "carrierMhz": 3500,
                      "windowStart": None, "windowEnd": None, "version": 1, "createdAt": "2026-10-02T01:00:00Z"}
        inputs = {"map": {}, "sites": [{"id": "SITE-01", "heightM": 25, "cells": [{"id": "SITE-01-C1", "downtiltDeg": 6}]}],
                  "channel": {}, "ue": {}, "architecture": {}, "driveMeasurements": None}
        source = json.dumps({"definition": definition, "inputs": inputs}, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
        study = {"schemaVersion": 1, "definitions": [definition], "baselines": [
            {"id": "base-1", "name": "Baseline", "createdAt": definition["createdAt"], "inputJson": source,
             "sha256": hashlib.sha256(source.encode()).hexdigest()}], "candidates": [], "selection": {"kind": "baseline", "id": "base-1"}}
        validate_study(study)
        state = workspace()
        state["projects"][0]["project"]["study"] = study
        self.store.save_workspace(state, artifacts(), 0)
        changed = copy.deepcopy(state)
        changed["projects"][0]["project"]["study"]["baselines"][0]["name"] = "Rewritten"
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.store.save_workspace(changed, artifacts(), 1)
        changed = copy.deepcopy(state)
        del changed["projects"][0]["project"]["study"]
        with self.assertRaisesRegex(ValueError, "immutable"):
            self.store.save_workspace(changed, artifacts(), 1)
        changed = copy.deepcopy(state)
        changed["projects"][0]["project"]["study"]["baselines"][0]["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest"):
            self.store.save_workspace(changed, artifacts(), 1)
        self.assertEqual(ProjectStore(self.path).load_workspace()["revision"], 1)
        self.assertEqual(self.store.load_workspace()["workspace"], state)
        malformed = copy.deepcopy(study)
        malformed["baselines"][0]["inputJson"] = "[]"
        malformed["baselines"][0]["sha256"] = hashlib.sha256(b"[]").hexdigest()
        with self.assertRaisesRegex(ValueError, "payload"):
            validate_study(malformed)
        malformed = copy.deepcopy(study)
        malformed["selection"] = None
        with self.assertRaisesRegex(ValueError, "selection"):
            validate_study(malformed)

    def test_frozen_js_run_inputs_are_verified_against_saved_versions_before_run_creation(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/study-run.mjs")], cwd=ROOT))
        self.store.save_workspace(fixture["workspace"], fixture["artifacts"], 0)
        job = fixture["candidateJob"]
        self.store.create_run("height-run", "project-1", "sionna-rt", job)
        self.assertEqual(ProjectStore(self.path).get_run("height-run")["input"]["runCapture"]["reference"]["version"], 2)
        self.assertEqual(self.store.get_run("height-run")["input"]["transmitter"]["heightM"], 35)
        for index, mutation in enumerate((
                {"extra": "unbounded extension"},
                {"reference": {**job["runCapture"]["reference"], "extra": "payload"}},
                {"schemaVersion": True}, {"definitionVersion": True},
                {"preparedAt": "2026-10-02T12:00:00"},
                {"solverProfile": {**job["runCapture"]["solverProfile"], "syntheticArray": 1}})):
            with self.subTest(metadata=mutation):
                changed = copy.deepcopy(job)
                changed["runCapture"].update(mutation)
                with self.assertRaises(ValueError):
                    self.store.create_run(f"invalid-metadata-{index}", "project-1", "sionna-rt", changed)
        changed = copy.deepcopy(job)
        changed["retryOf"] = "height-run"
        with self.assertRaisesRegex(ValueError, "job.*capture|capture.*job"):
            self.store.create_run("unlinked-retry", "project-1", "sionna-rt", changed)
        changed = copy.deepcopy(job)
        changed["transmitter"]["heightM"] = 99
        with self.assertRaisesRegex(ValueError, "job.*capture|capture.*job"):
            self.store.create_run("forged-run", "project-1", "sionna-rt", changed)
        changed = copy.deepcopy(job)
        changed["runCapture"]["networkInputSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "digest"):
            self.store.create_run("bad-digest", "project-1", "sionna-rt", changed)
        changed = copy.deepcopy(job)
        changed["runCapture"]["datasetSha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "dataset digest"):
            self.store.create_run("bad-dataset-digest", "project-1", "sionna-rt", changed)
        with self.assertRaisesRegex(ValueError, "isotropic"):
            self.store.create_run("ignored-tilt", "project-1", "sionna-rt", fixture["unsupportedJob"])
        saved = copy.deepcopy(fixture["workspace"])
        saved["projects"][0]["project"]["sites"][0]["heightM"] = 29
        self.store.save_workspace(saved, fixture["artifacts"], 1)
        with self.assertRaisesRegex(ValueError, "changed"):
            self.store.create_run("stale-working", "project-1", "sionna-rt", fixture["workingJob"])
        self.store.create_run("historical-height", "project-1", "sionna-rt", fixture["candidateJob"])
        self.assertEqual(self.store.count_runs("project-1"), 2)


class ProjectApiTests(unittest.TestCase):
    def test_run_actions_preserve_frozen_retry_inputs_and_cancel_even_without_runtime_detection(self):
        fixture = json.loads(subprocess.check_output(["node", str(ROOT / "tests/fixtures/study-run.mjs")], cwd=ROOT))
        self.request("PUT", "/api/workspace", {"revision": 0, "workspace": fixture["workspace"], "artifacts": fixture["artifacts"]})
        handler = self.server.RequestHandlerClass.func
        handler.store.create_run("parent", "project-1", "sionna-rt", fixture["workingJob"])
        handler.store.update_run("parent", "failed", error="Original failure")
        with patch("serve.sionna_available", return_value=True):
            status, child = self.request("POST", "/api/rt/jobs/parent/retry", {"projectId": "project-1"})
        self.assertEqual(status, 202)
        self.assertNotEqual(child["id"], "parent")
        self.assertEqual(child["retryOf"], "parent")
        self.assertEqual(handler.store.get_run(child["id"])["input"], fixture["workingJob"])
        deadline = time.monotonic() + 3
        while handler.job_manager.active is not None and time.monotonic() < deadline:
            threading.Event().wait(.01)
        entered, release = threading.Event(), threading.Event()
        def runner(_):
            entered.set(); release.wait(3)
            return {"totalPaths": 0, "paths": []}
        handler.job_manager = JobManager(runner=runner, store=handler.store)
        with patch("serve.sionna_available", return_value=True):
            status, job = self.request("POST", "/api/rt/jobs", {**fixture["workingJob"], "projectId": "project-1"})
        self.assertEqual(status, 202)
        self.assertTrue(entered.wait(2))
        try:
            with patch("serve.sionna_available", return_value=False):
                status, cancelled = self.request("POST", f"/api/rt/jobs/{job['id']}/cancel", {"projectId": "project-1"})
            self.assertEqual((status, cancelled["status"]), (202, "cancelling"))
            status, _ = self.request("POST", f"/api/rt/jobs/{job['id']}/cancel", {"projectId": "other"})
            self.assertEqual(status, 400)
            status, _ = self.request("POST", "/api/rt/jobs/parent/retry", {"projectId": "project-1"}, {"Origin": "https://example.com"})
            self.assertEqual(status, 403)
        finally:
            release.set()
            deadline = time.monotonic() + 3
            while handler.job_manager.active is not None and time.monotonic() < deadline:
                threading.Event().wait(.01)
        status, detail = self.request("GET", f"/api/runs/{job['id']}")
        self.assertEqual(detail["status"], "cancelled")
        self.assertTrue(detail["cancelRequestedAt"])
        self.assertEqual(detail["events"][-1]["status"], "cancelled")

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
