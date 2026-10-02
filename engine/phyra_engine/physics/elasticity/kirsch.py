"""Independent Kirsch reference for isotropic plane stress in SI.

Le-Duc, Nguyen-Xuan and Lee, DOI 10.1016/j.finel.2026.104523, §6.3 and
Appendix B.2 Eq. (81), provide the Cartesian displacement solution. The
paper-linked author source resolves its abbreviated outer-boundary statement:
https://github.com/ThangLe-duc/nEPINN/blob/0889268fbb3cb5cbbf92b4b9c7cf2c90f79fad75/Elasticity_2Dand3D/PlateWithHole.py
It applies the exact Kirsch stress times the outward normal on both finite
outer edges of the second-quadrant quarter plate. Radius=1, half-width=4,
E=1e5, nu=.3, tension=.5 are author-code values; their physical units and
thickness are unstated. Phyra supplies an explicitly chosen SI realization,
not a claim about paper units or a reproduction of its neural method.

The evaluators contain no FEM imports or assembly. Their algebraic extension
is defined at every finite r>0, including the thin chord approximation of an
exact circular boundary in a linear triangular mesh. The physical reference
is an infinite plate outside r>=radius, restricted by exact outer tractions.
"""

from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_CELLS


def _number(value: Any) -> bool:
    return type(value) in (int, float) and np.isfinite(value)


def _coordinates(points: np.ndarray, radius: float, tension: float, center: Any):
    if not _number(radius) or radius <= 0 or not _number(tension):
        raise EngineError(
            "invalid-reference", "Kirsch requires finite radius > 0 m and tension Pa."
        )
    center = np.asarray(center, dtype=np.float64)
    points = np.asarray(points, dtype=np.float64)
    if (
        center.shape != (2,)
        or not np.isfinite(center).all()
        or points.ndim != 2
        or points.shape[1] not in (2, 3)
        or not 0 < len(points) <= 7 * MAX_CELLS
        or not np.isfinite(points).all()
        or points.shape[1] == 3
        and np.any(points[:, 2] != 0)
    ):
        raise EngineError(
            "invalid-reference", "Kirsch points and center must be finite planar SI coordinates."
        )
    try:
        with np.errstate(over="raise", divide="raise", invalid="raise"):
            delta = points[:, :2] - center
            distance = np.hypot(delta[:, 0], delta[:, 1])
            if np.any(distance == 0):
                raise EngineError(
                    "undefined-reference", "Kirsch is undefined at the cavity center."
                )
            cosine, sine = delta[:, 0] / distance, delta[:, 1] / distance
            ratio = radius / distance
    except FloatingPointError as error:
        raise EngineError(
            "invalid-reference", "Kirsch coordinates exceed float64 range."
        ) from error
    return delta, distance, cosine, sine, ratio


def kirsch_displacement(
    points: np.ndarray,
    young: float,
    poisson: float,
    radius: float,
    tension: float,
    center: Any = (0.0, 0.0),
) -> np.ndarray:
    """Cartesian displacement [ux,uy] in m, using the plane-stress Eq. (81)."""
    if not _number(young) or young <= 0 or not _number(poisson) or not -1 < poisson <= 0.45:
        raise EngineError("invalid-reference", "Kirsch requires E > 0 Pa and -1 < nu <= 0.45.")
    delta, distance, c, s, ratio = _coordinates(points, radius, tension, center)
    try:
        with np.errstate(over="raise", divide="raise", invalid="raise"):
            ratio2 = ratio**2
            harmonic = 0.5 * (1 + poisson) * distance * (ratio2 - ratio2**2)
            result = (tension / young) * np.column_stack(
                (
                    delta[:, 0] * (1 + 2 * ratio2) + harmonic * (4 * c**3 - 3 * c),
                    -delta[:, 1] * (poisson + (1 - poisson) * ratio2)
                    + harmonic * (3 * s - 4 * s**3),
                )
            )
    except FloatingPointError as error:
        raise EngineError(
            "invalid-reference", "Kirsch displacement exceeds float64 range."
        ) from error
    if not np.isfinite(result).all():
        raise EngineError("invalid-reference", "Kirsch displacement exceeds float64 range.")
    return result


def kirsch_stress(
    points: np.ndarray, radius: float, tension: float, center: Any = (0.0, 0.0)
) -> np.ndarray:
    """Cartesian stress [sigma_xx,sigma_yy,sigma_xy] in Pa; tensor shear."""
    _, _, c, s, ratio = _coordinates(points, radius, tension, center)
    try:
        with np.errstate(over="raise", divide="raise", invalid="raise"):
            q = ratio**2
            rr = tension / 2 * ((1 - q) + (1 - 4 * q + 3 * q**2) * (c * c - s * s))
            tt = tension / 2 * ((1 + q) - (1 + 3 * q**2) * (c * c - s * s))
            rt = -tension * (1 + 2 * q - 3 * q**2) * s * c
            result = np.column_stack(
                (
                    rr * c * c + tt * s * s - 2 * rt * s * c,
                    rr * s * s + tt * c * c + 2 * rt * s * c,
                    (rr - tt) * s * c + rt * (c * c - s * s),
                )
            )
    except FloatingPointError as error:
        raise EngineError("invalid-reference", "Kirsch stress exceeds float64 range.") from error
    if not np.isfinite(result).all():
        raise EngineError("invalid-reference", "Kirsch stress exceeds float64 range.")
    return result


def kirsch_traction(
    points: np.ndarray,
    normals: np.ndarray,
    radius: float,
    tension: float,
    center: Any = (0.0, 0.0),
) -> np.ndarray:
    """Outward Cauchy traction sigma*n in Pa; reversing n reverses traction."""
    stress = kirsch_stress(points, radius, tension, center)
    normals = np.asarray(normals, dtype=np.float64)
    if (
        normals.shape != (len(stress), 2)
        or not np.isfinite(normals).all()
        or not np.allclose(np.hypot(normals[:, 0], normals[:, 1]), 1, rtol=1e-12, atol=1e-12)
    ):
        raise EngineError(
            "invalid-reference", "Kirsch traction requires outward unit planar normals."
        )
    result = np.column_stack(
        (
            stress[:, 0] * normals[:, 0] + stress[:, 2] * normals[:, 1],
            stress[:, 2] * normals[:, 0] + stress[:, 1] * normals[:, 1],
        )
    )
    if not np.isfinite(result).all():
        raise EngineError("invalid-reference", "Kirsch traction exceeds float64 range.")
    return result
