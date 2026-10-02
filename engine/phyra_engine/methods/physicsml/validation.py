"""Independent within-instance residual measurements after optimization."""

from typing import Any

import numpy as np
import torch
from torch import Tensor, nn

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.elasticity import residual_losses
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.methods.physicsml.sampling import sample_points


def evaluate_held_out(
    model: nn.Module,
    mesh: Mesh2D,
    study: dict[str, Any],
    configuration: TrainingConfiguration,
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> dict[str, Any]:
    """Neither optimize nor certify field accuracy.

    The strong-form and boundary loss definitions follow the adapted PINN method
    cited in elasticity.py. A separate deterministic sampling stream is evaluated
    only after Adam finishes, so these points never supply parameter gradients.
    """
    seed = configuration.seed ^ 0x5EED5EED
    points = sample_points(
        mesh, scales, configuration, study, np.random.default_rng(seed), device, dtype
    )
    losses = residual_losses(model, material, points)
    if not losses.is_finite():
        raise EngineError("nonfinite-validation", "Held-out residual evaluation was nonfinite.")
    return {
        "schemaVersion": 1,
        "sampling": "independent-uniform",
        "seed": seed,
        "interiorPoints": configuration.interior_points,
        "boundaryPointsPerRegion": configuration.boundary_points,
        **losses.measure().to_mapping(),
    }
