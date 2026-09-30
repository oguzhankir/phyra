"""Explicit solid surface loads, component supports and rigid-freedom checks."""

from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh


def _selection(mesh: Mesh, regions: list[str]) -> np.ndarray:
    if not regions or len(set(regions)) != len(regions) or not set(regions).issubset(mesh.regions):
        raise EngineError("invalid-region", "Choose existing boundary regions without duplicates.")
    indexes = [mesh.regions.index(region) for region in regions]
    selected = np.flatnonzero(np.isin(mesh.surface_regions, indexes))
    if not len(selected):
        raise EngineError("invalid-region", "Selected boundary has no mesh triangles.")
    return selected


def integrate_surface_loads(mesh: Mesh, loads: list[dict[str, Any]]) -> np.ndarray:
    force = np.zeros_like(mesh.positions, dtype=np.float64)
    for load in loads:
        selected = _selection(mesh, load["regions"])
        triangles = mesh.surface[selected]
        points = mesh.positions[triangles]
        area_vectors = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]) / 2
        areas = np.linalg.norm(area_vectors, axis=1)
        if np.any(areas <= 0) or not np.isfinite(areas).all():
            raise EngineError(
                "degenerate-mesh", "A loaded surface triangle has zero or invalid area."
            )
        if load["kind"] == "force":
            vector = np.asarray(load["vector"], dtype=np.float64)
            if vector.shape != (3,) or not np.isfinite(vector).all():
                raise EngineError(
                    "invalid-load", "Total force must contain three finite components."
                )
            nodal = areas[:, None] * vector / (3 * areas.sum())
        elif load["kind"] == "pressure":
            pressure = load["pressure"]
            if not isinstance(pressure, (int, float)) or not np.isfinite(pressure):
                raise EngineError("invalid-load", "Pressure must be finite.")
            nodal = -pressure * area_vectors / 3
        else:
            raise EngineError(
                "invalid-load", "Supported loads are total force and inward pressure."
            )
        for corner in range(3):
            np.add.at(force, triangles[:, corner], nodal)
    if not np.isfinite(force).all():
        raise EngineError("invalid-load", "Integrated force exceeds finite float64 range.")
    return force


def constraint_dofs(mesh: Mesh, constraints: list[dict[str, Any]]) -> dict[int, float]:
    prescribed: dict[int, float] = {}
    for constraint in constraints:
        selected = _selection(mesh, constraint["regions"])
        nodes = np.unique(mesh.surface[selected])
        if len(constraint["components"]) != 3:
            raise EngineError(
                "invalid-constraint", "Prescribed displacement needs three components."
            )
        if all(value is None for value in constraint["components"]):
            raise EngineError("empty-constraint", "A support must prescribe a component.")
        for component, value in enumerate(constraint["components"]):
            if value is None:
                continue
            if not isinstance(value, (int, float)) or not np.isfinite(value):
                raise EngineError(
                    "invalid-constraint", "Prescribed displacement must be finite or free."
                )
            for node in nodes:
                dof = int(node) * 3 + component
                if dof in prescribed:
                    tolerance = (
                        64
                        * np.finfo(float).eps
                        * max(abs(value), abs(prescribed[dof]), np.finfo(float).tiny)
                    )
                    if abs(prescribed[dof] - value) > tolerance:
                        raise EngineError(
                            "conflicting-constraints",
                            "Overlapping supports prescribe incompatible displacements.",
                        )
                prescribed[dof] = float(value)
    return prescribed


def _rigid_rank(mesh: Mesh, fixed: np.ndarray) -> None:
    centered = mesh.positions - mesh.positions.mean(axis=0)
    length = np.linalg.norm(np.ptp(mesh.positions, axis=0))
    centered /= length
    rigid = np.zeros((len(mesh.positions), 3, 6), dtype=np.float64)
    rigid[:, :, :3] = np.eye(3)
    x, y, z = centered.T
    rigid[:, 0, 4], rigid[:, 0, 5] = z, -y
    rigid[:, 1, 3], rigid[:, 1, 5] = -z, x
    rigid[:, 2, 3], rigid[:, 2, 4] = y, -x
    restricted = rigid.reshape(-1, 6)[fixed]
    singular = np.linalg.svd(restricted, compute_uv=False)
    if len(singular) < 6 or singular[-1] <= singular[0] * 1e-10:
        raise EngineError(
            "under-constrained",
            "Supports leave rigid translation or rotation free. Add independent restraints.",
        )
