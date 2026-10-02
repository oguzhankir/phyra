"""Seeded rectangular collocation with explicit boundary/sample associations."""

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import Tensor

from phyra_engine.meshing.plane_stress import edge_geometry
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.physics.elasticity.plane_stress import edge_tractions


@dataclass(frozen=True, slots=True)
class CollocationBatch:
    interior: Tensor
    boundary: Tensor
    normals: Tensor
    traction: Tensor
    constrained: Tensor
    prescribed: Tensor


def edge_components(mesh: Mesh2D, study: dict[str, Any]) -> dict[str, list[float | None]]:
    components: dict[str, list[float | None]] = {region: [None, None] for region in mesh.regions}
    for constraint in study["constraints"]:
        for region in constraint["regions"]:
            for component, value in enumerate(constraint["components"][:2]):
                if value is not None:
                    components[region][component] = float(value)
    return components


def sample_points(
    mesh: Mesh2D,
    scales: Normalization,
    configuration: TrainingConfiguration,
    study: dict[str, Any],
    rng: np.random.Generator,
    device: str,
    dtype: torch.dtype,
) -> CollocationBatch:
    interior = rng.random((configuration.interior_points, 2)) * scales.span / scales.length
    components = edge_components(mesh, study)
    tractions = edge_tractions(mesh, study["loads"])
    lengths, normals = edge_geometry(mesh)
    boundary, normal, traction, constrained, target = [], [], [], [], []
    # Sample by physical edge length inside each stable region, keeping the
    # region loss equally weighted so a short support cannot disappear.
    for ri, region in enumerate(mesh.regions):
        selected = np.flatnonzero(mesh.edge_regions == ri)
        probabilities = lengths[selected] / lengths[selected].sum()
        chosen = rng.choice(selected, size=configuration.boundary_points, p=probabilities)
        along = rng.random((len(chosen), 1))
        points = (1 - along) * mesh.positions[mesh.edges[chosen, 0], :2] + along * mesh.positions[
            mesh.edges[chosen, 1], :2
        ]
        boundary.append((points - scales.origin) / scales.length)
        normal.append(normals[chosen])
        traction.append(tractions[chosen] / scales.stress)
        flags = [value is not None for value in components[region]]
        values = [
            0 if value is None else value / scales.displacement for value in components[region]
        ]
        constrained.append(np.tile(flags, (len(chosen), 1)))
        target.append(np.tile(values, (len(chosen), 1)))

    def tensor(values: np.ndarray, requires_grad: bool = False) -> Tensor:
        return torch.tensor(values, device=device, dtype=dtype, requires_grad=requires_grad)

    return CollocationBatch(
        interior=tensor(interior, True),
        boundary=tensor(np.concatenate(boundary), True),
        normals=tensor(np.concatenate(normal)),
        traction=tensor(np.concatenate(traction)),
        constrained=tensor(np.concatenate(constrained)),
        prescribed=tensor(np.concatenate(target)),
    )
