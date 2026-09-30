"""One owned worker, one immutable request, no network listener or shell bridge."""

import argparse
import json
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from phyra_engine.errors import EngineError
from phyra_engine.fem import solve_mesh
from phyra_engine.mesh import generate_mesh
from phyra_engine.protocol import validate_cached, write_output
from phyra_engine.validation import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES, validate_project


def emit(message: dict) -> None:
    print(json.dumps(message, separators=(",", ":"), allow_nan=False), flush=True)


def reject_constant(value: str) -> None:
    raise EngineError("nonfinite-input", f"JSON does not allow {value}.")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    job_id = "unknown"
    try:
        request_bytes = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
        if len(request_bytes) > MAX_REQUEST_BYTES:
            raise EngineError("resource-limit", "Request exceeds the 1 MiB limit.")
        request = json.loads(request_bytes, parse_constant=reject_constant)
        if not isinstance(request, dict) or set(request) != {
            "protocolVersion",
            "operation",
            "jobId",
            "project",
        }:
            raise EngineError(
                "invalid-request", "Request does not match the versioned command contract."
            )
        job_id = request["jobId"]
        if not isinstance(job_id, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", job_id):
            job_id = "unknown"
            raise EngineError("invalid-request", "Job identity must be a safe opaque identifier.")
        if type(request["protocolVersion"]) is not int or request["protocolVersion"] != 1:
            raise EngineError("unsupported-version", "Unsupported engine protocol version.")
        operation = request["operation"]
        if operation not in ("mesh", "solve", "validate", "train", "compare", "devices"):
            raise EngineError("unsupported-operation", "Unsupported engine operation.")
        project = validate_project(request["project"])
        run_started = time.perf_counter()
        started_at = datetime.now(timezone.utc).isoformat()

        def progress(stage: str, fraction: float | None) -> None:
            emit({"type": "progress", "jobId": job_id, "stage": stage, "progress": fraction})

        if operation == "devices":
            import torch

            from phyra_engine.pinn import device_capabilities

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
                        "devices": device_capabilities(),
                        "defaultDevice": "cpu",
                        "framework": f"PyTorch {torch.__version__}",
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
        elif project["study"].get("dimension") == "2d":
            from phyra_engine import fem2d
            from phyra_engine.protocol2d import write_output as write_2d

            progress("generating-plane-stress-mesh", None)
            geometry, study = project["geometry"], project["study"]
            mesh2d = fem2d.generate_rectangle(
                geometry["length"], geometry["width"], study["thickness"], study["mesh"]["size"]
            )
            classical = (
                fem2d.solve_mesh(mesh2d, study, progress)
                if operation in ("solve", "compare")
                else None
            )
            trained = None
            if operation in ("train", "compare"):
                from phyra_engine import pinn

                progress("initializing-pinn", 0)

                def metric(value: dict) -> None:
                    emit(
                        {
                            "type": "metrics",
                            "jobId": job_id,
                            "step": value["step"],
                            "elapsed": value["elapsedSeconds"],
                            "total": value["total"],
                            "pde": value["pde"],
                            "boundary": value["boundary"],
                            "device": value["device"],
                        }
                    )

                trained = pinn.train(mesh2d, study, study["solver"]["pinn"], metrics=metric)
                training = trained["training"]
                training["history"] = [
                    {
                        "jobId": job_id,
                        "step": v["step"],
                        "elapsed": v["elapsedSeconds"],
                        "total": v["total"],
                        "pde": v["pde"],
                        "boundary": v["boundary"],
                        "device": training["device"],
                    }
                    for v in training["history"]
                ]
            progress("writing-results", None)
            manifest = write_2d(
                args.output,
                project,
                job_id,
                operation,
                mesh2d,
                trained if operation == "train" else classical,
                trained if operation == "compare" else None,
                started_at,
                time.perf_counter() - run_started,
            )
        else:
            if operation in ("train", "compare"):
                raise EngineError(
                    "unsupported-study", "Experimental PINN requires a 2D plane-stress study."
                )
            mesh = generate_mesh(project, progress)
            result = solve_mesh(mesh, project["study"], progress) if operation == "solve" else None
            progress("writing-results", None)
            manifest = write_output(
                args.output,
                project,
                job_id,
                operation,
                mesh,
                result,
                started_at=started_at,
                duration_seconds=time.perf_counter() - run_started,
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
        # Unexpected native/binding faults stay in this worker. Do not serialize
        # stack traces or project contents into the UI-facing protocol.
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


if __name__ == "__main__":
    raise SystemExit(main())
