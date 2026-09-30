"""Authoritative engineering-shear ordering and planar field representations."""

import numpy as np

STRESS_COMPONENTS = ["xx", "yy", "zz", "xy", "yz", "xz"]


def pack_stress(stress: np.ndarray) -> np.ndarray:
    packed = np.zeros((len(stress), 6), dtype=np.float64)
    packed[:, [0, 1, 3]] = stress
    return packed


def von_mises(stress: np.ndarray) -> np.ndarray:
    xx, yy, xy = stress.T
    return np.sqrt(np.maximum(0, xx**2 - xx * yy + yy**2 + 3 * xy**2))
