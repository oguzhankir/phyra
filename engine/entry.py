"""One owned worker, one immutable request, no network listener or shell bridge."""

import argparse
import json
import re
import sys
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
        if operation not in ("mesh", "solve", "validate"):
            raise EngineError(
                "unsupported-operation", "Supported operations are mesh, solve and validate."
            )
        project = validate_project(request["project"])

        def progress(stage: str, fraction: float | None) -> None:
            emit({"type": "progress", "jobId": job_id, "stage": stage, "progress": fraction})

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
            mesh = generate_mesh(project, progress)
            result = solve_mesh(mesh, project["study"], progress) if operation == "solve" else None
            progress("writing-results", None)
            manifest = write_output(args.output, project, job_id, operation, mesh, result)
        emit({"type": "complete", "manifest": manifest})
        return 0
    except EngineError as error:
        emit({"type": "error", "jobId": job_id, "code": error.code, "message": str(error)})
        return 2
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as error:
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
