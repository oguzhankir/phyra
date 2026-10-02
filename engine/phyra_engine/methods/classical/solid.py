"""Small-strain isotropic static elasticity, linear four-node tetrahedral FEM.

Solve div(sigma) + b = 0 with sigma = lambda*tr(epsilon)*I + 2*mu*epsilon.
No body-force editor is currently exposed. Each cell has constant strain/stress.
Strain vectors contain engineering shear [xx, yy, zz, 2xy, 2yz, 2xz]; stress
vectors use physical tensor shear [xx, yy, zz, xy, yz, xz]. Surface integration
uses exact linear-triangle weights. Positive pressure acts into the material.
Prescribed DOFs are eliminated; reactions use the original stiffness and loads."""

import time
import warnings
from typing import Any

import numpy as np
from scipy.sparse import coo_matrix, csr_matrix  # type: ignore[import-untyped]
from scipy.sparse.linalg import MatrixRankWarning, spsolve  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.materials.isotropic import solid_matrix as constitutive_matrix
from phyra_engine.meshing.solid import validate_mesh
from phyra_engine.meshing.types import Mesh
from phyra_engine.physics.elasticity.solid import (
    constraint_dofs,
    integrate_surface_loads,
    validate_rigid_restraints,
)


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
    validate_rigid_restraints(mesh, fixed)
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
