"""Small-strain isotropic static elasticity, linear four-node tetrahedral FEM.

Solve div(sigma) + b = 0 with sigma = lambda*tr(epsilon)*I + 2*mu*epsilon.
No body-force editor is currently exposed. Each cell has constant strain/stress.
Strain vectors contain engineering shear [xx, yy, zz, 2xy, 2yz, 2xz]; stress
vectors use physical tensor shear [xx, yy, zz, xy, yz, xz]. Surface integration
uses exact linear-triangle weights. Positive pressure acts into the material.
Prescribed DOFs are eliminated; reactions use the original stiffness and loads.
"""

import time
import warnings
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix  # type: ignore[import-untyped]
from scipy.sparse.linalg import MatrixRankWarning, spsolve  # type: ignore[import-untyped]

from .errors import EngineError
from .mesh import Mesh, Progress, validate_mesh

STRESS_COMPONENTS = ["xx", "yy", "zz", "xy", "yz", "xz"]


def constitutive_matrix(young: float, poisson: float) -> np.ndarray:
    if not np.isfinite([young, poisson]).all() or young <= 0 or not -1 < poisson <= 0.45:
        raise EngineError("invalid-material", "Use finite E > 0 Pa and -1 < Poisson ratio ≤ 0.45.")
    shear = young / (2 * (1 + poisson))
    lame = young * poisson / ((1 + poisson) * (1 - 2 * poisson))
    matrix = np.zeros((6, 6), dtype=np.float64)
    matrix[:3, :3] = lame
    matrix[np.arange(3), np.arange(3)] += 2 * shear
    matrix[np.arange(3, 6), np.arange(3, 6)] = shear
    if not np.isfinite(matrix).all():
        raise EngineError("invalid-material", "Material values exceed float64 constitutive range.")
    return matrix


def element_matrices(
    positions: np.ndarray, cells: np.ndarray, young: float, poisson: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    material = constitutive_matrix(young, poisson)
    points = positions[cells]
    jacobian = np.stack(
        (points[:, 1] - points[:, 0], points[:, 2] - points[:, 0], points[:, 3] - points[:, 0]),
        axis=2,
    )
    volumes = np.linalg.det(jacobian) / 6
    edge_scale = np.max(
        np.linalg.norm(points[:, :, None] - points[:, None, :], axis=3), axis=(1, 2)
    )
    if np.any(volumes <= 64 * np.finfo(float).eps * edge_scale**3):
        raise EngineError("degenerate-mesh", "Element is inverted or too degenerate for float64.")
    # Reference tetrahedron gradients transform by J^-T. Using edge differences
    # avoids dependence on the arbitrary global coordinate origin.
    gradients = np.einsum(
        "ij,cjk->cik",
        np.array([[-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1]]),
        np.linalg.inv(jacobian),
    )
    strain = np.zeros((len(cells), 6, 12), dtype=np.float64)
    for node in range(4):
        x, y, z = gradients[:, node, :].T
        column = 3 * node
        strain[:, 0, column] = x
        strain[:, 1, column + 1] = y
        strain[:, 2, column + 2] = z
        strain[:, 3, column] = y
        strain[:, 3, column + 1] = x
        strain[:, 4, column + 1] = z
        strain[:, 4, column + 2] = y
        strain[:, 5, column] = z
        strain[:, 5, column + 2] = x
    # Evaluate V Bᵀ D B in a fixed order, scaling by volume last. Planner-dependent
    # scaling and BLAS products can amplify cancellation for rigid motions;
    # these explicit contractions preserve the same mathematics.
    constitutive_strain = np.einsum("ab,cbj->caj", material, strain, optimize=False)
    stiffness = (
        np.einsum("cai,caj->cij", strain, constitutive_strain, optimize=False)
        * volumes[:, None, None]
    )
    return strain, volumes, stiffness


def assemble(mesh: Mesh, young: float, poisson: float) -> csr_matrix:
    # Bound work by the validated mesh limits. Chunk element tensors so only the
    # COO global entries, rather than all B and Ke arrays, remain alive together.
    rows, columns, data = [], [], []
    for start in range(0, len(mesh.cells), 2048):
        cells = mesh.cells[start : start + 2048]
        _, _, local = element_matrices(mesh.positions, cells, young, poisson)
        dofs = (cells[:, :, None] * 3 + np.arange(3)).reshape(-1, 12)
        rows.append(np.broadcast_to(dofs[:, :, None], local.shape).reshape(-1))
        columns.append(np.broadcast_to(dofs[:, None, :], local.shape).reshape(-1))
        data.append(local.reshape(-1))
    size = 3 * len(mesh.positions)
    stiffness = coo_matrix(
        (np.concatenate(data), (np.concatenate(rows), np.concatenate(columns))), shape=(size, size)
    ).tocsr()
    stiffness.eliminate_zeros()
    if not np.isfinite(stiffness.data).all():
        raise EngineError("invalid-stiffness", "Assembled stiffness exceeds finite float64 range.")
    return stiffness


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


def solve_system(
    mesh: Mesh, young: float, poisson: float, force: np.ndarray, prescribed: dict[int, float]
) -> dict[str, Any]:
    started = time.perf_counter()
    validate_mesh(mesh)
    constitutive = constitutive_matrix(young, poisson)
    force = np.asarray(force, dtype=np.float64)
    if force.shape != mesh.positions.shape or not np.isfinite(force).all():
        raise EngineError("invalid-load", "Nodal forces must match node dimensions and be finite.")
    ndof = 3 * len(mesh.positions)
    if any(
        type(dof) is not int or not 0 <= dof < ndof or not np.isfinite(value)
        for dof, value in prescribed.items()
    ):
        raise EngineError("invalid-constraint", "Prescribed DOFs or values are invalid.")
    fixed = np.array(sorted(prescribed), dtype=np.int64)
    _rigid_rank(mesh, fixed)
    free = np.setdiff1d(np.arange(ndof), fixed, assume_unique=True)
    stiffness = assemble(mesh, young, poisson)
    displacement: np.ndarray = np.zeros(ndof, dtype=np.float64)
    displacement[fixed] = [prescribed[int(dof)] for dof in fixed]
    rhs = force.reshape(-1)
    if len(free):
        reduced = stiffness[free][:, free].tocsc()
        diagonal = reduced.diagonal()
        if np.any(diagonal <= 0) or not np.isfinite(diagonal).all():
            raise EngineError(
                "singular-system", "Free stiffness diagonal is nonpositive or invalid."
            )
        scale = np.sqrt(diagonal)
        # Congruence scaling improves units/diagonal conditioning without changing
        # equations, adding stiffness, or inserting any constraints.
        from scipy.sparse import diags

        inverse = diags(1 / scale)
        reduced = inverse @ reduced @ inverse
        reduced_rhs = (rhs[free] - stiffness[free][:, fixed] @ displacement[fixed]) / scale
        try:
            with warnings.catch_warnings(record=True) as emitted:
                warnings.simplefilter("always")
                free_solution = spsolve(reduced, reduced_rhs, use_umfpack=False)
            if emitted:
                message = "; ".join(str(item.message) for item in emitted)
                code = (
                    "singular-system"
                    if any(issubclass(item.category, MatrixRankWarning) for item in emitted)
                    else "solve-warning"
                )
                raise EngineError(code, f"Sparse solve reported: {message}")
        except EngineError:
            raise
        except Exception as error:
            raise EngineError("solve-failed", f"Sparse factorization failed: {error}") from error
        displacement[free] = free_solution / scale
    if not np.isfinite(displacement).all():
        raise EngineError("nonfinite-result", "Sparse solution contains nonfinite displacements.")
    internal = stiffness @ displacement
    residual = internal - rhs
    reactions: np.ndarray = np.zeros(ndof, dtype=np.float64)
    reactions[fixed] = residual[fixed]
    # Residual and equilibrium tolerances combine physical load scales with an
    # explicit float64 roundoff bound. A prescribed rigid translation has zero
    # physical stress; dividing cancellation noise by its nearzero force is not
    # a useful diagnostic. This is tolerance scaling, never added stiffness.
    algebraic_forcing = abs(stiffness) @ np.abs(displacement)
    roundoff_factor = 128 * np.finfo(float).eps / 1e-8
    denominator = max(
        np.linalg.norm(rhs),
        np.linalg.norm(internal),
        roundoff_factor * np.linalg.norm(algebraic_forcing),
        np.finfo(float).tiny,
    )
    relative_residual = float(np.linalg.norm(residual[free]) / denominator)
    if relative_residual > 1e-8:
        raise EngineError(
            "residual-failed",
            "Free-DOF equilibrium residual exceeds 1e-8. "
            "Check mesh quality and support conditioning.",
        )
    stress = np.empty((len(mesh.cells), 6), dtype=np.float64)
    for start in range(0, len(mesh.cells), 2048):
        cells = mesh.cells[start : start + 2048]
        strain, _, _ = element_matrices(mesh.positions, cells, young, poisson)
        local = displacement.reshape(-1, 3)[cells].reshape(-1, 12)
        stress[start : start + len(cells)] = np.einsum(
            "ab,cbi,ci->ca", constitutive, strain, local, optimize=True
        )
    xx, yy, zz, xy, yz, xz = stress.T
    von_mises = np.sqrt(
        np.maximum(
            0, ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) / 2 + 3 * (xy**2 + yz**2 + xz**2)
        )
    )
    reactions = reactions.reshape(-1, 3)
    displacement = displacement.reshape(-1, 3)
    force_balance = (force + reactions).sum(axis=0)
    centered = mesh.positions - mesh.positions.mean(axis=0)
    moment_balance = np.cross(centered, force + reactions).sum(axis=0)
    force_scale = max(
        np.linalg.norm(force, axis=1).sum(),
        np.linalg.norm(reactions, axis=1).sum(),
        roundoff_factor * np.sum(algebraic_forcing),
        np.finfo(float).tiny,
    )
    length = np.linalg.norm(np.ptp(mesh.positions, axis=0))
    relative_force = float(np.linalg.norm(force_balance) / force_scale)
    relative_moment = float(np.linalg.norm(moment_balance) / (force_scale * length))
    if max(relative_force, relative_moment) > 1e-8:
        raise EngineError(
            "equilibrium-failed",
            "Global force or moment equilibrium exceeds the 1e-8 relative tolerance.",
        )
    if not np.isfinite(stress).all() or not np.isfinite(von_mises).all():
        raise EngineError("nonfinite-result", "Stress recovery contains nonfinite values.")
    summary = {
        "maxDisplacement": float(np.linalg.norm(displacement, axis=1).max()),
        "maxVonMises": float(von_mises.max()),
        "strainEnergy": float(0.5 * displacement.reshape(-1) @ internal),
        "forceBalance": force_balance.tolist(),
        "momentBalance": moment_balance.tolist(),
        "relativeForceBalance": relative_force,
        "relativeMomentBalance": relative_moment,
        "relativeResidual": relative_residual,
        "totalForce": force.sum(axis=0).tolist(),
        "totalReaction": reactions.sum(axis=0).tolist(),
        "elapsedSeconds": time.perf_counter() - started,
    }
    return {
        "displacement": displacement,
        "stress": stress,
        "vonMises": von_mises,
        "reactions": reactions,
        "summary": summary,
    }


def solve_mesh(
    mesh: Mesh, study: dict[str, Any], progress: Progress | None = None
) -> dict[str, Any]:
    if progress:
        progress("validating", None)
    validate_mesh(mesh)
    force = integrate_surface_loads(mesh, study["loads"])
    prescribed = constraint_dofs(mesh, study["constraints"])
    if progress:
        progress("assembly-and-factorization", None)
    result = solve_system(
        mesh, study["material"]["young"], study["material"]["poisson"], force, prescribed
    )
    if progress:
        progress("results-ready", 1)
    return result
