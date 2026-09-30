"""Plane-stress, homogeneous isotropic elasticity using constant-strain triangles.

The domain lies in global xy, with physical thickness in metres. Strain order is
[xx, yy, engineering xy]; stress order is [xx, yy, tensor xy]. Constant edge
traction is integrated exactly. A total force is shared over all selected edges;
positive pressure acts inward. Thickness scales both stiffness and surface area.
"""

import hashlib
import math
import time
import warnings
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix, diags  # type: ignore[import-untyped]
from scipy.sparse.csgraph import connected_components  # type: ignore[import-untyped]
from scipy.sparse.linalg import MatrixRankWarning, spsolve  # type: ignore[import-untyped]

from .errors import EngineError
from .mesh import Progress
from .validation import MAX_CELLS, MAX_NODES

REGIONS_2D = ("x0", "x1", "y0", "y1")


@dataclass(frozen=True)
class Mesh2D:
    positions: np.ndarray
    cells: np.ndarray
    edges: np.ndarray
    edge_regions: np.ndarray
    regions: tuple[str, ...]
    thickness: float


def mesh_id(mesh: Mesh2D) -> str:
    digest = hashlib.sha256()
    digest.update(np.asarray(mesh.positions, dtype="<f8").tobytes())
    digest.update(np.asarray(mesh.cells, dtype="<u4").tobytes())
    return digest.hexdigest()


def cell_areas(mesh: Mesh2D) -> np.ndarray:
    p = mesh.positions[mesh.cells, :2]
    a, b = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    return (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / 2


def quality(mesh: Mesh2D) -> np.ndarray:
    p = mesh.positions[mesh.cells, :2]
    edge_sum = sum(np.sum((p[:, i] - p[:, j]) ** 2, axis=1) for i, j in ((0, 1), (1, 2), (2, 0)))
    return 4 * np.sqrt(3) * cell_areas(mesh) / edge_sum


def edge_geometry(mesh: Mesh2D) -> tuple[np.ndarray, np.ndarray]:
    direction = mesh.positions[mesh.edges[:, 1], :2] - mesh.positions[mesh.edges[:, 0], :2]
    lengths = np.linalg.norm(direction, axis=1)
    normals = np.column_stack((direction[:, 1], -direction[:, 0])) / lengths[:, None]
    return lengths, normals


def validate_mesh(mesh: Mesh2D) -> None:
    if (
        mesh.positions.ndim != 2
        or mesh.positions.shape[1] != 3
        or len(mesh.positions) < 3
        or mesh.cells.ndim != 2
        or mesh.cells.shape[1] != 3
        or not len(mesh.cells)
        or mesh.edges.ndim != 2
        or mesh.edges.shape[1] != 2
        or not len(mesh.edges)
    ):
        raise EngineError(
            "invalid-mesh", "Expected 2D nodes, triangles and oriented boundary edges."
        )
    if (
        len(mesh.positions) > MAX_NODES
        or len(mesh.cells) > MAX_CELLS
        or len(mesh.edges) > 2 * MAX_NODES
    ):
        raise EngineError("resource-limit", "The 2D mesh exceeds supported resource limits.")
    if not np.isfinite(mesh.positions).all() or np.any(mesh.positions[:, 2] != 0):
        raise EngineError(
            "invalid-mesh", "Plane-stress coordinates must be finite and lie in z = 0."
        )
    if not np.isfinite(mesh.thickness) or mesh.thickness <= 0:
        raise EngineError(
            "invalid-thickness", "Physical plate thickness must be finite and positive."
        )
    for connectivity in (mesh.cells, mesh.edges, mesh.edge_regions):
        if connectivity.dtype.kind not in "ui" or np.any(connectivity < 0):
            raise EngineError("invalid-mesh", "Connectivity must contain nonnegative integers.")
    if mesh.cells.max() >= len(mesh.positions) or mesh.edges.max() >= len(mesh.positions):
        raise EngineError("invalid-mesh", "Connectivity refers to an absent node.")
    if (
        mesh.edge_regions.shape != (len(mesh.edges),)
        or not mesh.regions
        or len(set(mesh.regions)) != len(mesh.regions)
        or mesh.edge_regions.max() >= len(mesh.regions)
    ):
        raise EngineError("invalid-mesh", "Boundary region indices are invalid.")
    points = mesh.positions[mesh.cells, :2]
    scale2 = np.max(np.sum((points[:, :, None] - points[:, None, :]) ** 2, axis=3), axis=(1, 2))
    if np.any(cell_areas(mesh) <= 64 * np.finfo(float).eps * scale2):
        raise EngineError("degenerate-mesh", "Mesh contains an inverted or degenerate triangle.")
    if len(np.unique(np.sort(mesh.cells, axis=1), axis=0)) != len(mesh.cells):
        raise EngineError("invalid-mesh", "The 2D mesh contains duplicate triangles.")
    owners: dict[tuple[int, int], list[int]] = defaultdict(list)
    for ci, cell in enumerate(mesh.cells):
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = sorted((int(cell[i]), int(cell[j])))
            owners[(a, b)].append(ci)
    if any(len(value) > 2 for value in owners.values()):
        raise EngineError("invalid-mesh", "The triangle mesh has a nonmanifold edge.")
    boundary = {edge: value[0] for edge, value in owners.items() if len(value) == 1}
    keys = [(int(min(edge)), int(max(edge))) for edge in mesh.edges]
    if len(set(keys)) != len(keys) or set(keys) != set(boundary):
        raise EngineError("invalid-mesh", "Boundary edges must cover the domain boundary exactly.")
    for edge, key in zip(mesh.edges, keys, strict=True):
        p = mesh.positions[edge, :2]
        normal = np.array([p[1, 1] - p[0, 1], p[0, 0] - p[1, 0]])
        inward = mesh.positions[mesh.cells[int(boundary[key])]][:, :2].mean(axis=0) - p.mean(axis=0)
        if np.dot(normal, inward) >= 0:
            raise EngineError(
                "invalid-mesh", "Boundary edges must point counterclockwise around the solid."
            )
    connections = np.concatenate(
        [mesh.cells[:, [0, 1]], mesh.cells[:, [1, 2]], mesh.cells[:, [2, 0]]]
    )
    graph = coo_matrix(
        (np.ones(len(connections)), (connections[:, 0], connections[:, 1])),
        shape=(len(mesh.positions), len(mesh.positions)),
    ).tocsr()
    if connected_components(graph, directed=False)[0] != 1:
        raise EngineError("disconnected-mesh", "Only a single connected 2D domain is supported.")


def generate_rectangle(length: float, width: float, thickness: float, size: float) -> Mesh2D:
    dimensions = np.asarray([length, width, thickness, size], dtype=np.float64)
    if not np.isfinite(dimensions).all() or np.any(dimensions <= 0):
        raise EngineError(
            "invalid-geometry",
            "Rectangle dimensions, thickness and mesh size must be positive and finite.",
        )
    if min(length, width) / max(length, width) < 1e-6:
        raise EngineError(
            "unsupported-geometry", "Rectangle aspect ratio exceeds the supported limit."
        )
    # Test ratios before ceil so even subnormal untrusted mesh sizes cannot
    # overflow an integer conversion or allocate a huge structured grid.
    if size < min(length, width) / MAX_NODES:
        raise EngineError("resource-limit", "Increase the 2D element size.")
    nx, ny = max(1, math.ceil(length / size)), max(1, math.ceil(width / size))
    if (nx + 1) * (ny + 1) > MAX_NODES or 2 * nx * ny > MAX_CELLS:
        raise EngineError("resource-limit", "The requested 2D mesh is too fine.")
    xs, ys = np.linspace(0, length, nx + 1), np.linspace(0, width, ny + 1)
    positions = np.array([[x, y, 0] for x in xs for y in ys], dtype=np.float64)

    def node(i: int, j: int) -> int:
        return i * (ny + 1) + j

    cells: list[tuple[int, int, int]] = []
    for i in range(nx):
        for j in range(ny):
            a, b, c, d = node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)
            cells.extend(((a, b, c), (a, c, d)))
    edges = (
        [(node(0, j + 1), node(0, j)) for j in range(ny)]
        + [(node(nx, j), node(nx, j + 1)) for j in range(ny)]
        + [(node(i, 0), node(i + 1, 0)) for i in range(nx)]
        + [(node(i + 1, ny), node(i, ny)) for i in range(nx)]
    )
    edge_regions = [0] * ny + [1] * ny + [2] * nx + [3] * nx
    mesh = Mesh2D(
        positions,
        np.asarray(cells, dtype=np.uint32),
        np.asarray(edges, dtype=np.uint32),
        np.asarray(edge_regions, dtype=np.uint32),
        REGIONS_2D,
        float(thickness),
    )
    validate_mesh(mesh)
    return mesh


def constitutive_matrix(young: float, poisson: float) -> np.ndarray:
    if not np.isfinite([young, poisson]).all() or young <= 0 or not -1 < poisson <= 0.45:
        raise EngineError(
            "invalid-material", "Plane stress requires finite E > 0 Pa and -1 < ν ≤ 0.45."
        )
    factor = young / (1 - poisson**2)
    matrix = factor * np.array(
        [[1, poisson, 0], [poisson, 1, 0], [0, 0, (1 - poisson) / 2]], dtype=np.float64
    )
    if not np.isfinite(matrix).all():
        raise EngineError("invalid-material", "Plane-stress material exceeds float64 range.")
    return matrix


def element_matrices(
    mesh: Mesh2D, young: float, poisson: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    p = mesh.positions[mesh.cells, :2]
    jacobian = np.stack((p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]), axis=2)
    areas = np.linalg.det(jacobian) / 2
    if np.any(areas <= 0):
        raise EngineError("degenerate-mesh", "Triangle area must be positive.")
    gradients = np.einsum(
        "ij,cjk->cik", np.array([[-1, -1], [1, 0], [0, 1]]), np.linalg.inv(jacobian)
    )
    strain = np.zeros((len(mesh.cells), 3, 6), dtype=np.float64)
    for local in range(3):
        x, y = gradients[:, local].T
        strain[:, 0, 2 * local] = x
        strain[:, 1, 2 * local + 1] = y
        strain[:, 2, 2 * local] = y
        strain[:, 2, 2 * local + 1] = x
    stiffness = np.einsum(
        "cai,ab,cbj,c->cij",
        strain,
        constitutive_matrix(young, poisson),
        strain,
        areas * mesh.thickness,
        optimize=True,
    )
    return strain, areas, stiffness


def assemble(mesh: Mesh2D, young: float, poisson: float) -> csr_matrix:
    _, _, local = element_matrices(mesh, young, poisson)
    dofs = (mesh.cells[:, :, None] * 2 + np.arange(2)).reshape(-1, 6)
    return coo_matrix(
        (
            local.reshape(-1),
            (
                np.broadcast_to(dofs[:, :, None], local.shape).reshape(-1),
                np.broadcast_to(dofs[:, None, :], local.shape).reshape(-1),
            ),
        ),
        shape=(2 * len(mesh.positions), 2 * len(mesh.positions)),
    ).tocsr()


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


def integrate_surface_loads(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
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


def pack_stress(stress: np.ndarray) -> np.ndarray:
    packed = np.zeros((len(stress), 6), dtype=np.float64)
    packed[:, [0, 1, 3]] = stress
    return packed


def von_mises(stress: np.ndarray) -> np.ndarray:
    xx, yy, xy = stress.T
    return np.sqrt(np.maximum(0, xx**2 - xx * yy + yy**2 + 3 * xy**2))


def summary(
    mesh: Mesh2D,
    displacement: np.ndarray,
    stress: np.ndarray,
    reactions: np.ndarray,
    force: np.ndarray,
    energy: float,
    elapsed: float,
    relative_residual: float,
    roundoff_force: float = 0,
) -> dict[str, Any]:
    center = mesh.positions[:, :2] - mesh.positions[:, :2].mean(axis=0)
    closure = force + reactions
    force_balance = closure.sum(axis=0)
    moment = float(np.sum(center[:, 0] * closure[:, 1] - center[:, 1] * closure[:, 0]))
    force_scale = max(
        np.linalg.norm(force, axis=1).sum(),
        np.linalg.norm(reactions, axis=1).sum(),
        roundoff_force,
        np.finfo(float).tiny,
    )
    length = np.linalg.norm(np.ptp(mesh.positions[:, :2], axis=0))
    return {
        "maxDisplacement": float(np.linalg.norm(displacement, axis=1).max()),
        "maxVonMises": float(von_mises(stress).max()),
        "strainEnergy": float(energy),
        "forceBalance": [float(force_balance[0]), float(force_balance[1]), 0.0],
        "momentBalance": [0.0, 0.0, moment],
        "relativeForceBalance": float(np.linalg.norm(force_balance) / force_scale),
        "relativeMomentBalance": float(abs(moment) / (force_scale * length)),
        "relativeResidual": float(relative_residual),
        "totalForce": [*force.sum(axis=0).tolist(), 0.0],
        "totalReaction": [*reactions.sum(axis=0).tolist(), 0.0],
        "elapsedSeconds": elapsed,
    }


def solve_system(
    mesh: Mesh2D, young: float, poisson: float, force: np.ndarray, prescribed: dict[int, float]
) -> dict[str, Any]:
    start = time.perf_counter()
    validate_mesh(mesh)
    material = constitutive_matrix(young, poisson)
    validate_constraints(mesh, prescribed)
    force = np.asarray(force, dtype=np.float64)
    if force.shape != (len(mesh.positions), 2) or not np.isfinite(force).all():
        raise EngineError("invalid-load", "Nodal force dimensions or values are invalid.")
    stiffness = assemble(mesh, young, poisson)
    if not np.isfinite(stiffness.data).all():
        raise EngineError("invalid-stiffness", "Plane-stress stiffness exceeds float64 range.")
    fixed = np.array(sorted(prescribed), dtype=np.int64)
    free = np.setdiff1d(np.arange(2 * len(mesh.positions)), fixed, assume_unique=True)
    flat = np.zeros(2 * len(mesh.positions), dtype=np.float64)
    flat[fixed] = [prescribed[int(dof)] for dof in fixed]
    rhs = force.reshape(-1)
    if len(free):
        reduced = stiffness[free][:, free].tocsc()
        diagonal = reduced.diagonal()
        if np.any(diagonal <= 0):
            raise EngineError("singular-system", "Plane-stress stiffness diagonal is nonpositive.")
        scale = np.sqrt(diagonal)
        inverse = diags(1 / scale)
        with warnings.catch_warnings(record=True) as emitted:
            warnings.simplefilter("always")
            solution = spsolve(
                inverse @ reduced @ inverse,
                (rhs[free] - stiffness[free][:, fixed] @ flat[fixed]) / scale,
                use_umfpack=False,
            )
        if emitted:
            code = (
                "singular-system"
                if any(issubclass(item.category, MatrixRankWarning) for item in emitted)
                else "solve-warning"
            )
            raise EngineError(code, "; ".join(str(item.message) for item in emitted))
        flat[free] = solution / scale
    internal = stiffness @ flat
    residual = internal - rhs
    algebraic = abs(stiffness) @ np.abs(flat)
    roundoff_factor = 128 * np.finfo(float).eps / 1e-8
    residual_scale = max(
        np.linalg.norm(rhs),
        np.linalg.norm(internal),
        roundoff_factor * np.linalg.norm(algebraic),
        np.finfo(float).tiny,
    )
    relative_residual = float(np.linalg.norm(residual[free]) / residual_scale)
    if (
        not np.isfinite(flat).all()
        or not np.isfinite(relative_residual)
        or relative_residual > 1e-8
    ):
        raise EngineError(
            "residual-failed",
            "Plane-stress solution is nonfinite or violates free-DOF equilibrium.",
        )
    reactions = np.zeros_like(flat)
    reactions[fixed] = residual[fixed]
    strain, _, _ = element_matrices(mesh, young, poisson)
    stress = np.einsum(
        "ab,cbi,ci->ca", material, strain, flat.reshape(-1, 2)[mesh.cells].reshape(-1, 6)
    )
    displacement = flat.reshape(-1, 2)
    reaction_nodes = reactions.reshape(-1, 2)
    diagnostic = summary(
        mesh,
        displacement,
        stress,
        reaction_nodes,
        force,
        0.5 * flat @ internal,
        time.perf_counter() - start,
        relative_residual,
        roundoff_factor * np.sum(algebraic),
    )
    if max(diagnostic["relativeForceBalance"], diagnostic["relativeMomentBalance"]) > 1e-8:
        raise EngineError(
            "equilibrium-failed", "Plane-stress global force or moment equilibrium failed."
        )
    if not np.isfinite(stress).all():
        raise EngineError("nonfinite-result", "Plane-stress recovery is nonfinite.")
    return {
        "displacement": np.column_stack((displacement, np.zeros(len(displacement)))),
        "stress": pack_stress(stress),
        "vonMises": von_mises(stress),
        "reactions": np.column_stack((reaction_nodes, np.zeros(len(reaction_nodes)))),
        "summary": diagnostic,
    }


def solve_mesh(
    mesh: Mesh2D, study: dict[str, Any], progress: Progress | None = None
) -> dict[str, Any]:
    if progress:
        progress("plane-stress-assembly-and-factorization", None)
    return solve_system(
        mesh,
        study["material"]["young"],
        study["material"]["poisson"],
        integrate_surface_loads(mesh, study["loads"]),
        constraint_dofs(mesh, study["constraints"]),
    )


def integrate_edge_loads(mesh: Mesh2D, loads: list[dict[str, Any]]) -> np.ndarray:
    """Nodal SI forces obtained by exact integration of selected edge tractions."""
    return integrate_surface_loads(mesh, loads)
