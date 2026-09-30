"""One owned worker executes one validated immutable study request."""

import argparse
import io
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES
from phyra_engine.execution.registry import (
    capabilities,
    execute_method,
    generate_study_mesh,
    methods_for_operation,
)
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.protocol.request import (
    job_identity,
    read_request,
    reject_constant,
    validate_operation,
    validate_version,
)
from phyra_engine.protocol.stdio import emit
from phyra_engine.results import validate_cached
from phyra_engine.studies.project import validate_project


def metric_frame(job_id: str, value: dict[str, Any]) -> dict[str, Any]:
    return {
        "type": "metrics",
        "jobId": job_id,
        "step": value["step"],
        "elapsed": value["elapsedSeconds"],
        "total": value["total"],
        "pde": value["pde"],
        "boundary": value["boundary"],
        "device": value["device"],
    }


def main() -> int:
    # Frozen interpreters can ignore Python's environment encoding flags.
    cast(io.TextIOWrapper, sys.stdout).reconfigure(encoding="utf-8", errors="strict")
    cast(io.TextIOWrapper, sys.stderr).reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    job_id = "unknown"
    try:
        request = read_request(sys.stdin.buffer)
        job_id = job_identity(request["jobId"])
        validate_version(request["protocolVersion"])
        operation = validate_operation(request["operation"])
        project = validate_project(request["project"])
        run_started = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()

        def progress(stage: str, fraction: float | None) -> None:
            emit({"type": "progress", "jobId": job_id, "stage": stage, "progress": fraction})

        if operation == "devices":
            import torch

            from phyra_engine.execution.devices import device_capabilities

            devices = device_capabilities()
            emit(
                {
                    "type": "complete",
                    "manifest": {
                        "protocolVersion": 1,
                        "status": "succeeded",
                        "projectId": project["id"],
                        "studyId": project["study"]["id"],
                        "revision": project["revision"],
                        "jobId": job_id,
                        "operation": "devices",
                        "devices": devices,
                        "defaultDevice": "cpu",
                        "framework": f"PyTorch {torch.__version__}",
                        "capabilities": capabilities(devices),
                    },
                }
            )
            return 0

        if operation == "validate":
            progress("validating-cache", None)
            metadata_file = args.output / "manifest.json"
            binary_file = args.output / "buffer.bin"
            if (
                metadata_file.stat().st_size > MAX_REQUEST_BYTES
                or binary_file.stat().st_size > MAX_BUFFER_BYTES
            ):
                raise EngineError(
                    "resource-limit", "Cached payload exceeds the supported resource limit."
                )
            manifest = json.loads(metadata_file.read_bytes(), parse_constant=reject_constant)
            validate_cached(project, manifest, binary_file.read_bytes())
        else:
            methods = methods_for_operation(project, operation)
            mesh = generate_study_mesh(project, progress)
            classical = trained = None
            for method in methods:
                result = execute_method(
                    method,
                    mesh,
                    project["study"],
                    progress,
                    lambda value: emit(metric_frame(job_id, value)),
                )
                if method.kind == "fem":
                    classical = result
                else:
                    trained = result
                    result["training"]["history"] = [
                        {
                            key: value
                            for key, value in metric_frame(job_id, metric).items()
                            if key != "type"
                        }
                        for metric in result["training"]["history"]
                    ]
            progress("writing-results", None)
            duration = time.perf_counter() - run_started
            if isinstance(mesh, Mesh2D):
                from phyra_engine.results.plane_stress import write_output as write_plane

                manifest = write_plane(
                    args.output,
                    project,
                    job_id,
                    operation,
                    mesh,
                    trained if operation == "train" else classical,
                    trained if operation == "compare" else None,
                    started_at,
                    duration,
                )
            else:
                from phyra_engine.results.solid import write_output

                manifest = write_output(
                    args.output,
                    project,
                    job_id,
                    operation,
                    mesh,
                    classical,
                    started_at=started_at,
                    duration_seconds=duration,
                )
        emit({"type": "complete", "manifest": manifest})
        return 0
    except EngineError as error:
        emit({"type": "error", "jobId": job_id, "code": error.code, "message": str(error)})
        return 2
    except (json.JSONDecodeError, UnicodeDecodeError, OSError, ValueError, RecursionError) as error:
        emit({"type": "error", "jobId": job_id, "code": "invalid-request", "message": str(error)})
        return 2
    except Exception as error:
        # Unexpected binding faults remain isolated; no stack traces or project
        # contents are serialized into the workbench's error message.
        print(f"Unexpected worker failure: {type(error).__name__}: {error}", file=sys.stderr)
        emit(
            {
                "type": "error",
                "jobId": job_id,
                "code": "engine-failed",
                "message": "The isolated worker failed. Review the local engine log.",
            }
        )
        return 1
