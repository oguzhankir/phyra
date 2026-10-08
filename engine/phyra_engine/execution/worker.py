"""One owned worker executes one validated immutable study request."""

import argparse
import contextlib
import io
import json
import sys
from pathlib import Path
from typing import cast

from phyra_engine.errors import EngineError
from phyra_engine.execution.application import RunPlan, execute
from phyra_engine.execution.events import metric_record
from phyra_engine.protocol.request import StudyRequest, job_identity, read_request
from phyra_engine.protocol.stdio import emit


def main() -> int:
    # Frozen interpreters can ignore Python's environment encoding flags.
    cast(io.TextIOWrapper, sys.stdout).reconfigure(encoding="utf-8", errors="strict")
    cast(io.TextIOWrapper, sys.stderr).reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--asset-root", help="Native-owned immutable CAD source directory")
    args = parser.parse_args()
    job_id = "unknown"
    try:
        payload = read_request(sys.stdin.buffer)
        job_id = job_identity(payload["jobId"])
        # This bounded, type-checked discriminator selects log routing only.
        # StudyRequest still independently validates the complete definition.
        project = payload["project"]
        geometry = project.get("geometry") if isinstance(project, dict) else None
        cad_definition = isinstance(geometry, dict) and geometry.get("kind") == "cad"
        log_context: contextlib.AbstractContextManager[None] = contextlib.nullcontext()
        if cad_definition:
            from phyra_engine.execution.cad import cad_log_to_stderr

            log_context = cad_log_to_stderr()
        with log_context:
            request = StudyRequest.from_payload(payload, asset_root=args.asset_root)
            plan = RunPlan.prepare(request)

        def progress(stage: str, fraction: float | None) -> None:
            emit({"type": "progress", "jobId": job_id, "stage": stage, "progress": fraction})

        manifest = execute(
            plan,
            args.output,
            progress,
            lambda value: emit({"type": "metrics", **metric_record(job_id, value)}),
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
