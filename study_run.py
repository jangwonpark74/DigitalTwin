"""Verify JS-prepared path inputs against an atomically read saved project."""
import copy
import hashlib
import json
import re
from datetime import datetime
from study_storage import validate_study

PATH_SOLVER_PROFILE = {"engine": "sionna-rt", "profileVersion": 1, "seed": 42,
                       "antenna": "isotropic-single-element-v", "buildingMaterial": "concrete", "groundMaterial": "concrete",
                       "buildingThicknessM": 0.2, "groundThicknessM": 0.1, "syntheticArray": True, "los": True,
                       "diffuseReflection": False, "refraction": False, "maxPathsPerSource": 1000,
                       "retainedPaths": 200, "maxRuntimeSeconds": 180}
JOB_KEYS = {"map", "scene", "siteId", "transmitter", "receiver", "frequencyGhz", "samplesPerSrc", "maxDepth", "reflections", "diffraction"}
HEADER_KEYS = {"schemaVersion", "kind", "preparedAt", "reference", "definitionVersion", "baselineSha256", "candidateSha256",
               "networkInputSha256", "jobSha256", "datasetSha256", "datasetOrigin", "solverProfile"}


def capture_header(capture):
    return {key: copy.deepcopy(value) for key, value in capture.items() if key in HEADER_KEYS}


def _hashed_json(capture, source_key, hash_key):
    source = capture.get(source_key)
    if not isinstance(source, str) or hashlib.sha256(source.encode("utf-8")).hexdigest() != capture.get(hash_key):
        raise ValueError("Run input digest does not match the captured content")
    value = json.loads(source)
    if not isinstance(value, dict):
        raise ValueError("Run capture payload must be an object")
    return value


def _engineering(project):
    inputs = {key: copy.deepcopy(project.get(key)) for key in ("map", "sites", "channel", "ue", "architecture", "driveMeasurements")}
    if not isinstance(inputs["map"], dict) or not isinstance(inputs["channel"], dict) or not isinstance(inputs["sites"], list):
        raise ValueError("Saved project cannot supply bounded engineering inputs")
    for key in ("geometryValidated", "materialAssigned", "coordinateAligned"):
        inputs["map"].pop(key, None)
    inputs["channel"].pop("execution", None)
    return inputs


def _object_value_json(source, field):
    """Retain the exact JS-encoded value bytes, including its number/string spelling."""
    decoder = json.JSONDecoder()
    offset = 1
    while offset < len(source):
        while source[offset].isspace() or source[offset] == ",":
            offset += 1
        if source[offset] == "}":
            break
        key, offset = decoder.raw_decode(source, offset)
        while source[offset].isspace():
            offset += 1
        if source[offset] != ":":
            raise ValueError("Invalid network capture JSON")
        offset += 1
        while source[offset].isspace():
            offset += 1
        start = offset
        _, offset = decoder.raw_decode(source, offset)
        if key == field:
            return source[start:offset]
    raise ValueError("Missing captured dataset field")


def validate_run_capture(project, job):
    capture = job.get("runCapture")
    if capture is None:
        return  # Legacy requests have no frozen-input claim.
    if (not isinstance(capture, dict) or set(capture) != HEADER_KEYS | {"networkInputJson", "jobJson"} or
            type(capture.get("schemaVersion")) is not int or capture["schemaVersion"] != 1 or capture.get("kind") != "ran-path-input" or
            not isinstance(capture.get("solverProfile"), dict) or set(capture["solverProfile"]) != set(PATH_SOLVER_PROFILE) or
            any(type(capture["solverProfile"][key]) is not type(value) or capture["solverProfile"][key] != value for key, value in PATH_SOLVER_PROFILE.items()) or
            not isinstance(capture.get("preparedAt"), str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})", capture["preparedAt"])):
        raise ValueError("Unsupported run capture contract / solver profile")
    if capture["definitionVersion"] is not None and (type(capture["definitionVersion"]) is not int or capture["definitionVersion"] < 1):
        raise ValueError("Invalid run capture definition version")
    datetime.fromisoformat(capture["preparedAt"].replace("Z", "+00:00"))
    network = _hashed_json(capture, "networkInputJson", "networkInputSha256")
    frozen_job = _hashed_json(capture, "jobJson", "jobSha256")
    actual_job = {key: value for key, value in job.items() if key not in ("projectId", "runCapture")}
    if set(actual_job) != JOB_KEYS or actual_job != frozen_job:
        raise ValueError("Submitted job does not match its captured job settings")
    ref = capture.get("reference")
    if not isinstance(ref, dict):
        raise ValueError("Invalid run capture reference")
    reference_keys = {"kind"} if ref.get("kind") == "working" else {"kind", "baselineId"} if ref.get("kind") == "baseline" else {"kind", "baselineId", "candidateId", "version"}
    if (set(ref) != reference_keys or ref.get("kind") not in ("working", "baseline", "candidate") or
            any(not isinstance(ref[key], str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,80}", ref[key]) for key in ("baselineId", "candidateId") if key in ref) or
            "version" in ref and (type(ref["version"]) is not int or ref["version"] < 1)):
        raise ValueError("Invalid run capture reference")
    study = project.get("study")
    definition_version, baseline_sha, candidate_sha = None, None, None
    if ref.get("kind") == "working":
        inputs = _engineering(project)
        definition_version = study["definitions"][-1]["version"] if study else None
    elif ref.get("kind") in ("baseline", "candidate"):
        validate_study(study)
        baseline = next((item for item in (study or {}).get("baselines", []) if item["id"] == ref.get("baselineId")), None)
        if not baseline:
            raise ValueError("Captured baseline is not available in this project")
        value = json.loads(baseline["inputJson"])
        inputs = value["inputs"]
        baseline_sha, definition_version = baseline["sha256"], value["definition"]["version"]
        if ref["kind"] == "candidate":
            candidate = next((item for item in study["candidates"] if item["id"] == ref.get("candidateId") and item["baselineId"] == baseline["id"]), None)
            revision = next((item for item in (candidate or {}).get("versions", []) if item["version"] == ref.get("version")), None)
            if revision is None:
                raise ValueError("Captured candidate revision is not available in this project")
            candidate_sha = revision["sha256"]
            for change in json.loads(revision["inputJson"])["changes"]:
                if change["field"] != "heightM":
                    raise ValueError(f"The isotropic path solver cannot apply {change['field']}")
                if change["siteId"] != job["siteId"]:
                    raise ValueError(f"This path job cannot evaluate another transmitter {change['siteId']}")
                next(site for site in inputs["sites"] if site["id"] == change["siteId"])["heightM"] = change["after"]
    else:
        raise ValueError("Invalid run capture reference")
    if inputs != network or capture.get("definitionVersion") != definition_version:
        raise ValueError("Saved network / study inputs changed during run preparation")
    if capture.get("baselineSha256") != baseline_sha or capture.get("candidateSha256") != candidate_sha:
        raise ValueError("Captured baseline / candidate content identity changed")
    site = next((site for site in inputs["sites"] if site["id"] == job["siteId"]), None)
    if site is None:
        raise ValueError("Captured transmitter site is unavailable")
    tx = {key: site["radioLocation"][key] for key in ("latitude", "longitude")}
    tx["heightM"] = site["heightM"]
    scope = {key: inputs["map"][key] for key in ("latitude", "longitude", "radiusMeters")}
    if (job["transmitter"] != tx or job["map"] != scope or job["scene"] != inputs["map"]["scene"] or
            job["reflections"] != bool(inputs["channel"]["reflections"]) or job["diffraction"] != bool(inputs["channel"]["diffraction"])):
        raise ValueError("Job geometry / transmitter does not match the captured network")
    dataset = inputs["driveMeasurements"]
    origin = ((dataset or {}).get("evidence") or {}).get("origin")
    if origin is None:
        origin = "synthetic" if dataset and re.search(r"synthetic(?:[-_ .]|$)", dataset.get("fileName", ""), re.I) else "unknown" if dataset else "none"
    if capture.get("datasetOrigin") != origin:
        raise ValueError("Captured dataset origin does not match its source")
    if dataset is None and capture.get("datasetSha256") is not None:
        raise ValueError("Captured dataset identity does not match the empty source")
    if dataset is not None and hashlib.sha256(_object_value_json(capture["networkInputJson"], "driveMeasurements").encode("utf-8")).hexdigest() != capture.get("datasetSha256"):
        raise ValueError("Captured dataset digest does not match the saved source")


def validate_retry_capture(project, job):
    """Revalidate a retained request, without substituting newer working inputs."""
    capture = job.get("runCapture")
    if not isinstance(capture, dict):
        raise ValueError("Exact retry requires a retained frozen input capture")
    if (capture.get("reference") or {}).get("kind") == "working":
        frozen = _hashed_json(capture, "networkInputJson", "networkInputSha256")
        definition_version = capture.get("definitionVersion")
        if definition_version is not None:
            definition = next((item for item in (project.get("study") or {}).get("definitions", [])
                               if type(definition_version) is int and item["version"] == definition_version), None)
            if definition is None:
                raise ValueError("The retained study definition is unavailable for exact retry")
            frozen["study"] = {"definitions": [definition]}
        validate_run_capture(frozen, job)
    else:
        validate_run_capture(project, job)
