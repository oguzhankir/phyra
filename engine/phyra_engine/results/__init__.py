"""Validated binary results dispatch by physical study, independent of method choice."""

from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.studies.project import validate_numerical_project


def validate_cached(
    project: dict[str, Any],
    manifest: Any,
    blob: bytes,
    *,
    expected_mesh: Mesh | Mesh2D | None = None,
) -> dict[str, Any]:
    """Validate old/current cached fields or return a structured malformed-cache failure."""
    try:
        validate_numerical_project(project)
        if project["study"].get("dimension") == "2d":
            from phyra_engine.results.plane_stress import validate_cached as validate_plane

            return validate_plane(project, manifest, blob)
        from phyra_engine.results.solid import _validate_cached

        return _validate_cached(project, manifest, blob, expected_mesh=expected_mesh)
    except EngineError:
        raise
    except (TypeError, ValueError, KeyError, IndexError, OverflowError) as error:
        raise EngineError("invalid-cache", "Cached metadata or arrays are malformed.") from error
