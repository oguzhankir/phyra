"""Physical nondimensionalization shared by sampling, training and inference."""

from dataclasses import dataclass
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.physics.elasticity.plane_stress import constraint_dofs, edge_tractions


@dataclass(frozen=True, slots=True)
class Normalization:
    length: float
    stress: float
    displacement: float
    origin: np.ndarray
    span: np.ndarray


def normalization(mesh: Mesh2D, study: dict[str, Any]) -> Normalization:
    span = np.ptp(mesh.positions[:, :2], axis=0)
    length = float(span.max())
    traction = edge_tractions(mesh, study["loads"])
    prescribed = constraint_dofs(mesh, study["constraints"])
    stress = max(
        float(np.linalg.norm(traction, axis=1).max()),
        study["material"]["young"] * max(map(abs, prescribed.values()), default=0) / length,
        study["material"]["young"] * 1e-8,
    )
    displacement = stress * length / study["material"]["young"]
    if not np.isfinite([length, stress, displacement]).all() or displacement <= 0:
        raise EngineError(
            "invalid-normalization", "Physical inputs exceed supported scaling range."
        )
    return Normalization(length, stress, displacement, mesh.positions[:, :2].min(axis=0), span)
