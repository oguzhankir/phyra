"""Bounded cached-file reads and publication through validated binary writers."""

import json
import math
from pathlib import Path
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.results import validate_cached


def _read_bounded(path: Path, limit: int) -> bytes:
    if path.stat().st_size > limit:
        raise EngineError("resource-limit", "Cached payload exceeds the supported resource limit.")
    with path.open("rb") as stream:
        payload = stream.read(limit + 1)
    # The file can grow after stat; the read itself must also enforce the bound.
    if len(payload) > limit:
        raise EngineError("resource-limit", "Cached payload exceeds the supported resource limit.")
    return payload


def _finite_cached_float(token: str) -> float:
    value = float(token)
    if not math.isfinite(value):
        raise ValueError("Cached metadata contains a nonfinite number.")
    return value


def read_cached(
    output: Path, project: dict[str, Any], *, expected_mesh: Mesh | Mesh2D | None = None
) -> dict[str, Any]:
    metadata = _read_bounded(output / "manifest.json", MAX_REQUEST_BYTES)
    try:
        manifest = json.loads(
            metadata, parse_float=_finite_cached_float, parse_constant=_finite_cached_float
        )
    except ValueError as error:
        # JSON syntax, UTF decoding and nonfinite cache numbers are derived-data
        # failures. Keep file I/O, resource limits and execution errors outside
        # this boundary so archive recovery cannot silently discard those errors.
        raise EngineError("invalid-cache", "Cached metadata is not finite valid JSON.") from error
    return validate_cached(
        project,
        manifest,
        _read_bounded(output / "buffer.bin", MAX_BUFFER_BYTES),
        expected_mesh=expected_mesh,
    )


def publish(
    output: Path,
    project: dict[str, Any],
    job_id: str,
    operation: str,
    mesh: Mesh | Mesh2D,
    classical: dict[str, Any] | None,
    trained: dict[str, Any] | None,
    started_at: str,
    duration_seconds: float,
) -> dict[str, Any]:
    if isinstance(mesh, Mesh2D):
        from phyra_engine.results.plane_stress import write_output

        return write_output(
            output,
            project,
            job_id,
            operation,
            mesh,
            trained if operation == "train" else classical,
            trained if operation == "compare" else None,
            started_at,
            duration_seconds,
        )
    from phyra_engine.results.solid import write_output as write_solid

    return write_solid(
        output,
        project,
        job_id,
        operation,
        mesh,
        classical,
        started_at=started_at,
        duration_seconds=duration_seconds,
        expected_mesh=mesh,
    )
