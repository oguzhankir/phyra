"""Kirsch eligibility and same-location quadrature diagnostics for mesh fields.

The independent SI analytical evaluators and primary method attribution live
in physics.elasticity.kirsch. This module checks the actual study's eligibility
and compares its displacement/tensor stress at identical quadrature locations.
Linear triangles represent exact CAD circles with chords; reference evaluation
there uses the explicitly documented analytical extension to finite r>0.
"""

import math
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.physics.elasticity.kirsch import kirsch_displacement, kirsch_stress

SOURCE = "https://doi.org/10.1016/j.finel.2026.104523"
MAPPING = (
    "area-weighted L2 at identical seven-point triangle quadrature locations; "
    "stress uses tensor Frobenius norm"
)


def eligible_reference(geometry: dict[str, Any], study: dict[str, Any]) -> dict[str, Any] | None:
    """Only an exact quarter-square cutout with matching physical BCs qualifies.

    Changing an outer traction, adding a cavity load or clamping an extra DOF
    invalidates this analytical comparison, even if the geometry looks similar.
    Semantic boundary IDs may be arbitrary; classification uses exact curves.
    """
    if (
        geometry.get("kind") != "profile"
        or study.get("dimension") != "2d"
        or study.get("formulation") != "plane-stress"
    ):
        return None
    profile = geometry.get("profile", {})
    outer = profile.get("outer", [])
    if len(outer) != 5 or profile.get("holes"):
        return None
    arcs = [edge for edge in outer if edge.get("kind") == "arc"]
    lines = [edge for edge in outer if edge.get("kind") == "line"]
    if len(arcs) != 1 or len(lines) != 4:
        return None
    arc = arcs[0]
    center = np.asarray(arc["center"], dtype=np.float64)
    ends = np.asarray([arc["start"], arc["end"]], dtype=np.float64) - center
    radius = float(np.linalg.norm(ends[0]))
    tolerance = radius * 1e-10
    if radius <= 0 or not np.isclose(np.linalg.norm(ends[1]), radius, rtol=1e-10, atol=0):
        return None
    # One endpoint lies on each symmetry axis, with a 90-degree cavity arc.
    if not np.isclose(ends[0] @ ends[1], 0, atol=radius**2 * 1e-10, rtol=0):
        return None
    xend = next((p for p in ends if abs(p[1]) <= tolerance), None)
    yend = next((p for p in ends if abs(p[0]) <= tolerance), None)
    if xend is None or yend is None:
        return None
    sx, sy = np.sign(xend[0]), np.sign(yend[1])
    clockwise = bool(arc.get("clockwise", False))
    cross = ends[0, 0] * ends[1, 1] - ends[0, 1] * ends[1, 0]
    if (cross < 0) != clockwise:
        return None  # A 270-degree outer arc does not describe this quarter domain.
    boundaries: dict[str, str] = {}
    lengths = []
    for line in lines:
        p = np.asarray([line["start"], line["end"]], dtype=np.float64) - center
        if np.all(np.abs(p[:, 0]) <= tolerance):
            if not np.isclose(np.min(p[:, 1] * sy), radius, rtol=1e-10, atol=0):
                return None
            boundaries["xsym"] = line["id"]
            lengths.append(float(np.max(p[:, 1] * sy)))
        elif np.all(np.abs(p[:, 1]) <= tolerance):
            if not np.isclose(np.min(p[:, 0] * sx), radius, rtol=1e-10, atol=0):
                return None
            boundaries["ysym"] = line["id"]
            lengths.append(float(np.max(p[:, 0] * sx)))
        elif abs(p[0, 0] - p[1, 0]) <= tolerance:
            if not np.isclose(np.min(p[:, 1] * sy), 0, atol=tolerance, rtol=0):
                return None
            lengths.extend([float(p[0, 0] * sx), float(np.max(p[:, 1] * sy))])
            boundaries["xouter"] = line["id"]
        elif abs(p[0, 1] - p[1, 1]) <= tolerance:
            if not np.isclose(np.min(p[:, 0] * sx), 0, atol=tolerance, rtol=0):
                return None
            lengths.extend([float(p[0, 1] * sy), float(np.max(p[:, 0] * sx))])
            boundaries["youter"] = line["id"]
        else:
            return None
    if (
        len(boundaries) != 4
        or not lengths
        or min(lengths) <= radius
        or not np.allclose(lengths, lengths[0], rtol=1e-10, atol=0)
    ):
        return None
    constrained: set[str] = set()
    for condition in study.get("constraints", []):
        regions, components = condition["regions"], condition["components"]
        if len(components) == 3 and components[2] not in (None, 0):
            return None
        for region in regions:
            if region == boundaries["xsym"] and components[:2] == [0, None]:
                constrained.add("xsym")
            elif region == boundaries["ysym"] and components[:2] == [None, 0]:
                constrained.add("ysym")
            else:
                return None
    if constrained != {"xsym", "ysym"}:
        return None
    loaded: set[str] = set()
    tension = None
    for load in study.get("loads", []):
        traction = load.get("traction", {})
        if load.get("kind") != "traction" or traction.get("kind") != "kirsch":
            return None
        if not np.isclose(traction["radius"], radius, rtol=1e-10, atol=0) or not np.allclose(
            traction["center"], center, rtol=0, atol=tolerance
        ):
            return None
        if tension is not None and traction["tension"] != tension:
            return None
        tension = traction["tension"]
        for region in load["regions"]:
            if region not in (boundaries["xouter"], boundaries["youter"]) or region in loaded:
                return None
            loaded.add(region)
    if tension is None or loaded != {boundaries["xouter"], boundaries["youter"]}:
        return None
    return {
        "radius": radius,
        "center": center.tolist(),
        "tension": float(tension),
        "young": study["material"]["young"],
        "poisson": study["material"]["poisson"],
        "holeRegion": arc["id"],
    }


# Degree-five seven-point triangle rule, normalized to unit area. Constants
# checked against scikit-fem 12.0.2 skfem/quadrature.py; independent monomial
# integrals in test_kirsch.py verify exactness through degree five. See also
# Dunavant (1985), DOI 10.1002/nme.1620210612. Weights sum to one.
_BARYCENTRIC = np.array(
    [
        [1 / 3, 1 / 3, 1 / 3],
        [0.059715871789770, 0.470142064105115, 0.470142064105115],
        [0.470142064105115, 0.059715871789770, 0.470142064105115],
        [0.470142064105115, 0.470142064105115, 0.059715871789770],
        [0.797426985353087, 0.101286507323456, 0.101286507323456],
        [0.101286507323456, 0.797426985353087, 0.101286507323456],
        [0.101286507323456, 0.101286507323456, 0.797426985353087],
    ],
    dtype=np.float64,
)
_WEIGHTS = np.array([0.225] + [0.132394152788506] * 3 + [0.125939180544827] * 3)


def _weighted_metric(reference: np.ndarray, prediction: np.ndarray, weights: np.ndarray):
    difference = prediction - reference
    # Scaled hypot preserves very small/large finite SI values, whereas squaring
    # them can underflow or overflow before a representable norm is obtained.
    reference_magnitude = np.hypot.reduce(reference, axis=1)
    absolute = np.hypot.reduce(difference, axis=1)
    root_weight = np.sqrt(weights)
    reference_norm = math.hypot(*map(float, reference_magnitude * root_weight))
    error_norm = math.hypot(*map(float, absolute * root_weight))
    if not np.isfinite([reference_norm, error_norm]).all() or not np.isfinite(absolute).all():
        raise EngineError("invalid-reference", "Reference comparison exceeds float64 range.")
    return {
        "relativeL2": error_norm / reference_norm if reference_norm else None,
        "maxAbsolute": float(absolute.max()),
        "referenceNorm": reference_norm,
    }


def reference_diagnostics(
    mesh: Mesh2D, study: dict[str, Any], result: dict[str, Any], geometry: dict[str, Any]
) -> dict[str, Any] | None:
    """P1 FEM and analytic fields at identical physical quadrature locations.

    Integration is over the discrete mesh domain. Cavity traction measures the
    FEM cell stress at edge midpoints against the ideal circle's inward radial
    domain normal; it is a boundary residual, not an imposed nodal constraint.
    """
    parameters = eligible_reference(geometry, study)
    if parameters is None:
        return None
    positions = mesh.positions[mesh.cells, :2]
    area = 0.5 * (
        (positions[:, 1, 0] - positions[:, 0, 0]) * (positions[:, 2, 1] - positions[:, 0, 1])
        - (positions[:, 1, 1] - positions[:, 0, 1]) * (positions[:, 2, 0] - positions[:, 0, 0])
    )
    points = np.einsum("qi,eid->eqd", _BARYCENTRIC, positions).reshape(-1, 2)
    weights = (area[:, None] * _WEIGHTS[None, :]).ravel()
    arguments = {key: parameters[key] for key in ("radius", "tension", "center")}
    displacement = np.einsum(
        "qi,eid->eqd", _BARYCENTRIC, result["displacement"][mesh.cells, :2]
    ).reshape(-1, 2)
    exact_displacement = kirsch_displacement(
        points, parameters["young"], parameters["poisson"], **arguments
    )
    exact_stress = kirsch_stress(points, **arguments)
    stress = np.repeat(result["stress"][:, [0, 1, 3]], 7, axis=0)
    # Tensor Frobenius norm counts both symmetric shear entries.
    tensor_factor = np.array([1, 1, np.sqrt(2.0)])
    hole_edges = mesh.edges[mesh.edge_regions == mesh.regions.index(parameters["holeRegion"])]
    owners = {}
    for cell_index, cell in enumerate(mesh.cells):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            owners[tuple(sorted((int(cell[a]), int(cell[b]))))] = cell_index
    owner = [owners[tuple(sorted(map(int, edge)))] for edge in hole_edges]
    midpoint = mesh.positions[hole_edges, :2].mean(axis=1) - parameters["center"]
    normals = -midpoint / np.linalg.norm(midpoint, axis=1)[:, None]
    edge_stress = result["stress"][owner][:, [0, 1, 3]]
    traction = np.column_stack(
        (
            edge_stress[:, 0] * normals[:, 0] + edge_stress[:, 2] * normals[:, 1],
            edge_stress[:, 2] * normals[:, 0] + edge_stress[:, 1] * normals[:, 1],
        )
    )
    lengths = np.linalg.norm(np.diff(mesh.positions[hole_edges, :2], axis=1)[:, 0], axis=1)
    norm = np.hypot(traction[:, 0], traction[:, 1])
    rms = math.hypot(*map(float, norm * np.sqrt(lengths / lengths.sum())))
    return {
        "kind": "kirsch-plane-stress",
        "source": SOURCE,
        "mapping": MAPPING,
        "quadratureOrder": 5,
        "displacement": _weighted_metric(exact_displacement, displacement, weights),
        "stress": _weighted_metric(exact_stress * tensor_factor, stress * tensor_factor, weights),
        "holeTraction": {
            "rms": rms,
            "relativeRms": rms / abs(parameters["tension"]) if parameters["tension"] else None,
            "maxAbsolute": float(norm.max()),
        },
        "parameters": {key: value for key, value in parameters.items() if key != "holeRegion"},
    }
