"""SI homogeneous isotropic elasticity; strain vectors use engineering shear."""

import numpy as np

from phyra_engine.errors import EngineError


def solid_matrix(young: float, poisson: float) -> np.ndarray:
    if not np.isfinite([young, poisson]).all() or young <= 0 or not -1 < poisson <= 0.45:
        raise EngineError("invalid-material", "Use finite E > 0 Pa and -1 < Poisson ratio ≤ 0.45.")
    shear = young / (2 * (1 + poisson))
    lame = young * poisson / ((1 + poisson) * (1 - 2 * poisson))
    matrix = np.zeros((6, 6), dtype=np.float64)
    matrix[:3, :3] = lame
    matrix[np.arange(3), np.arange(3)] += 2 * shear
    matrix[np.arange(3, 6), np.arange(3, 6)] = shear
    if not np.isfinite(matrix).all():
        raise EngineError("invalid-material", "Material values exceed float64 constitutive range.")
    return matrix


def plane_stress_matrix(young: float, poisson: float) -> np.ndarray:
    if not np.isfinite([young, poisson]).all() or young <= 0 or not -1 < poisson <= 0.45:
        raise EngineError(
            "invalid-material", "Plane stress requires finite E > 0 Pa and -1 < ν ≤ 0.45."
        )
    factor = young / (1 - poisson**2)
    matrix = factor * np.array(
        [[1, poisson, 0], [poisson, 1, 0], [0, 0, (1 - poisson) / 2]], dtype=np.float64
    )
    if not np.isfinite(matrix).all():
        raise EngineError("invalid-material", "Plane-stress material exceeds float64 range.")
    return matrix
