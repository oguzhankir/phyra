"""Chunked physical field evaluation and learned support-traction integration.

Inference evaluates displacement at requested nodes and stresses at declared
cell centroids. It never derives learned fields from the FEM reference.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import Tensor, nn

from phyra_engine.meshing.plane_stress import edge_geometry
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.elasticity import stress_and_strain
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.methods.physicsml.sampling import edge_components
from phyra_engine.physics.elasticity.plane_stress import point_tractions


@dataclass(frozen=True, slots=True)
class EvaluatedFields:
    displacement: np.ndarray
    stress: np.ndarray
    strain: np.ndarray


def evaluate_fields(
    model: nn.Module,
    locations: np.ndarray,
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> EvaluatedFields:
    output, stresses, strains = [], [], []
    # Bound autograd working memory independently of the rendering mesh size.
    for begin in range(0, len(locations), 1024):
        coordinates = torch.tensor(
            (locations[begin : begin + 1024] - scales.origin) / scales.length,
            device=device,
            dtype=dtype,
            requires_grad=True,
        )
        displacement, stress, strain = stress_and_strain(model, coordinates, material)
        output.append(displacement.detach().cpu().numpy().astype(np.float64) * scales.displacement)
        stresses.append(stress.detach().cpu().numpy().astype(np.float64) * scales.stress)
        strains.append(
            strain.detach().cpu().numpy().astype(np.float64) * scales.displacement / scales.length
        )
    return EvaluatedFields(
        np.concatenate(output), np.concatenate(stresses), np.concatenate(strains)
    )


def support_reactions(
    model: nn.Module,
    mesh: Mesh2D,
    study: dict[str, Any],
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> np.ndarray:
    lengths, normals = edge_geometry(mesh)
    flags = np.array(
        [
            [value is not None for value in edge_components(mesh, study)[mesh.regions[int(ri)]]]
            for ri in mesh.edge_regions
        ]
    )
    abscissas, weights = np.polynomial.legendre.leggauss(4)
    along = (abscissas + 1) / 2
    positions = mesh.positions[mesh.edges, :2]
    samples = (
        positions[:, :1] * (1 - along[None, :, None]) + positions[:, 1:] * along[None, :, None]
    )
    stress = evaluate_fields(model, samples.reshape(-1, 2), scales, material, device, dtype).stress
    stress = stress.reshape(len(mesh.edges), 4, 3)
    traction = np.stack(
        (
            stress[:, :, 0] * normals[:, :1] + stress[:, :, 2] * normals[:, 1:],
            stress[:, :, 2] * normals[:, :1] + stress[:, :, 1] * normals[:, 1:],
        ),
        axis=2,
    )
    applied = point_tractions(
        mesh, study["loads"], np.repeat(np.arange(len(mesh.edges)), 4), samples.reshape(-1, 2)
    )
    traction -= applied.reshape(len(mesh.edges), 4, 2)
    reactions = np.zeros((len(mesh.positions), 2), dtype=np.float64)
    for corner, shape in enumerate((1 - along, along)):
        contribution = np.einsum(
            "egi,g,g,e,ei->ei", traction, weights / 2, shape, lengths * mesh.thickness, flags
        )
        np.add.at(reactions, mesh.edges[:, corner], contribution)
    # A support balances the difference between learned constitutive traction
    # and explicitly applied traction on that same constrained edge component.
    # Corners have zero measure; natural traction on an adjacent free edge is
    # not subtracted a second time merely because a shared node is prescribed.
    return reactions
