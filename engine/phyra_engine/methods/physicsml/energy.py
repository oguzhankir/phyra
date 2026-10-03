"""Potential-energy PINN with explicit essential conditions and physical quadrature.

Adapted variational idea from Wang, Mo, Izzuddin, Kim (2023),
https://doi.org/10.1016/j.cma.2023.116184. This uses PyTorch autograd, a dense
network and triangle/facet quadrature, rather than EPINN tensor decomposition,
meshless finite differences or the paper's Modulus/GPU architecture.
Author manuscript: https://hub.hku.hk/bitstream/10722/331900/1/content.pdf
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import Tensor, nn

from phyra_engine.errors import EngineError
from phyra_engine.meshing.plane_stress import cell_areas, edge_geometry
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.elasticity import stress_and_strain
from phyra_engine.methods.physicsml.evaluation import evaluate_fields
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.physics.elasticity.plane_stress import point_tractions


@dataclass(frozen=True, slots=True)
class EnergyQuadrature:
    interior: Tensor
    area_weights: Tensor
    boundary: Tensor
    boundary_weights: Tensor
    traction: Tensor


@dataclass(frozen=True, slots=True)
class EnergyMeasurement:
    potential: float
    strain: float
    work: float

    def to_mapping(self) -> dict[str, float]:
        return {"potential": self.potential, "strain": self.strain, "work": self.work}


@dataclass(frozen=True, slots=True)
class EnergyValues:
    potential: Tensor
    strain: Tensor
    work: Tensor

    def measure(self) -> EnergyMeasurement:
        values = [float(value.detach().cpu()) for value in (self.potential, self.strain, self.work)]
        if not np.isfinite(values).all():
            raise EngineError("nonfinite-training", "Potential-energy integration was nonfinite.")
        return EnergyMeasurement(*values)


def quadrature_policy(mesh: Mesh2D, configuration: TrainingConfiguration) -> tuple[int, int]:
    subdivisions = 0
    while 3 * len(mesh.cells) * 4**subdivisions < configuration.interior_points:
        subdivisions += 1
    minimum_edges = min(
        np.count_nonzero(mesh.edge_regions == index) for index in range(len(mesh.regions))
    )
    if minimum_edges == 0:
        raise EngineError("invalid-mesh", "Every declared boundary region needs physical edges.")
    edge_subdivisions = max(1, int(np.ceil(configuration.boundary_points / (2 * minimum_edges))))
    return subdivisions, edge_subdivisions


def quadrature_arrays(
    mesh: Mesh2D,
    scales: Normalization,
    study: dict[str, Any],
    configuration: TrainingConfiguration,
    audit: bool = False,
) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    """Degree-two triangle rule; audit subdivides each triangle into four.

    Boundary work uses two-point Gauss, then five-point Gauss for the audit.
    All weights integrate area/length in coordinates normalized by L. Physical
    energy equals these dimensionless energies times stress * displacement * L
    * thickness. The physical thickness is uniform and cancels from optimization.
    """
    triangles = (mesh.positions[mesh.cells, :2] - scales.origin) / scales.length
    areas = cell_areas(mesh) / scales.length**2
    subdivisions, edge_subdivisions = quadrature_policy(mesh, configuration)
    for _ in range(subdivisions + int(audit)):
        a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
        ab, bc, ca = (a + b) / 2, (b + c) / 2, (c + a) / 2
        triangles = np.concatenate(
            [
                np.stack(vertices, axis=1)
                for vertices in ((a, ab, ca), (ab, b, bc), (ca, bc, c), (ab, bc, ca))
            ]
        )
        areas = np.tile(areas / 4, 4)
    barycentric = np.array([[2 / 3, 1 / 6, 1 / 6], [1 / 6, 2 / 3, 1 / 6], [1 / 6, 1 / 6, 2 / 3]])
    interior = np.einsum("ki,nij->nkj", barycentric, triangles).reshape(-1, 2)
    area_weights = np.repeat(areas / 3, 3)
    gauss, weights = np.polynomial.legendre.leggauss(5 if audit else 2)
    along = ((np.arange(edge_subdivisions)[:, None] + (gauss + 1) / 2) / edge_subdivisions).reshape(
        -1
    )
    weights = np.tile(weights / edge_subdivisions, edge_subdivisions)
    physical = (
        (
            mesh.positions[mesh.edges[:, 0], :2, None] * (1 - along)
            + mesh.positions[mesh.edges[:, 1], :2, None] * along
        )
        .transpose(0, 2, 1)
        .reshape(-1, 2)
    )
    boundary = (physical - scales.origin) / scales.length
    lengths, _ = edge_geometry(mesh)
    boundary_weights = (lengths[:, None] / scales.length * weights / 2).reshape(-1)
    edge_indices = np.repeat(np.arange(len(mesh.edges)), len(along))
    traction = point_tractions(mesh, study["loads"], edge_indices, physical) / scales.stress
    return interior, area_weights, boundary, boundary_weights, traction


def energy_quadrature(
    mesh: Mesh2D,
    scales: Normalization,
    study: dict[str, Any],
    configuration: TrainingConfiguration,
    device: str,
    dtype: torch.dtype,
) -> EnergyQuadrature:
    subdivisions, edge_subdivisions = quadrature_policy(mesh, configuration)
    count = 3 * len(mesh.cells) * 4**subdivisions + 2 * len(mesh.edges) * edge_subdivisions
    if count * configuration.layers * configuration.width > 1_000_000:
        raise EngineError(
            "resource-limit",
            "Reduce the energy quadrature mesh density, network width or layers: "
            "their combined training resource budget exceeds one million activations.",
        )
    arrays = quadrature_arrays(mesh, scales, study, configuration)
    return EnergyQuadrature(
        *[
            torch.tensor(array, device=device, dtype=dtype, requires_grad=index == 0)
            for index, array in enumerate(arrays)
        ]
    )


def potential_energy(model: nn.Module, material: Tensor, points: EnergyQuadrature) -> EnergyValues:
    _, stress, strain = stress_and_strain(model, points.interior, material)
    internal = 0.5 * (torch.sum(strain * stress, dim=1) * points.area_weights).sum()
    external = (
        torch.sum(model(points.boundary) * points.traction, dim=1) * points.boundary_weights
    ).sum()
    return EnergyValues(internal - external, internal, external)


def integration_audit(
    model: nn.Module,
    mesh: Mesh2D,
    study: dict[str, Any],
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
    configuration: TrainingConfiguration,
) -> EnergyMeasurement:
    interior, weights, boundary, boundary_weights, traction = quadrature_arrays(
        mesh, scales, study, configuration, True
    )
    fields = evaluate_fields(
        model, scales.origin + scales.length * interior, scales, material, device, dtype
    )
    # evaluate_fields restores physical values; undo those scales for dimensionless integration.
    strain = fields.strain * scales.length / scales.displacement
    stress = fields.stress / scales.stress
    internal = 0.5 * float(np.sum(np.sum(strain * stress, axis=1) * weights))
    displacement = (
        evaluate_fields(
            model, scales.origin + scales.length * boundary, scales, material, device, dtype
        ).displacement
        / scales.displacement
    )
    external = float(np.sum(np.sum(displacement * traction, axis=1) * boundary_weights))
    if not np.isfinite([internal, external]).all():
        raise EngineError("nonfinite-validation", "Energy integration audit was nonfinite.")
    return EnergyMeasurement(internal - external, internal, external)
