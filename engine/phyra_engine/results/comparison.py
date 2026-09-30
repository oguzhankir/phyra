"""Same-location comparison; relative L2 is undefined for a zero reference."""

import math
from typing import Any

import numpy as np

MAPPING = "identical nodes and cell centroids; unweighted relative L2"


def comparison_metric(reference: np.ndarray, prediction: np.ndarray) -> dict[str, Any]:
    difference = prediction - reference
    # BLAS reductions can change their last bit with buffer alignment. Scaled
    # scalar hypot uses the same ordered values before and after serialization,
    # avoiding both that artifact and intermediate squared-norm overflow.
    reference_norm = math.hypot(*map(float, reference.flat))
    return {
        "relativeL2": math.hypot(*map(float, difference.flat)) / reference_norm
        if reference_norm
        else None,
        "maxAbsolute": max(math.hypot(*map(float, row)) for row in difference)
        if difference.ndim == 2
        else float(np.abs(difference).max()),
        "referenceNorm": reference_norm,
    }


def comparison(fem: dict[str, Any], pinn: dict[str, Any]) -> dict[str, Any]:
    training = pinn["training"]
    return {
        "mapping": MAPPING,
        **{
            key: comparison_metric(fem[key], pinn[key])
            for key in ("displacement", "stress", "vonMises")
        },
        "femSeconds": fem["summary"]["elapsedSeconds"],
        **training["timings"],
        "device": training["device"],
    }
