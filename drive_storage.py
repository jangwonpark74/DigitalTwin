"""Validate persisted GPS schema and replay new source-normalization recipes."""
import csv
import hashlib
import io
import json
import math
import re
from datetime import date, datetime

FIELDS = {
    "time_s": ("timeS", ["s", "ms"], 0, 604800),
    "technology": ("technology", [None], None, None), "serving_cell": ("servingCell", [None], None, None),
    "latitude": ("latitude", ["degrees"], -90, 90), "longitude": ("longitude", ["degrees"], -180, 180),
    "rsrp_dbm": ("rsrpDbm", ["dBm"], -160, -40), "rsrq_db": ("rsrqDb", ["dB"], -40, 0),
    "sinr_db": ("sinrDb", ["dB"], -30, 60), "dl_mbps": ("dlMbps", ["Mbps", "kbps", "bps"], 0, 10000),
    "ul_mbps": ("ulMbps", ["Mbps", "kbps", "bps"], 0, 10000), "event": ("event", [None], None, None),
    "x_pct": ("x", ["percent"], 0, 100), "y_pct": ("y", ["percent"], 0, 100),
}
KPI_FIELDS = {"rsrp_dbm", "rsrq_db", "sinr_db", "dl_mbps", "ul_mbps"}
NUMERIC = re.compile(r"-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?", re.ASCII)


def _validate_cell_identity(trace):
    if "cellIdentity" not in trace:
        return
    identity = trace["cellIdentity"]
    if (not isinstance(identity, dict) or set(identity) != {"schemaVersion", "method", "bindings"} or
            type(identity.get("schemaVersion")) is not int or identity["schemaVersion"] != 1 or
            identity.get("method") != "manual-review" or not isinstance(identity.get("bindings"), list) or
            len(identity["bindings"]) > 5000):
        raise ValueError("Invalid measurement cell identity interpretation")
    observed = {(sample["technology"], sample["servingCell"]) for sample in trace["samples"]}
    seen = set()
    for item in identity["bindings"]:
        if (not isinstance(item, dict) or set(item) != {"technology", "sourceCell", "targetCellId"} or
                item.get("technology") not in ("LTE", "NR") or not isinstance(item.get("sourceCell"), str) or
                not re.fullmatch(r"[A-Za-z0-9._:/-]{1,60}", item["sourceCell"]) or
                (item.get("targetCellId") is not None and (not isinstance(item["targetCellId"], str) or
                    not re.fullmatch(r"SITE-\d{2,4}-C[1-3]", item["targetCellId"])) )):
            raise ValueError("Invalid measurement cell identity association")
        key = (item["technology"], item["sourceCell"])
        if key not in observed or key in seen:
            raise ValueError("Invalid or duplicate measurement cell identity association")
        seen.add(key)


def validate_drive_measurements(trace):
    if trace is None:
        return
    if not isinstance(trace, dict) or trace.get("schemaVersion") not in (None, 1, 2) or isinstance(trace.get("schemaVersion"), bool):
        raise ValueError("Invalid drive measurement schema version")
    if (trace.get("source") != "imported-unverified" or trace.get("coordinateMode") != "gps" or
            not isinstance(trace.get("fileName"), str) or not 1 <= len(trace["fileName"].strip()) <= 255 or
            not isinstance(trace.get("samples"), list) or not 2 <= len(trace["samples"]) <= 5000):
        raise ValueError("Invalid drive GPS measurement source or sample count")
    nullable, previous = trace.get("schemaVersion") == 2, -math.inf
    for index, sample in enumerate(trace["samples"]):
        if (not isinstance(sample, dict) or type(sample.get("index")) is not int or sample["index"] != index or
                sample.get("provenance") != "imported-unverified" or sample.get("technology") not in ("LTE", "NR") or
                not isinstance(sample.get("servingCell"), str) or not re.fullmatch(r"[A-Za-z0-9._:/-]{1,60}", sample["servingCell"]) or
                not isinstance(sample.get("event"), str) or len(sample["event"]) > 60 or re.search(r"[<>\x00-\x1f]", sample["event"])):
            raise ValueError("Invalid drive GPS sample identity")
        for field, (key, _, low, high) in FIELDS.items():
            if low is None or field in ("x_pct", "y_pct"):
                continue
            value = sample.get(key)
            if nullable and field in KPI_FIELDS and key in sample and value is None:
                continue
            if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"Invalid drive measurement {key}")
        if sample["timeS"] < previous:
            raise ValueError("Drive measurement time must be nondecreasing")
        previous = sample["timeS"]
    _validate_cell_identity(trace)
    evidence = trace.get("evidence")
    # Preserve the existing source contract for legacy captures without new recipes.
    if evidence is None:
        return
    if not isinstance(evidence, dict) or evidence.get("schemaVersion") not in (1, 2):
        raise ValueError("Invalid drive evidence version")
    if evidence["schemaVersion"] == 1:
        return
    if not nullable or evidence.get("origin") not in ("unknown", "synthetic", "field-measured") or evidence.get("verification") != "unverified" or evidence.get("coordinateReference") != "EPSG:4326":
        raise ValueError("Invalid normalized drive evidence status")
    raw, transforms = evidence.get("rawCsv"), evidence.get("transformations")
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > 1_000_000:
        raise ValueError("Invalid drive source CSV")
    if not isinstance(transforms, list) or len(transforms) != 1 or not isinstance(transforms[0], dict) or set(transforms[0]) != {"type", "version", "mapping"} or transforms[0]["type"] != "mapped-gps-csv-parse" or type(transforms[0]["version"]) is not int or transforms[0]["version"] != 2:
        raise ValueError("Invalid drive source mapping recipe")
    sha = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    normalized = hashlib.sha256(json.dumps({"sourceSha256": sha, "transformations": transforms}, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
    if evidence.get("sha256") != sha or evidence.get("normalizationSha256") != normalized or evidence.get("datasetId") != f"sha256-{normalized}":
        raise ValueError("Drive source or normalization digest does not match")
    try:
        acquired = evidence.get("sourceDate")
        imported = datetime.fromisoformat(evidence["importedAt"].replace("Z", "+00:00"))
        if acquired is not None and (date.fromisoformat(acquired).isoformat() != acquired or acquired > imported.date().isoformat()):
            raise ValueError("Invalid drive source date")
    except (KeyError, TypeError, AttributeError, ValueError) as exc:
        raise ValueError("Invalid drive source date") from exc
    if evidence["origin"] != "synthetic" and (re.search(r"synthetic(?:[-_ ]|$)", raw, re.I) or re.search(r"synthetic(?:[-_ .]|$)", trace["fileName"], re.I)):
        raise ValueError("Drive origin conflicts with synthetic source evidence")
    _replay(trace, raw, transforms[0]["mapping"])


def _replay(trace, raw, mapping):
    try:
        rows = [row for row in csv.reader(io.StringIO(raw, newline=""), strict=True) if any(value.strip() for value in row)]
    except csv.Error as exc:
        raise ValueError("Invalid drive CSV quoting") from exc
    if not rows:
        raise ValueError("Drive CSV requires a header")
    headers = [(value.lstrip("\ufeff") if index == 0 else value).strip() for index, value in enumerate(rows.pop(0))]
    if not 1 <= len(headers) <= 512 or len(set(headers)) != len(headers) or any(not value or len(value) > 120 or re.search(r"[\x00-\x1f]", value) for value in headers):
        raise ValueError("Invalid drive CSV headers")
    if not isinstance(mapping, dict) or set(mapping) != set(FIELDS):
        raise ValueError("Invalid drive CSV field mapping")
    used = set()
    for field, entry in mapping.items():
        if not isinstance(entry, dict) or set(entry) != {"column", "unit"} or entry["unit"] not in FIELDS[field][1]:
            raise ValueError("Invalid drive CSV unit mapping")
        column = entry["column"]
        if column is not None:
            if not isinstance(column, str) or column not in headers or column in used:
                raise ValueError("Invalid or duplicate drive CSV source column mapping")
            used.add(column)
    if any(mapping[field]["column"] is None for field in ("time_s", "technology", "serving_cell", "latitude", "longitude")) or len(rows) != len(trace["samples"]):
        raise ValueError("Drive GPS mapping requires source coordinates and matching rows")
    for index, values in enumerate(rows):
        if len(values) != len(headers):
            raise ValueError("Drive CSV row column count mismatch")
        source = dict(zip(headers, values))
        record = {field: source[entry["column"]].strip() if entry["column"] is not None else None for field, entry in mapping.items()}
        expected = {"index": index, "provenance": "imported-unverified", "technology": {"4G": "LTE", "LTE": "LTE", "5G": "NR", "NR": "NR"}.get((record["technology"] or "").upper()), "servingCell": record["serving_cell"], "event": record["event"] or ""}
        for field, (key, _, low, high) in FIELDS.items():
            if low is None:
                continue
            if field in ("x_pct", "y_pct") and not all(mapping[f]["column"] for f in ("x_pct", "y_pct")):
                continue
            value = record[field]
            if field in KPI_FIELDS and (value is None or value.upper() in ("", "NA", "N/A", "NULL")):
                expected[key] = None
                continue
            if value is None or not NUMERIC.fullmatch(value):
                raise ValueError(f"Invalid drive source number {field}")
            value = float(value) * {"ms": .001, "kbps": .001, "bps": .000001}.get(mapping[field]["unit"], 1)
            if not math.isfinite(value) or not low <= value <= high:
                raise ValueError(f"Drive source {field} outside bounds")
            if field not in ("x_pct", "y_pct"):
                expected[key] = value
        if expected != trace["samples"][index]:
            raise ValueError("Drive normalized samples do not match the retained source mapping")
