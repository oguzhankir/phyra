"""Method-independent plane-stress edge tractions and component supports."""

from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.plane_stress import edge_geometry
from phyra_engine.meshing.types import Mesh2D


def _selection(mesh: Mesh2D, regions: list[str]) -> np.ndarray:
    if not regions or len(set(regions)) != len(regions) or not set(regions).issubset(mesh.regions):
        raise EngineError("invalid-region", "Select existing rectangle edges without duplicates.")
    return np.flatnonzero(
        np.isin(mesh.edge_regions, [mesh.regions.index(region) for region in regions])
    )


def edge_tractions(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
    lengths, normals = edge_geometry(mesh)
    traction = np.zeros((len(mesh.edges), 2), dtype=np.float64)
    for load in loads:
        selected = _selection(mesh, load["regions"])
        if load["kind"] == "force":
            vector = np.asarray(load["vector"], dtype=np.float64)
            if (
                vector.shape not in ((2,), (3,))
                or not np.isfinite(vector).all()
                or (len(vector) == 3 and vector[2] != 0)
            ):
                raise EngineError(
                    "invalid-load",
                    "2D force needs finite xy components and zero out-of-plane force.",
                )
            traction[selected] += vector[:2] / (mesh.thickness * lengths[selected].sum())
        elif load["kind"] == "pressure":
            pressure = load["pressure"]
            if type(pressure) not in (int, float) or not np.isfinite(pressure):
                raise EngineError("invalid-load", "Pressure must be finite.")
            traction[selected] -= pressure * normals[selected]
        else:
            raise EngineError(
                "invalid-load", "Supported loads are total force and inward pressure."
            )
    if not np.isfinite(traction).all():
        raise EngineError("invalid-load", "Edge traction exceeds float64 range.")
    return traction


def integrate_edge_loads(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
    lengths, _ = edge_geometry(mesh)
    edge_force = edge_tractions(mesh, loads) * lengths[:, None] * mesh.thickness / 2
    force = np.zeros((len(mesh.positions), 2), dtype=np.float64)
    for corner in range(2):
        np.add.at(force, mesh.edges[:, corner], edge_force)
    return force


def constraint_dofs(mesh: Mesh2D, constraints: list[dict[str, Any]]) -> dict[int, float]:
    prescribed: dict[int, float] = {}
    for constraint in constraints:
        components = constraint["components"]
        if len(components) not in (2, 3) or (
            len(components) == 3 and components[2] not in (0, None)
        ):
            raise EngineError(
                "invalid-constraint", "Plane-stress supports prescribe only in-plane displacement."
            )
        if all(value is None for value in components[:2]):
            raise EngineError(
                "empty-constraint", "A 2D support must prescribe an in-plane component."
            )
        nodes = np.unique(mesh.edges[_selection(mesh, constraint["regions"])])
        for component, value in enumerate(components[:2]):
            if value is None:
                continue
            if type(value) not in (int, float) or not np.isfinite(value):
                raise EngineError(
                    "invalid-constraint", "Prescribed displacement must be finite or free."
                )
            for node in nodes:
                dof = 2 * int(node) + component
                tolerance = (
                    64
                    * np.finfo(float).eps
                    * max(abs(value), abs(prescribed.get(dof, value)), np.finfo(float).tiny)
                )
                if dof in prescribed and abs(prescribed[dof] - value) > tolerance:
                    raise EngineError(
                        "conflicting-constraints",
                        "Overlapping edges prescribe incompatible displacements.",
                    )
                prescribed[dof] = float(value)
    return prescribed


def validate_constraints(mesh: Mesh2D, prescribed: dict[int, float]) -> None:
    ndof = 2 * len(mesh.positions)
    if any(
        type(dof) is not int or not 0 <= dof < ndof or not np.isfinite(value)
        for dof, value in prescribed.items()
    ):
        raise EngineError("invalid-constraint", "Prescribed DOFs or values are invalid.")
    centered = mesh.positions[:, :2] - mesh.positions[:, :2].mean(axis=0)
    centered /= np.linalg.norm(np.ptp(mesh.positions[:, :2], axis=0))
    rigid = np.zeros((len(mesh.positions), 2, 3), dtype=np.float64)
    rigid[:, :, :2] = np.eye(2)
    rigid[:, 0, 2], rigid[:, 1, 2] = -centered[:, 1], centered[:, 0]
    singular = np.linalg.svd(rigid.reshape(-1, 3)[sorted(prescribed)], compute_uv=False)
    if len(singular) < 3 or singular[-1] <= singular[0] * 1e-10:
        raise EngineError(
            "under-constrained", "Supports leave a 2D rigid translation or rotation free."
        )
