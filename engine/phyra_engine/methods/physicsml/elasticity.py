"""Strong-form plane-stress elasticity differentiated with PyTorch autograd.

Adapted governing-equation residual method: Raissi, Perdikaris, Karniadakis (2019),
https://doi.org/10.1016/j.jcp.2018.10.045; this is not a reproduction of its experiments.
Autograd API: https://docs.pytorch.org/docs/stable/autograd.html
"""

import torch
from torch import Tensor, nn


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
