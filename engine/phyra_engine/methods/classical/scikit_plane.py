"""Narrow scikit-fem P1 vector adapter; no backend objects enter study contracts.

Assembly/quadrature and gradient recovery use scikit-fem 12.0.2's Basis and Form
API (https://scikit-fem.readthedocs.io/en/latest/api.html). The physical matrix
is Phyra's independently checked plane-stress matrix, since the library's
similarly named plane_stress helper converts E/nu to an effective material pair.
"""

import numpy as np
from scipy.sparse import csr_matrix  # type: ignore[import-untyped]
from skfem import (  # type: ignore[import-untyped]
    Basis,
    BilinearForm,
    ElementTriP1,
    ElementVector,
    MeshTri,
    asm,
)

from phyra_engine.materials.isotropic import plane_stress_matrix
from phyra_engine.meshing.types import Mesh2D


def _basis(mesh: Mesh2D) -> Basis:
    backend = MeshTri(mesh.positions[:, :2].T, mesh.cells.T, sort_t=False)
    return Basis(backend, ElementVector(ElementTriP1()), intorder=2)


def assemble(mesh: Mesh2D, young: float, poisson: float) -> csr_matrix:
    material = plane_stress_matrix(young, poisson)

    @BilinearForm
    def elasticity(u, v, w):
        strain_u = np.stack((u.grad[0, 0], u.grad[1, 1], u.grad[0, 1] + u.grad[1, 0]))
        strain_v = np.stack((v.grad[0, 0], v.grad[1, 1], v.grad[0, 1] + v.grad[1, 0]))
        return mesh.thickness * np.einsum("i...,ij,j...->...", strain_v, material, strain_u)

    basis = _basis(mesh)
    # ElementVector P1 uses interleaved global vertex DOFs; check the dependency
    # contract explicitly so an API change cannot silently permute displacement.
    if not np.array_equal(basis.nodal_dofs.T.reshape(-1), np.arange(2 * len(mesh.positions))):
        raise RuntimeError("Unsupported scikit-fem nodal degree-of-freedom ordering")
    return asm(elasticity, basis).tocsr()


def recover_stress(
    mesh: Mesh2D, young: float, poisson: float, displacement: np.ndarray
) -> np.ndarray:
    gradient = _basis(mesh).interpolate(displacement.reshape(-1)).grad
    strain = np.stack((gradient[0, 0], gradient[1, 1], gradient[0, 1] + gradient[1, 0]))
    # P1 gradients are constant per triangle; output stays associated with cells.
    return np.einsum("ij,jcq->ci", plane_stress_matrix(young, poisson), strain) / strain.shape[-1]
