"""Headless study planning and execution, independent of CLI and stdio framing.

Only implemented methods enter a run plan. The application owns sequencing,
execution identity and publication; numerical methods own their calculations.
"""

import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Cancellation, Metrics, Progress, metric_record
from phyra_engine.execution.registry import (
    Method,
    capabilities,
    execute_method,
    methods_for_operation,
)
from phyra_engine.protocol.request import StudyRequest
from phyra_engine.results.storage import publish, read_cached
from phyra_engine.studies.cad import is_cad_solid
from phyra_engine.studies.mesh import generate_study_mesh
from phyra_engine.studies.project import fingerprint


@dataclass(frozen=True)
class RunPlan:
    request: StudyRequest
    methods: tuple[Method, ...]
    input_fingerprint: str

    @classmethod
    def prepare(cls, request: StudyRequest) -> "RunPlan":
        project = request.project_definition()
        methods = (
            ()
            if request.operation in ("validate", "devices")
            else methods_for_operation(project, request.operation)
        )
        return cls(request, methods, fingerprint(project))


def _owned_training_result(result: dict[str, Any], job_id: str) -> dict[str, Any]:
    """Add job provenance without mutating a method's measured training trace."""
    training = {
        **result["training"],
        "history": [metric_record(job_id, metric) for metric in result["training"]["history"]],
    }
    return {**result, "training": training}


def execute(
    plan: RunPlan,
    output: Path,
    progress: Progress | None = None,
    metrics: Metrics | None = None,
    cancelled: Cancellation | None = None,
) -> dict[str, Any]:
    request = plan.request
    project = request.project_definition()
    run_started = time.perf_counter()
    started_at = datetime.now(timezone.utc).isoformat()

    def check_cancelled() -> None:
        if cancelled and cancelled():
            raise EngineError("cancelled", "Study execution was cancelled.")

    check_cancelled()
    if request.operation == "devices":
        import torch

        from phyra_engine.execution.devices import device_capabilities

        devices = device_capabilities()
        return {
            "protocolVersion": 1,
            "status": "succeeded",
            "projectId": project["id"],
            "studyId": project["study"]["id"],
            "revision": project["revision"],
            "jobId": request.job_id,
            "operation": "devices",
            "devices": devices,
            "defaultDevice": "cpu",
            "framework": f"PyTorch {torch.__version__}",
            "capabilities": capabilities(devices),
        }
    if request.operation == "validate":
        if progress:
            progress("validating-cache", None)
        expected_mesh = (
            generate_study_mesh(project, progress, assets=request.asset_sources())
            if is_cad_solid(project)
            else None
        )
        check_cancelled()
        return read_cached(output, project, expected_mesh=expected_mesh)

    mesh = generate_study_mesh(project, progress, assets=request.asset_sources())
    classical = trained = None
    for method in plan.methods:
        check_cancelled()
        result = execute_method(method, mesh, project["study"], progress, metrics, cancelled)
        if method.kind == "fem":
            classical = result
        else:
            trained = _owned_training_result(result, request.job_id)
    if progress:
        progress("writing-results", None)
    check_cancelled()
    if fingerprint(project) != plan.input_fingerprint:
        raise EngineError(
            "input-mutated",
            "Numerical execution changed its physical input snapshot. Fields were not published.",
        )
    return publish(
        output,
        request.project_definition(),
        request.job_id,
        request.operation,
        mesh,
        classical,
        trained,
        started_at,
        time.perf_counter() - run_started,
    )
