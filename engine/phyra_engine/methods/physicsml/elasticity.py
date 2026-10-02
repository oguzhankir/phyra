"""Strong-form plane-stress elasticity differentiated with PyTorch autograd.

Adapted governing-equation residual method: Raissi, Perdikaris, Karniadakis (2019),
https://doi.org/10.1016/j.jcp.2018.10.045; this is not a reproduction of its experiments.
Autograd API: https://docs.pytorch.org/docs/stable/autograd.html
"""

from dataclasses import dataclass

import torch
from torch import Tensor, nn

from phyra_engine.methods.physicsml.sampling import CollocationBatch


@dataclass(frozen=True, slots=True)
class LossMetrics:
    total: float
    pde: float
    boundary: float
    displacement: float
    traction: float

    def to_mapping(self) -> dict[str, float]:
        return {
            "total": self.total,
            "pde": self.pde,
            "boundary": self.boundary,
            "displacement": self.displacement,
            "traction": self.traction,
        }


@dataclass(frozen=True, slots=True)
class ResidualLosses:
    total: Tensor
    pde: Tensor
    boundary: Tensor
    displacement: Tensor
    traction: Tensor

    def is_finite(self) -> bool:
        return all(
            bool(torch.isfinite(value))
            for value in (self.total, self.pde, self.boundary, self.displacement, self.traction)
        )

    def measure(self) -> LossMetrics:
        return LossMetrics(
            *(
                float(value.detach().cpu())
                for value in (self.total, self.pde, self.boundary, self.displacement, self.traction)
            )
        )


def stress_and_strain(
    model: nn.Module, coordinates: Tensor, material_normalized: Tensor
) -> tuple[Tensor, Tensor, Tensor]:
    """Normalized stress and engineering strain using true spatial autograd."""
    displacement = model(coordinates)
    dx = torch.autograd.grad(displacement[:, 0].sum(), coordinates, create_graph=True)[0]
    dy = torch.autograd.grad(displacement[:, 1].sum(), coordinates, create_graph=True)[0]
    strain = torch.stack((dx[:, 0], dy[:, 1], dx[:, 1] + dy[:, 0]), dim=1)
    return displacement, strain @ material_normalized.T, strain


def equilibrium_residual(stress: Tensor, coordinates: Tensor) -> Tensor:
    derivatives = [
        torch.autograd.grad(stress[:, component].sum(), coordinates, create_graph=True)[0]
        for component in range(3)
    ]
    return torch.stack(
        (derivatives[0][:, 0] + derivatives[2][:, 1], derivatives[2][:, 0] + derivatives[1][:, 1]),
        dim=1,
    )


def residual_losses(model: nn.Module, material: Tensor, points: CollocationBatch) -> ResidualLosses:
    """Actual PDE and boundary residuals; no reference fields enter this objective."""
    _, stress, _ = stress_and_strain(model, points.interior, material)
    pde = equilibrium_residual(stress, points.interior).square().mean()
    displacement, edge_stress, _ = stress_and_strain(model, points.boundary, material)
    traction = torch.stack(
        (
            edge_stress[:, 0] * points.normals[:, 0] + edge_stress[:, 2] * points.normals[:, 1],
            edge_stress[:, 2] * points.normals[:, 0] + edge_stress[:, 1] * points.normals[:, 1],
        ),
        dim=1,
    )
    free = 1 - points.constrained
    traction_loss = ((traction - points.traction) * free).square().sum() / torch.clamp(
        free.sum(), min=1
    )
    displacement_loss = (
        (displacement - points.prescribed) * points.constrained
    ).square().sum() / torch.clamp(points.constrained.sum(), min=1)
    boundary_loss = traction_loss + displacement_loss
    return ResidualLosses(pde + boundary_loss, pde, boundary_loss, displacement_loss, traction_loss)
