"""Bounded immutable measurement snapshots and an explicit working selection."""
import hashlib
import json
import re
from datetime import date, datetime
from drive_storage import validate_drive_measurements


def _retained_evidence(value):
    evidence = value.get("evidence")
    if evidence is None:
        return
    if not isinstance(evidence, dict) or type(evidence.get("schemaVersion")) is not int or evidence["schemaVersion"] not in (1, 2):
        raise ValueError("Invalid retained source version")
    if evidence["schemaVersion"] == 2:
        return  # The mapped source validator verifies its recipe, status, dates and digests.
    raw, steps, sha = evidence.get("rawCsv"), evidence.get("transformations"), evidence.get("sha256")
    if (evidence.get("origin") not in ("unknown", "synthetic", "field-measured") or
            evidence.get("verification") != "unverified" or evidence.get("coordinateReference") != "EPSG:4326" or
            not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha) or evidence.get("datasetId") != f"sha256-{sha}" or
            not isinstance(raw, str) or len(raw.encode("utf-8")) > 1_000_000 or
            not isinstance(steps, list) or len(steps) != 1 or not isinstance(steps[0], dict) or
            steps[0].get("type") != "strict-gps-csv-parse" or type(steps[0].get("version")) is not int or steps[0]["version"] != 1):
        raise ValueError("Invalid retained legacy source evidence")
    try:
        imported = datetime.fromisoformat(evidence["importedAt"].replace("Z", "+00:00"))
        acquired = evidence["sourceDate"]
        if acquired is not None and (date.fromisoformat(acquired).isoformat() != acquired or acquired > imported.date().isoformat()):
            raise ValueError("Invalid retained source date")
    except (KeyError, TypeError, AttributeError, ValueError) as exc:
        raise ValueError("Invalid retained source date") from exc
    if evidence["origin"] != "synthetic" and re.search(r"synthetic(?:[-_ ]|$)", raw, re.I):
        raise ValueError("Retained origin conflicts with synthetic source evidence")


def validate_measurement_library(project):
    library = project.get("measurementLibrary")
    if library is None:
        return
    if (not isinstance(library, dict) or set(library) != {"schemaVersion", "records", "activeId"} or
            type(library.get("schemaVersion")) is not int or library["schemaVersion"] != 1 or
            not isinstance(library.get("records"), list) or not 1 <= len(library["records"]) <= 20):
        raise ValueError("Measurement library requires 1–20 retained datasets")
    if len(json.dumps(library, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 2_000_000:
        raise ValueError("Measurement library exceeds 2 MB")
    if len(json.dumps(project, ensure_ascii=False, indent=2).encode("utf-8")) > 3_000_000:
        raise ValueError("Project snapshot exceeds 3 MB")
    ids, active = set(), None
    for index, record in enumerate(library["records"]):
        if (not isinstance(record, dict) or set(record) != {"id", "version", "registeredAt", "inputJson", "sha256"} or
                type(record.get("version")) is not int or record["version"] != index + 1 or
                not isinstance(record.get("sha256"), str) or not re.fullmatch(r"[a-f0-9]{64}", record["sha256"]) or
                record.get("id") != f'dataset-{record["sha256"]}' or record["id"] in ids or
                not isinstance(record.get("inputJson"), str) or not isinstance(record.get("registeredAt"), str) or
                not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z", record["registeredAt"])):
            raise ValueError("Invalid measurement dataset identity or version")
        try:
            datetime.fromisoformat(record["registeredAt"].replace("Z", "+00:00"))
            value = json.loads(record["inputJson"])
        except (ValueError, TypeError) as exc:
            raise ValueError("Invalid measurement dataset payload / date") from exc
        if not isinstance(value, dict):
            raise ValueError("Invalid measurement dataset payload")
        if hashlib.sha256(record["inputJson"].encode("utf-8")).hexdigest() != record["sha256"]:
            raise ValueError("Retained measurement dataset digest does not match")
        validate_drive_measurements(value)
        _retained_evidence(value)
        ids.add(record["id"])
        if record["id"] == library["activeId"]:
            active = value
    if library["activeId"] is not None and library["activeId"] not in ids:
        raise ValueError("Working dataset selection not found in the measurement library")
    if project.get("driveMeasurements") != active:
        raise ValueError("Working dataset does not match the selected retained measurement version")


def assert_measurement_transition(previous, following):
    if previous is None:
        return
    if following is None or following["records"][:len(previous["records"])] != previous["records"]:
        raise ValueError("Measurement history is immutable; import a new dataset version")
