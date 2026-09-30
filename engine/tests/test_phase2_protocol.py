"""Actual 2D worker/persistence integration and independently defined comparisons."""

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
from phyra_engine.fem2d import generate_rectangle, solve_mesh
from phyra_engine.protocol import validate_cached
from phyra_engine.protocol2d import comparison_metric, write_output
from phyra_engine.validation import migrate_project, validate_project

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def plane_project():
    return json.loads((ROOT / "examples/plane-stress-tension.json").read_text())


@pytest.fixture
def plane_result(plane_project, tmp_path):
    geometry, study = plane_project["geometry"], plane_project["study"]
    mesh = generate_rectangle(
        geometry["length"], geometry["width"], study["thickness"], study["mesh"]["size"]
    )
    result = solve_mesh(mesh, study)
    manifest = write_output(tmp_path, plane_project, "plane-run", "solve", mesh, result)
    return manifest, (tmp_path / "buffer.bin").read_bytes()


def test_plane_result_safe_roundtrip(plane_project, plane_result):
    manifest, blob = plane_result
    assert validate_cached(plane_project, manifest, blob) == manifest
    assert manifest["arrays"]["cells"]["shape"][1] == 3
    assert manifest["statistics"]["nodes"] == 66
    assert manifest["statistics"]["cells"] == 100
    assert manifest["summary"]["relativeForceBalance"] < 1e-12
    assert np.isclose(manifest["summary"]["maxVonMises"], 1e6, rtol=1e-12)


@pytest.mark.parametrize("defect", ["thickness", "edge-region", "shape", "comparison", "history"])
def test_plane_cache_rejects_malformed_or_stale(plane_project, plane_result, defect):
    manifest, blob = plane_result
    manifest = deepcopy(manifest)
    if defect == "thickness":
        plane_project["study"]["thickness"] *= 2
    elif defect == "edge-region":
        corrupt = bytearray(blob)
        offset = manifest["arrays"]["edgeRegions"]["offset"]
        corrupt[offset : offset + 4] = np.array([1], dtype="<u4").tobytes()
        blob = bytes(corrupt)
        manifest["bufferHash"] = hashlib.sha256(blob).hexdigest()
    elif defect == "shape":
        manifest["arrays"]["cells"]["shape"][1] = 4
    elif defect == "comparison":
        manifest["operation"] = "compare"
    else:
        manifest["operation"] = "train"
    with pytest.raises(EngineError):
        validate_cached(plane_project, manifest, blob)


def test_comparison_uses_exact_vector_norm_and_defined_zero_reference():
    reference = np.array([[0.0, 0.0], [3.0, 4.0]])
    prediction = np.array([[0.0, 0.0], [6.0, 8.0]])
    assert comparison_metric(reference, prediction) == {
        "relativeL2": 1.0,
        "maxAbsolute": 5.0,
        "referenceNorm": 5.0,
    }
    assert comparison_metric(np.zeros(3), np.ones(3))["relativeL2"] is None


def test_comparison_metadata_is_independent_of_binary_alignment_and_array_layout():
    random = np.random.default_rng(81)
    reference = random.normal(size=(200, 6)) * np.geomspace(1e-8, 1e8, 6)
    prediction = reference + random.normal(size=(200, 6)) * np.geomspace(1e-8, 1e8, 6)
    expected = comparison_metric(reference, prediction)
    for padding in (0, 8, 16, 24):
        blob = (
            bytearray(padding)
            + reference.astype("<f8").tobytes()
            + prediction.astype("<f8").tobytes()
        )
        restored_reference = np.frombuffer(
            blob, dtype="<f8", count=reference.size, offset=padding
        ).reshape(reference.shape)
        restored_prediction = np.frombuffer(
            blob, dtype="<f8", count=prediction.size, offset=padding + reference.nbytes
        ).reshape(prediction.shape)
        assert comparison_metric(restored_reference, restored_prediction) == expected
    assert (
        comparison_metric(np.asfortranarray(reference), np.asfortranarray(prediction)) == expected
    )


def test_legacy_migration_is_explicit_and_preserves_original(project):
    upgraded = migrate_project(project)
    assert project["schemaVersion"] == 1
    assert upgraded["schemaVersion"] == 2
    assert upgraded["geometry"] == project["geometry"]
    assert upgraded["study"]["constraints"] == project["study"]["constraints"]
    assert upgraded["study"]["formulation"] == "solid"
    assert upgraded["study"]["solver"]["kind"] == "fem"
    assert validate_project(upgraded) == upgraded


@pytest.mark.parametrize("edit", ["dimension", "z-support", "z-load", "too-fine"])
def test_plane_inputs_reject_unsupported_or_oversized_edits(plane_project, edit):
    if edit == "dimension":
        plane_project["study"]["formulation"] = "solid"
    elif edit == "z-support":
        plane_project["study"]["constraints"][0]["components"][2] = 0
    elif edit == "z-load":
        plane_project["study"]["loads"][0]["vector"][2] = 1
    else:
        plane_project["study"]["mesh"]["size"] = 1e-100
    with pytest.raises(EngineError):
        validate_project(plane_project)


def test_real_worker_train_metrics_result_and_cache(plane_project, tmp_path):
    config = plane_project["study"]["solver"]["pinn"]
    config.update(layers=1, width=8, steps=4, interiorPoints=8, boundaryPoints=4, device="cpu")
    env = {
        k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV")
    }

    def worker(operation):
        request = {
            "protocolVersion": 1,
            "operation": operation,
            "jobId": "pinn-worker",
            "project": plane_project,
        }
        process = subprocess.run(
            [sys.executable, str(ROOT / "engine/entry.py"), "--output", str(tmp_path)],
            input=json.dumps(request).encode(),
            capture_output=True,
            cwd=tmp_path,
            env=env,
            timeout=60,
        )
        messages = [json.loads(line) for line in process.stdout.splitlines()]
        assert process.returncode == 0, (messages, process.stderr)
        return messages

    messages = worker("train")
    measurements = [v for v in messages if v["type"] == "metrics"]
    assert measurements and measurements[-1]["step"] == 4
    manifest = messages[-1]["manifest"]
    assert manifest["training"]["configuration"] == config
    assert manifest["training"]["device"] == "cpu"
    assert manifest["summary"]["maxDisplacement"] > 0
    assert (
        validate_cached(plane_project, manifest, (tmp_path / "buffer.bin").read_bytes()) == manifest
    )
    assert worker("validate")[-1]["manifest"] == manifest


@pytest.mark.parametrize(
    "field,value",
    [
        ("statistics", []),
        ("versions", []),
        ("warnings", 0),
        ("protocolVersion", True),
        ("solver", "pinn"),
        ("device", "mps"),
        ("startedAt", "2026-01-01"),
        ("startedAt", None),
        ("summary", []),
        ("durationSeconds", True),
    ],
)
def test_cached_metadata_types_and_run_identity_are_strict(
    plane_project, plane_result, field, value
):
    manifest, blob = plane_result
    corrupted = deepcopy(manifest)
    corrupted[field] = value
    with pytest.raises(EngineError):
        validate_cached(plane_project, corrupted, blob)


@pytest.mark.parametrize(
    "field",
    ["forceBalance", "momentBalance", "relativeForceBalance", "relativeResidual", "strainEnergy"],
)
def test_cached_fem_diagnostics_are_reconstructed(plane_project, plane_result, field):
    manifest, blob = plane_result
    corrupted = deepcopy(manifest)
    if field in ("forceBalance", "momentBalance"):
        corrupted["summary"][field][0 if field == "forceBalance" else 2] += 1
    else:
        corrupted["summary"][field] += 1
    with pytest.raises(EngineError):
        validate_cached(plane_project, corrupted, blob)


@pytest.mark.parametrize(
    "field,component", [("displacement", 2), ("stress", 2), ("reactions", 2), ("vonMises", 0)]
)
def test_plane_fields_cannot_publish_out_of_plane_or_inconsistent_values(
    plane_project, plane_result, field, component
):
    manifest, blob = plane_result
    corrupted = deepcopy(manifest)
    altered = bytearray(blob)
    offset = manifest["arrays"][field]["offset"] + component * 8
    altered[offset : offset + 8] = np.array([1.0], dtype="<f8").tobytes()
    altered = bytes(altered)
    corrupted["bufferHash"] = hashlib.sha256(altered).hexdigest()
    with pytest.raises(EngineError):
        validate_cached(plane_project, corrupted, altered)


@pytest.fixture(scope="module")
def measured_comparison(tmp_path_factory):
    project = json.loads((ROOT / "examples/plane-stress-tension.json").read_text())
    project["study"]["solver"]["pinn"].update(
        layers=1, width=8, steps=4, interiorPoints=8, boundaryPoints=4, device="cpu"
    )
    directory = tmp_path_factory.mktemp("measured-comparison")
    request = {
        "protocolVersion": 1,
        "operation": "compare",
        "jobId": "actual-compare",
        "project": project,
    }
    process = subprocess.run(
        [sys.executable, str(ROOT / "engine/entry.py"), "--output", str(directory)],
        input=json.dumps(request).encode(),
        capture_output=True,
        cwd=directory,
        timeout=60,
    )
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    assert process.returncode == 0, (messages, process.stderr)
    manifest = messages[-1]["manifest"]
    return project, manifest, (directory / "buffer.bin").read_bytes()


def test_comparison_retains_measured_neural_equilibrium_and_actual_duration(measured_comparison):
    project, manifest, blob = measured_comparison
    assert validate_cached(project, manifest, blob) == manifest
    assert manifest["pinnSummary"]["relativeResidual"] == np.sqrt(
        manifest["training"]["history"][-1]["pde"]
    )
    assert (
        manifest["durationSeconds"]
        >= sum(manifest["training"]["timings"].values()) + manifest["summary"]["elapsedSeconds"]
    )
    assert manifest["comparison"]["device"] == manifest["training"]["device"] == "cpu"


@pytest.mark.parametrize(
    "defect",
    [
        "training-type",
        "timings-type",
        "normalization-type",
        "framework",
        "framework-version",
        "device",
        "precision",
        "history-elapsed",
        "history-first",
        "history-count",
        "history-bool",
        "configuration-type",
        "normalization",
        "pinn-summary",
        "pinn-force",
        "pinn-residual",
        "comparison-type",
        "mapping",
        "comparison-time",
        "duration",
    ],
)
def test_comparison_rejects_malformed_training_and_forged_provenance(measured_comparison, defect):
    project, original, blob = measured_comparison
    manifest = deepcopy(original)
    training = manifest["training"]
    if defect == "training-type":
        manifest["training"] = []
    elif defect == "timings-type":
        training["timings"] = []
    elif defect == "normalization-type":
        training["normalization"] = []
    elif defect == "framework":
        training["framework"] = "invented"
    elif defect == "framework-version":
        training["frameworkVersion"] = False
    elif defect == "device":
        manifest["device"] = "mps"
    elif defect == "precision":
        training["precision"] = "float32"
    elif defect == "history-elapsed":
        training["history"][-1]["elapsed"] = 0
    elif defect == "history-first":
        training["history"][0]["step"] = 1
    elif defect == "history-count":
        training["history"].pop(1)
    elif defect == "history-bool":
        training["history"][1]["step"] = True
    elif defect == "configuration-type":
        training["configuration"]["layers"] = True
    elif defect == "normalization":
        training["normalization"]["displacement"] *= 2
    elif defect == "pinn-summary":
        manifest["pinnSummary"] = []
    elif defect == "pinn-force":
        manifest["pinnSummary"]["forceBalance"][0] += 1
    elif defect == "pinn-residual":
        manifest["pinnSummary"]["relativeResidual"] += 1
    elif defect == "comparison-type":
        manifest["comparison"] = []
    elif defect == "mapping":
        manifest["comparison"]["mapping"] = "interpolated"
    elif defect == "comparison-time":
        manifest["comparison"]["trainingSeconds"] += 1
    else:
        manifest["durationSeconds"] = 0
    with pytest.raises(EngineError):
        validate_cached(project, manifest, blob)


def test_device_worker_uses_the_owned_manifest_completion_contract(plane_project, tmp_path):
    request = {
        "protocolVersion": 1,
        "operation": "devices",
        "jobId": "device-probe",
        "project": plane_project,
    }
    process = subprocess.run(
        [sys.executable, str(ROOT / "engine/entry.py"), "--output", str(tmp_path)],
        input=json.dumps(request).encode(),
        capture_output=True,
        cwd=tmp_path,
        timeout=60,
    )
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    assert process.returncode == 0, (messages, process.stderr)
    assert set(messages[-1]) == {"type", "manifest"}
    manifest = messages[-1]["manifest"]
    assert manifest["operation"] == "devices" and manifest["jobId"] == "device-probe"
    assert (
        manifest["projectId"] == plane_project["id"]
        and manifest["studyId"] == plane_project["study"]["id"]
    )
    assert manifest["status"] == "succeeded" and manifest["defaultDevice"] == "cpu"
    assert any(device["id"] == "cpu" and device["available"] for device in manifest["devices"])
    assert not (tmp_path / "buffer.bin").exists()


def test_classical_worker_records_actual_run_metadata(project, tmp_path):
    request = {
        "protocolVersion": 1,
        "operation": "solve",
        "jobId": "classical-run",
        "project": project,
    }
    process = subprocess.run(
        [sys.executable, str(ROOT / "engine/entry.py"), "--output", str(tmp_path)],
        input=json.dumps(request).encode(),
        capture_output=True,
        cwd=tmp_path,
        timeout=60,
    )
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    assert process.returncode == 0, (messages, process.stderr)
    manifest = messages[-1]["manifest"]
    assert {
        key: manifest[key] for key in ("dimension", "formulation", "cellType", "solver", "device")
    } == {
        "dimension": "3d",
        "formulation": "solid",
        "cellType": "tetra4",
        "solver": "fem",
        "device": "cpu",
    }
    assert manifest["durationSeconds"] >= manifest["summary"]["elapsedSeconds"]
    assert manifest["startedAt"].endswith("+00:00")
    assert validate_cached(project, manifest, (tmp_path / "buffer.bin").read_bytes()) == manifest


@pytest.mark.parametrize(
    "edit", ["subnormal-size", "subnormal-domain", "fractional-steps", "deep-metadata"]
)
def test_preflight_rejects_unbounded_or_noncanonical_work(plane_project, edit):
    if edit == "subnormal-size":
        plane_project["study"]["mesh"]["size"] = 1e-320
    elif edit == "subnormal-domain":
        plane_project["geometry"].update(length=1e-320, width=1e-320)
    elif edit == "fractional-steps":
        plane_project["study"]["solver"]["pinn"]["steps"] = 1000.0
    else:
        nested = 0
        for _ in range(70):
            nested = [nested]
        plane_project["extra"] = nested
    with pytest.raises(EngineError):
        validate_project(plane_project)
