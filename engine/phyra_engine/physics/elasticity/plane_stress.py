"""Method-independent plane-stress edge tractions and component supports."""

from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.plane_stress import edge_geometry
from phyra_engine.meshing.types import Mesh2D


def _selection(mesh: Mesh2D, regions: list[str]) -> np.ndarray:
    if not regions or len(set(regions)) != len(regions) or not set(regions).issubset(mesh.regions):
        raise EngineError("invalid-region", "Select existing named boundaries without duplicates.")
    return np.flatnonzero(
        np.isin(mesh.edge_regions, [mesh.regions.index(region) for region in regions])
    )


def validate_traction(traction: Any) -> None:
    if not isinstance(traction, dict):
        raise EngineError("invalid-load", "A spatial traction requires a typed stress field.")
    if traction.get("kind") == "affine":
        if set(traction) != {"kind", "xx", "yy", "xy"}:
            raise EngineError(
                "invalid-load", "Affine stress requires xx, yy and xy coefficient triples."
            )
        for key in ("xx", "yy", "xy"):
            values = traction[key]
            if (
                not isinstance(values, list)
                or len(values) != 3
                or any(type(v) not in (int, float) or not np.isfinite(v) for v in values)
            ):
                raise EngineError(
                    "invalid-load",
                    "Stress coefficients [constant Pa, x Pa/m, y Pa/m] must be finite.",
                )
    elif traction.get("kind") == "kirsch":
        if set(traction) != {"kind", "radius", "center", "tension"}:
            raise EngineError(
                "invalid-load", "Circular-hole stress requires center, radius and remote tension."
            )
        if (
            not isinstance(traction["center"], list)
            or len(traction["center"]) != 2
            or any(type(v) not in (int, float) or not np.isfinite(v) for v in traction["center"])
            or type(traction["radius"]) not in (int, float)
            or not np.isfinite(traction["radius"])
            or traction["radius"] <= 0
            or type(traction["tension"]) not in (int, float)
            or not np.isfinite(traction["tension"])
        ):
            raise EngineError(
                "invalid-load",
                "Circular-hole traction parameters need finite SI values and a positive radius.",
            )
    else:
        raise EngineError(
            "invalid-load", "Supported stress traction fields are affine and circular-hole Kirsch."
        )


def spatial_traction(points: np.ndarray, normals: np.ndarray, traction: Any) -> np.ndarray:
    validate_traction(traction)
    if traction["kind"] == "kirsch":
        from phyra_engine.physics.elasticity.kirsch import kirsch_traction

        return kirsch_traction(
            points, normals, traction["radius"], traction["tension"], traction["center"]
        )
    coordinates = np.column_stack((np.ones(len(points)), points[:, :2]))
    xx, yy, xy = (coordinates @ np.asarray(traction[key]) for key in ("xx", "yy", "xy"))
    values = np.column_stack(
        (xx * normals[:, 0] + xy * normals[:, 1], xy * normals[:, 0] + yy * normals[:, 1])
    )
    if not np.isfinite(values).all():
        raise EngineError("invalid-load", "Spatial boundary traction exceeds float64 range.")
    return values


def _load_traction(
    mesh: Mesh2D,
    load: dict[str, Any],
    selected: np.ndarray,
    points: np.ndarray,
    normals: np.ndarray,
) -> np.ndarray:
    if load["kind"] == "force":
        vector = np.asarray(load["vector"], dtype=np.float64)
        if (
            vector.shape not in ((2,), (3,))
            or not np.isfinite(vector).all()
            or (len(vector) == 3 and vector[2] != 0)
        ):
            raise EngineError(
                "invalid-load", "2D force needs finite xy components and zero out-of-plane force."
            )
        lengths, _ = edge_geometry(mesh)
        return np.broadcast_to(
            vector[:2] / (mesh.thickness * lengths[selected].sum()), normals.shape
        )
    if load["kind"] == "pressure":
        pressure = load["pressure"]
        if type(pressure) not in (int, float) or not np.isfinite(pressure):
            raise EngineError("invalid-load", "Pressure must be finite.")
        return -pressure * normals
    if load["kind"] == "traction":
        return spatial_traction(points, normals, load.get("traction"))
    raise EngineError(
        "invalid-load",
        "Supported loads are total force, inward pressure and typed stress traction.",
    )


def edge_tractions(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
    """Midpoint values for boundary inspection; not a bound for spatial loads."""
    _, normals = edge_geometry(mesh)
    midpoints = mesh.positions[mesh.edges, :2].mean(axis=1)
    traction = np.zeros((len(mesh.edges), 2), dtype=np.float64)
    for load in loads:
        selected = _selection(mesh, load["regions"])
        traction[selected] += _load_traction(
            mesh, load, selected, midpoints[selected], normals[selected]
        )
    if not np.isfinite(traction).all():
        raise EngineError("invalid-load", "Edge traction exceeds float64 range.")
    return traction


def point_tractions(
    mesh: Mesh2D, loads: list[dict[str, Any]], edge_indices: np.ndarray, points: np.ndarray
) -> np.ndarray:
    """Evaluate physical loads at supplied points on their associated boundary edges.

    The selected total-force area remains the whole authored load selection, even
    when quadrature or collocation evaluates only part of that selection.
    """
    _, normals = edge_geometry(mesh)
    traction = np.zeros((len(points), 2), dtype=np.float64)
    for load in loads:
        selected = _selection(mesh, load["regions"])
        mask = np.isin(edge_indices, selected)
        if mask.any():
            traction[mask] += _load_traction(
                mesh, load, selected, points[mask], normals[edge_indices[mask]]
            )
    if not np.isfinite(traction).all():
        raise EngineError("invalid-load", "Boundary point traction exceeds float64 range.")
    return traction


def boundary_traction_scale(mesh: Mesh2D, loads: list[dict[str, Any]]) -> float:
    """Representative maximum physical traction norm over every boundary edge.

    Endpoints give the exact maximum of affine traction norms on a straight
    edge, including sign-changing fields that vanish at its midpoint. Five
    interior Gauss points also represent non-polynomial fields. Sampling
    retains the full authored selection for total-force normalization and
    bounded temporary arrays; this is a scaling convention, not an error bound.
    """
    gauss, _ = np.polynomial.legendre.leggauss(5)
    along = np.r_[0, (gauss + 1) / 2, 1]
    scale = 0.0
    for start in range(0, len(mesh.edges), 4096):
        indices = np.arange(start, min(start + 4096, len(mesh.edges)))
        endpoints = mesh.positions[mesh.edges[indices], :2]
        points = (
            endpoints[:, :1] * (1 - along[None, :, None]) + endpoints[:, 1:] * along[None, :, None]
        ).reshape(-1, 2)
        values = point_tractions(mesh, loads, np.repeat(indices, len(along)), points)
        scale = max(scale, float(np.hypot(values[:, 0], values[:, 1]).max()))
    return scale


def integrate_edge_loads(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
    """scikit-fem facet quadrature integrates sigma(x,y)*outward normal safely.

    Five Gauss points (order 8) integrate affine traction times P1 shape exactly;
    the non-polynomial circular-hole field is evaluated at the same points.
    """
    from skfem import (  # type: ignore[import-untyped]
        ElementTriP1,
        ElementVector,
        FacetBasis,
        LinearForm,
        MeshTri,
        asm,
    )
    from skfem.helpers import dot  # type: ignore[import-untyped]

    backend = MeshTri(mesh.positions[:, :2].T, mesh.cells.T, sort_t=False)
    facet_lookup = {tuple(sorted(facet)): i for i, facet in enumerate(backend.facets.T.tolist())}
    force = np.zeros(2 * len(mesh.positions), dtype=np.float64)
    for load in loads:
        selected = _selection(mesh, load["regions"])
        facets = np.array(
            [facet_lookup[tuple(sorted(edge))] for edge in mesh.edges[selected].tolist()]
        )
        basis = FacetBasis(backend, ElementVector(ElementTriP1()), facets=facets, intorder=8)
        coordinates, normals = np.asarray(basis.global_coordinates()), np.asarray(basis.normals)
        points = np.moveaxis(coordinates, 0, -1).reshape(-1, 2)
        normal_points = np.moveaxis(normals, 0, -1).reshape(-1, 2)
        traction = _load_traction(mesh, load, selected, points, normal_points)
        traction = np.moveaxis(traction.reshape(*coordinates.shape[1:], 2), -1, 0)

        @LinearForm
        def boundary(v, w):
            return mesh.thickness * dot(w.traction, v)

        force += asm(boundary, basis, traction=traction)
    if not np.isfinite(force).all():
        raise EngineError("invalid-load", "Integrated boundary load exceeds float64 range.")
    return force.reshape(-1, 2)


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
