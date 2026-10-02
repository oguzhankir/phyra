"""Bounded cached-file reads and publication through validated binary writers."""

import json
from pathlib import Path
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.protocol.request import reject_constant
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


def read_cached(output: Path, project: dict[str, Any]) -> dict[str, Any]:
    metadata = _read_bounded(output / "manifest.json", MAX_REQUEST_BYTES)
    manifest = json.loads(metadata, parse_constant=reject_constant)
    return validate_cached(
        project, manifest, _read_bounded(output / "buffer.bin", MAX_BUFFER_BYTES)
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
    )
