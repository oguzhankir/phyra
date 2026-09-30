"""Strict persistence/bulk-buffer checks and the one-request worker boundary."""

import hashlib
import json
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.meshing.solid import generate_mesh
from phyra_engine.methods.classical.solid import solve_mesh
from phyra_engine.results import validate_cached
from phyra_engine.results.solid import write_output


@pytest.fixture
def solved(project, tmp_path):
    mesh = generate_mesh(project)
    result = solve_mesh(mesh, project["study"])
    manifest = write_output(tmp_path, project, "verification-job", "solve", mesh, result)
    return manifest, (tmp_path / "buffer.bin").read_bytes()


def test_real_solve_binary_roundtrip(project, solved):
    manifest, blob = solved
    assert validate_cached(project, manifest, blob) == manifest
    assert manifest["projectId"] == project["id"]
    assert manifest["studyId"] == project["study"]["id"]
    assert manifest["revision"] == project["revision"]
    assert manifest["jobId"] == "verification-job"
    for descriptor in manifest["arrays"].values():
        assert descriptor["offset"] % 8 == 0
        assert descriptor["offset"] + descriptor["byteLength"] <= len(blob)


def test_presentation_edits_do_not_stale_physical_cache(project, solved):
    manifest, blob = solved
    project.update(displayUnits="m", revision=12, name="Renamed")
    assert validate_cached(project, manifest, blob) == manifest


def test_physical_edits_reject_cached_output(project, solved):
    manifest, blob = solved
    project["study"]["loads"][0]["vector"][2] *= 2
    with pytest.raises(EngineError) as error:
        validate_cached(project, manifest, blob)
    assert error.value.code == "stale-cache"


@pytest.mark.parametrize(
    "defect",
    [
        "offset",
        "overlap",
        "shape",
        "float-shape",
        "dtype",
        "units",
        "length",
        "summary",
        "identity",
        "regions",
    ],
)
def test_malformed_cache_metadata_is_rejected(project, solved, defect):
    manifest, blob = solved
    manifest = deepcopy(manifest)
    descriptor = manifest["arrays"]["positions"]
    if defect == "offset":
        descriptor["offset"] = 1
    elif defect == "overlap":
        manifest["arrays"]["displacement"]["offset"] = descriptor["offset"]
    elif defect == "shape":
        descriptor["shape"] = [len(blob), 3]
    elif defect == "float-shape":
        descriptor["shape"][0] = float(descriptor["shape"][0])
    elif defect == "dtype":
        descriptor["dtype"] = "float32"
    elif defect == "units":
        descriptor["units"] = "mm"
    elif defect == "length":
        manifest["byteLength"] -= 1
    elif defect == "summary":
        manifest["summary"]["maxDisplacement"] *= 2
    elif defect == "identity":
        manifest["projectId"] = "different-project"
    else:
        manifest["regions"][0]["area"] *= 2
    with pytest.raises(EngineError):
        validate_cached(project, manifest, blob)


def test_corrupt_payload_is_rejected(project, solved):
    manifest, blob = solved
    corrupt = bytearray(blob)
    corrupt[-1] ^= 1
    with pytest.raises(EngineError) as error:
        validate_cached(project, manifest, bytes(corrupt))
    assert error.value.code == "corrupt-cache"


def test_nonfinite_array_is_rejected_even_with_matching_hash(project, solved):
    manifest, blob = solved
    corrupt = bytearray(blob)
    offset = manifest["arrays"]["displacement"]["offset"]
    corrupt[offset : offset + 8] = np.array([np.nan], dtype="<f8").tobytes()
    manifest = deepcopy(manifest)
    manifest["bufferHash"] = hashlib.sha256(corrupt).hexdigest()
    with pytest.raises(EngineError) as error:
        validate_cached(project, manifest, bytes(corrupt))
    assert error.value.code == "invalid-cache"


def invoke_worker(tmp_path, payload):
    worker = Path(__file__).resolve().parents[1] / "entry.py"
    environment = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    process = subprocess.run(
        [sys.executable, str(worker), "--output", str(tmp_path)],
        input=payload,
        capture_output=True,
        cwd=tmp_path,
        env=environment,
        timeout=30,
    )
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    return process, messages


def test_worker_real_solve_and_protocol_framing(project, tmp_path):
    request = {
        "protocolVersion": 1,
        "operation": "solve",
        "jobId": "protocol-job",
        "project": project,
    }
    process, messages = invoke_worker(tmp_path, json.dumps(request).encode())
    assert process.returncode == 0, process.stderr
    assert messages[-1]["type"] == "complete", messages
    assert messages[-1]["manifest"]["jobId"] == "protocol-job"
    assert all(message["type"] in ("progress", "complete") for message in messages)
    assert (tmp_path / "manifest.json").is_file()
    assert (tmp_path / "buffer.bin").is_file()


def test_worker_unicode_roundtrip_with_cp1252_inherited_stdio(project, tmp_path):
    """Exercise Windows pipe encoding, Unicode paths and real result persistence."""
    worker = Path(__file__).resolve().parents[1] / "entry.py"
    directory = tmp_path / "work-\u00e7al\u0131\u015fma-\u0394"
    project["id"] = "project-\u00e7al\u0131\u015fma"
    project["name"] = "\u00c7al\u0131\u015fma \u2192 Physics ML"
    request = {
        "protocolVersion": 1,
        "operation": "solve",
        "jobId": "unicode-protocol-job",
        "project": project,
    }
    environment = {key: value for key, value in os.environ.items() if key != "PYTHONPATH"}
    environment.update(PYTHONUTF8="0", PYTHONIOENCODING="cp1252")
    # The wrapper adds only text probes after the actual worker finishes; it
    # cannot fabricate a numerical result or change the worker's request.
    bootstrap = """
import json, runpy, sys
from pathlib import Path
assert sys.stdout.encoding.lower() == "cp1252"
assert sys.stderr.encoding.lower() == "cp1252"
worker, directory = sys.argv[1:]
sys.path.insert(0, str(Path(worker).parent))
entry = runpy.run_path(worker, run_name="encoding_probe")
sys.argv = [worker, "--output", directory]
code = entry["main"]()
probe = "\\u00c7al\\u0131\\u015fma \\u2192 Physics ML"
print(json.dumps({"textProbe": probe}, ensure_ascii=False), flush=True)
print(probe, file=sys.stderr, flush=True)
raise SystemExit(code)
"""
    process = subprocess.run(
        [sys.executable, "-c", bootstrap, str(worker), str(directory)],
        input=json.dumps(request, ensure_ascii=False).encode("utf-8"),
        capture_output=True,
        cwd=tmp_path,
        env=environment,
        timeout=30,
    )
    assert process.returncode == 0, process.stderr
    messages = [json.loads(line) for line in process.stdout.decode("utf-8").splitlines()]
    assert messages[-1] == {"textProbe": project["name"]}
    assert project["name"] in process.stderr.decode("utf-8")
    assert all(message["type"] in ("progress", "complete") for message in messages[:-1])
    manifest = messages[-2]["manifest"]
    assert manifest["projectId"] == project["id"]
    assert manifest["jobId"] == request["jobId"]
    stored = json.loads((directory / "manifest.json").read_bytes())
    assert stored == manifest
    assert validate_cached(project, stored, (directory / "buffer.bin").read_bytes()) == manifest


@pytest.mark.parametrize(
    "payload",
    [b"{}", b"not-json", b'{"protocolVersion":NaN}', b"x" * (1024 * 1024 + 1)],
    ids=["empty", "syntax", "nonfinite", "oversize"],
)
def test_worker_malformed_request_is_structured_failure(tmp_path, payload):
    process, messages = invoke_worker(tmp_path, payload)
    assert process.returncode != 0
    assert messages[-1]["type"] == "error"
    assert isinstance(messages[-1]["code"], str)
    assert not (tmp_path / "manifest.json").exists()


def test_worker_underconstrained_failure_is_not_a_result(project, tmp_path):
    project["study"]["constraints"] = []
    request = {
        "protocolVersion": 1,
        "operation": "solve",
        "jobId": "unsupported-job",
        "project": project,
    }
    process, messages = invoke_worker(tmp_path, json.dumps(request).encode())
    assert process.returncode != 0
    assert messages[-1]["type"] == "error"
    assert messages[-1]["code"] == "under-constrained"
    assert not (tmp_path / "manifest.json").exists()
