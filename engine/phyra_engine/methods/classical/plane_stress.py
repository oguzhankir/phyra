"""Plane-stress elasticity solved through the maintained scikit-fem P1 adapter.

The domain lies in global xy, with physical thickness in metres. Strain order is
[xx, yy, engineering xy]; stress order is [xx, yy, tensor xy]. Constant edge
traction is integrated exactly. A total force is shared over all selected edges;
positive pressure acts inward. Thickness scales both stiffness and surface area."""

import time
import warnings
from typing import Any

import numpy as np
from scipy.sparse import csr_matrix, diags  # type: ignore[import-untyped]
from scipy.sparse.linalg import MatrixRankWarning, spsolve  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.materials.isotropic import plane_stress_matrix as constitutive_matrix
from phyra_engine.meshing.plane_stress import validate_mesh
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.classical.scikit_plane import assemble as backend_assemble
from phyra_engine.methods.classical.scikit_plane import recover_stress
from phyra_engine.physics.elasticity.plane_stress import (
    constraint_dofs,
    integrate_edge_loads,
    validate_constraints,
)
from phyra_engine.results.diagnostics import summary
from phyra_engine.results.fields import pack_stress, von_mises


def element_matrices(
    mesh: Mesh2D, young: float, poisson: float
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Independent CST regression oracle only; production uses scikit-fem."""
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
    return backend_assemble(mesh, young, poisson)


def solve_system(
    mesh: Mesh2D, young: float, poisson: float, force: np.ndarray, prescribed: dict[int, float]
) -> dict[str, Any]:
    start = time.perf_counter()
    validate_mesh(mesh)
    constitutive_matrix(young, poisson)
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
    stress = recover_stress(mesh, young, poisson, flat)
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
        integrate_edge_loads(mesh, study["loads"]),
        constraint_dofs(mesh, study["constraints"]),
    )
