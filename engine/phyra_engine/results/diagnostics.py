"""Measured force, moment and energy diagnostics for plane-stress fields."""

from typing import Any

import numpy as np

from phyra_engine.meshing.types import Mesh2D
from phyra_engine.results.fields import von_mises


def summary(
    mesh: Mesh2D,
    displacement: np.ndarray,
    stress: np.ndarray,
    reactions: np.ndarray,
    force: np.ndarray,
    energy: float,
    elapsed: float,
    relative_residual: float,
    roundoff_force: float = 0,
) -> dict[str, Any]:
    center = mesh.positions[:, :2] - mesh.positions[:, :2].mean(axis=0)
    closure = force + reactions
    force_balance = closure.sum(axis=0)
    moment = float(np.sum(center[:, 0] * closure[:, 1] - center[:, 1] * closure[:, 0]))
    force_scale = max(
        np.linalg.norm(force, axis=1).sum(),
        np.linalg.norm(reactions, axis=1).sum(),
        roundoff_force,
        np.finfo(float).tiny,
    )
    length = np.linalg.norm(np.ptp(mesh.positions[:, :2], axis=0))
    return {
        "maxDisplacement": float(np.linalg.norm(displacement, axis=1).max()),
        "maxVonMises": float(von_mises(stress).max()),
        "strainEnergy": float(energy),
        "forceBalance": [float(force_balance[0]), float(force_balance[1]), 0.0],
        "momentBalance": [0.0, 0.0, moment],
        "relativeForceBalance": float(np.linalg.norm(force_balance) / force_scale),
        "relativeMomentBalance": float(abs(moment) / (force_scale * length)),
        "relativeResidual": float(relative_residual),
        "totalForce": [*force.sum(axis=0).tolist(), 0.0],
        "totalReaction": [*reactions.sum(axis=0).tolist(), 0.0],
        "elapsedSeconds": elapsed,
    }
