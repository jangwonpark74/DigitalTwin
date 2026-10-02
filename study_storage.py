"""Server-side content integrity and append-only history for offline RAN studies."""
import hashlib
import json
import math
import re
from datetime import date, datetime
from drive_storage import validate_drive_measurements
from network_identity import validate_inventory_identities

FIELDS = {"heightM": ("site", 1, 300), "txPowerDbm": ("cell", 0, 60),
          "downtiltDeg": ("cell", 0, 30), "azimuthDeg": ("cell", 0, 359.999), "bandwidthMhz": ("cell", 5, 400)}


def _timestamp(value):
    if not isinstance(value, str) or not re.match(r"\d{4}-\d{2}-\d{2}T", value):
        raise ValueError("Invalid study timestamp")
    datetime.fromisoformat(value.replace("Z", "+00:00"))


def _payload(record):
    if not isinstance(record, dict):
        raise ValueError("Invalid study payload record")
    _timestamp(record.get("createdAt"))
    source = record.get("inputJson")
    if not isinstance(source, str) or len(source.encode("utf-8")) > 2_000_000:
        raise ValueError("Invalid study payload")
    if hashlib.sha256(source.encode("utf-8")).hexdigest() != record.get("sha256"):
        raise ValueError("Study content digest does not match its saved inputs")
    value = json.loads(source, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite study input")))
    if not isinstance(value, dict):
        raise ValueError("Study payload must be an object")
    return value


def validate_study(study):
    if study is None:
        return
    if not isinstance(study, dict) or study.get("schemaVersion") != 1:
        raise ValueError("Invalid study schema")
    for key, minimum, maximum in (("definitions", 1, 50), ("baselines", 0, 8), ("candidates", 0, 20)):
        if not isinstance(study.get(key), list) or not minimum <= len(study[key]) <= maximum:
            raise ValueError("Invalid study history limits")
    if len(json.dumps(study, ensure_ascii=False, separators=(",", ":")).encode("utf-8")) > 2_000_000:
        raise ValueError("Study history exceeds 2 MB")
    for index, definition in enumerate(study["definitions"]):
        if (not isinstance(definition, dict) or definition.get("version") != index + 1 or
                definition.get("rat") not in ("ALL", "LTE", "NR") or
                any(not isinstance(definition.get(key), str) or not 1 <= len(definition[key].strip()) <= limit
                    for key, limit in (("objective", 500), ("operator", 120)))):
            raise ValueError("Invalid study definition")
        _timestamp(definition.get("createdAt"))
        carrier = definition.get("carrierMhz")
        if carrier is not None and (isinstance(carrier, bool) or not isinstance(carrier, (int, float)) or not 500 <= carrier <= 100000):
            raise ValueError("Invalid study carrier")
        start, end = definition.get("windowStart"), definition.get("windowEnd")
        if start is not None or end is not None:
            if not isinstance(start, str) or not isinstance(end, str) or date.fromisoformat(start) > date.fromisoformat(end):
                raise ValueError("Invalid study window")
    ids, baselines = set(), {}
    for record in study["baselines"] + study["candidates"]:
        if (not isinstance(record, dict) or not isinstance(record.get("id"), str) or
                not re.fullmatch(r"[\w-]{1,80}", record["id"], re.ASCII) or record["id"] in ids or
                not isinstance(record.get("name"), str) or not 1 <= len(record["name"].strip()) <= 80):
            raise ValueError("Invalid study identity")
        ids.add(record["id"])
    for record in study["baselines"]:
        value = _payload(record)
        definition = value.get("definition", {})
        if not isinstance(definition, dict):
            raise ValueError("Invalid baseline definition")
        version = definition.get("version")
        inputs = value.get("inputs")
        if (not isinstance(version, int) or isinstance(version, bool) or not 1 <= version <= len(study["definitions"]) or
                definition != study["definitions"][version - 1] or not isinstance(inputs, dict) or
                set(inputs) != {"map", "sites", "channel", "ue", "architecture", "driveMeasurements"}):
            raise ValueError("Invalid baseline inputs / definition")
        if (not isinstance(inputs["map"], dict) or not isinstance(inputs["channel"], dict) or
                any(key in inputs["map"] for key in ("geometryValidated", "coordinateAligned", "materialAssigned")) or
                "execution" in inputs["channel"] or not isinstance(inputs["sites"], list) or
                any(not isinstance(site, dict) or not isinstance(site.get("cells"), list) or
                    any(not isinstance(cell, dict) for cell in site["cells"]) for site in inputs["sites"])):
            raise ValueError("Baseline cannot assert unverified execution or geometry")
        validate_inventory_identities(inputs["sites"])
        validate_drive_measurements(inputs.get("driveMeasurements"))
        baselines[record["id"]] = inputs
    for candidate in study["candidates"]:
        baseline_id = candidate.get("baselineId")
        versions = candidate.get("versions")
        if baseline_id not in baselines or not isinstance(versions, list) or not 1 <= len(versions) <= 50:
            raise ValueError("Invalid candidate baseline / revisions")
        for index, revision in enumerate(versions):
            value = _payload(revision)
            changes = value.get("changes")
            if (revision.get("version") != index + 1 or value.get("baselineId") != baseline_id or
                    not isinstance(value.get("issue"), str) or len(value["issue"]) > 500 or
                    not isinstance(changes, list) or len(changes) > 250):
                raise ValueError("Invalid candidate revision")
            seen = set()
            for change in changes:
                if not isinstance(change, dict) or change.get("field") not in FIELDS:
                    raise ValueError("Invalid candidate field")
                field = change["field"]
                scope, minimum, maximum = FIELDS[field]
                site = next((item for item in baselines[baseline_id]["sites"] if item.get("id") == change.get("siteId")), None)
                target = next((cell for cell in (site or {}).get("cells", []) if cell.get("id") == change.get("cellId")), None) if scope == "cell" else site
                after = change.get("after")
                key = (change.get("siteId"), change.get("cellId"), field)
                if (target is None or key in seen or isinstance(after, bool) or not isinstance(after, (int, float)) or
                        not math.isfinite(after) or not minimum <= after <= maximum or target.get(field) != change.get("before") or
                        change.get("before") == after or (scope == "site" and "cellId" in change)):
                    raise ValueError("Invalid candidate exact change list")
                seen.add(key)
    selection = study.get("selection", {})
    if not isinstance(selection, dict):
        raise ValueError("Invalid study reference selection")
    if selection.get("kind") == "baseline" and selection.get("id") in baselines:
        return
    if selection.get("kind") == "candidate":
        candidate = next((item for item in study["candidates"] if item["id"] == selection.get("id")), None)
        if candidate and any(item["version"] == selection.get("version") for item in candidate["versions"]):
            return
    elif selection.get("kind") == "draft":
        return
    raise ValueError("Invalid study reference selection")


def assert_study_transition(previous, next_study):
    if previous is None:
        return
    def immutable():
        raise ValueError("Study history is immutable; create a new baseline or candidate revision")
    if next_study is None:
        immutable()
    for key in ("definitions", "baselines"):
        if next_study[key][:len(previous[key])] != previous[key]:
            immutable()
    for index, candidate in enumerate(previous["candidates"]):
        if index >= len(next_study["candidates"]):
            immutable()
        current = next_study["candidates"][index]
        if (any(candidate[key] != current[key] for key in ("id", "name", "baselineId")) or
                current["versions"][:len(candidate["versions"])] != candidate["versions"]):
            immutable()
