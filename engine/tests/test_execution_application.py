"""Headless application ownership, preflight and publication failure boundaries."""

import json
from copy import deepcopy
from dataclasses import FrozenInstanceError
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.execution import application
from phyra_engine.execution.application import RunPlan, execute
from phyra_engine.protocol.request import StudyRequest
from phyra_engine.results import validate_cached
from phyra_engine.results.storage import _read_bounded, read_cached
from phyra_engine.studies.project import fingerprint

ROOT = Path(__file__).resolve().parents[2]


def request(project, operation="solve"):
    return StudyRequest.from_payload(
        {
            "protocolVersion": 1,
            "jobId": "application-job",
            "operation": operation,
            "project": project,
        }
    )


@pytest.fixture
def plane():
    definition = json.loads((ROOT / "examples/plane-stress-tension.json").read_text())
    definition["study"]["mesh"]["size"] = 0.05
    definition["study"]["solver"]["kind"] = "fem"
    definition["study"]["solver"]["pinn"].update(
        layers=1, width=8, steps=1, interiorPoints=8, boundaryPoints=4, device="cpu"
    )
    return definition


def test_validated_request_snapshot_cannot_be_changed_by_callers(project):
    expected = deepcopy(project)
    snapshot = request(project)
    project["study"]["material"]["young"] *= 2
    decoded = snapshot.project_definition()
    decoded["geometry"]["length"] *= 3
    assert snapshot.project_definition() == expected
    assert fingerprint(snapshot.project_definition()) == fingerprint(expected)
    with pytest.raises(FrozenInstanceError):
        snapshot.job_id = "different-job"


def test_request_rejects_invalid_physical_inputs_before_snapshot(project):
    project["study"]["constraints"][0]["components"] = [None, None, None]
    with pytest.raises(EngineError) as error:
        request(project)
    assert error.value.code == "empty-constraint"


@pytest.mark.parametrize("missing", [True, False])
def test_headless_request_enforces_the_same_envelope_as_stdio(project, missing):
    payload = {
        "protocolVersion": 1,
        "jobId": "application-job",
        "operation": "solve",
        "project": project,
    }
    if missing:
        del payload["operation"]
    else:
        payload["executable"] = "/untrusted/path"
    with pytest.raises(EngineError) as error:
        StudyRequest.from_payload(payload)
    assert error.value.code == "invalid-request"


def test_plan_rejects_unsupported_method_before_meshing(project, tmp_path, monkeypatch):
    def fail_if_meshed(*args, **kwargs):
        raise AssertionError("Unsupported methods must be rejected before mesh allocation.")

    monkeypatch.setattr(application, "generate_study_mesh", fail_if_meshed)
    with pytest.raises(EngineError) as error:
        execute(RunPlan.prepare(request(project, "train")), tmp_path)
    assert error.value.code == "unsupported-study"
    assert not (tmp_path / "manifest.json").exists()


@pytest.mark.parametrize("operation", ["mesh", "solve"])
def test_application_executes_and_reopens_real_si_fields(plane, tmp_path, operation):
    original = deepcopy(plane)
    snapshot = request(plane, operation)
    plan = RunPlan.prepare(snapshot)
    plane["revision"] += 1
    plane["study"]["material"]["young"] *= 2
    manifest = execute(plan, tmp_path)
    assert manifest["projectId"] == original["id"]
    assert manifest["revision"] == original["revision"]
    assert manifest["fingerprint"] == fingerprint(original)
    assert manifest["jobId"] == snapshot.job_id
    assert manifest["coordinateFrame"] == "cartesian-global-SI"
    assert read_cached(tmp_path, snapshot.project_definition()) == manifest
    assert execute(RunPlan.prepare(request(original, "validate")), tmp_path) == manifest


def test_comparison_publishes_owned_metrics_without_mutating_method_trace(
    plane, tmp_path, monkeypatch
):
    actual_execute_method = application.execute_method
    measured = []

    def observe_method(*args, **kwargs):
        result = actual_execute_method(*args, **kwargs)
        if "training" in result:
            measured.append((result, deepcopy(result["training"]["history"])))
        return result

    monkeypatch.setattr(application, "execute_method", observe_method)
    live = []
    snapshot = request(plane, "compare")
    manifest = execute(RunPlan.prepare(snapshot), tmp_path, metrics=live.append)
    assert len(measured) == 1
    result, original_history = measured[0]
    assert result["training"]["history"] == original_history
    assert live == original_history
    assert all("jobId" not in metric and "elapsedSeconds" in metric for metric in live)
    history = manifest["training"]["history"]
    assert all(metric["jobId"] == snapshot.job_id and "elapsed" in metric for metric in history)
    for raw, published in zip(live, history, strict=True):
        assert raw["elapsedSeconds"] == published["elapsed"]
        for key in ("step", "total", "pde", "boundary", "device"):
            assert raw[key] == published[key]
    blob = (tmp_path / "buffer.bin").read_bytes()
    assert validate_cached(plane, manifest, blob) == manifest
    assert (
        manifest["comparison"]["mapping"]
        == "identical nodes and cell centroids; unweighted relative L2"
    )
    assert np.isfinite(manifest["pinnSummary"]["maxDisplacement"])


def test_cancellation_before_work_allocates_no_mesh_or_result(project, tmp_path, monkeypatch):
    def fail_if_meshed(*args, **kwargs):
        raise AssertionError("An already cancelled run must not allocate a mesh.")

    monkeypatch.setattr(application, "generate_study_mesh", fail_if_meshed)
    with pytest.raises(EngineError) as error:
        execute(RunPlan.prepare(request(project)), tmp_path, cancelled=lambda: True)
    assert error.value.code == "cancelled"
    assert list(tmp_path.iterdir()) == []


def test_cancellation_at_publication_preserves_existing_result(plane, tmp_path):
    previous = b"preserved prior manifest"
    (tmp_path / "manifest.json").write_bytes(previous)
    stages = []
    with pytest.raises(EngineError) as error:
        execute(
            RunPlan.prepare(request(plane)),
            tmp_path,
            progress=lambda stage, fraction: stages.append(stage),
            cancelled=lambda: "writing-results" in stages,
        )
    assert error.value.code == "cancelled"
    assert (tmp_path / "manifest.json").read_bytes() == previous
    assert not (tmp_path / "buffer.bin").exists()


@pytest.mark.parametrize("mutation_source", ["method", "progress-callback"])
def test_adapter_input_mutation_cannot_publish_as_original_problem(
    plane, tmp_path, monkeypatch, mutation_source
):
    actual_execute_method = application.execute_method
    method_inputs = []

    def instrument_method(method, mesh, study, *args, **kwargs):
        result = actual_execute_method(method, mesh, study, *args, **kwargs)
        method_inputs.append(study)
        if mutation_source == "method":
            study["material"]["young"] *= 2
        return result

    def progress(stage, fraction):
        if stage == "writing-results" and mutation_source == "progress-callback":
            method_inputs[0]["material"]["young"] *= 2

    monkeypatch.setattr(application, "execute_method", instrument_method)
    with pytest.raises(EngineError) as error:
        execute(RunPlan.prepare(request(plane)), tmp_path, progress=progress)
    assert error.value.code == "input-mutated"
    assert list(tmp_path.iterdir()) == []


def test_cache_read_enforces_bound_when_file_grows_after_stat(tmp_path, monkeypatch):
    file = tmp_path / "growing-cache"
    file.write_bytes(b"x" * 17)
    actual_stat = Path.stat

    def stat_before_growth(path, *args, **kwargs):
        return SimpleNamespace(st_size=16) if path == file else actual_stat(path, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", stat_before_growth)
    with pytest.raises(EngineError) as error:
        _read_bounded(file, 16)
    assert error.value.code == "resource-limit"
