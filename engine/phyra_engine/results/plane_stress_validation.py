"""Strict persisted training metadata and independently reconstructed planar fields."""

import math
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.classical.plane_stress import assemble
from phyra_engine.results.fields import von_mises
from phyra_engine.studies.plane_stress import constraint_dofs, edge_tractions, integrate_edge_loads


def number(value: Any) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value) and value >= 0
    except OverflowError:
        return False


def text(value: Any, maximum: int, empty: bool = False) -> bool:
    return isinstance(value, str) and (empty or bool(value)) and len(value) <= maximum


def validate_training(
    project: dict[str, Any], mesh: Mesh2D, manifest: dict[str, Any]
) -> dict[str, Any]:
    training = manifest.get("training")
    keys = {
        "configuration",
        "device",
        "precision",
        "deviceReason",
        "framework",
        "frameworkVersion",
        "history",
        "normalization",
        "timings",
        "residualDefinition",
        "reactionDefinition",
        "energyDefinition",
    }
    if not isinstance(training, dict) or set(training) not in (keys, keys | {"validation"}):
        raise EngineError("invalid-cache", "Unexpected training metadata.")
    config = project["study"]["solver"]["pinn"]
    stored_config = training["configuration"]
    device = training["device"]
    if (
        stored_config != config
        or not isinstance(stored_config, dict)
        or any(
            type(stored_config[key]) is not int
            for key in ("layers", "width", "steps", "interiorPoints", "boundaryPoints", "seed")
        )
        or device not in ("cpu", "mps", "cuda")
        or manifest["device"] != device
        or config["device"] != "auto"
        and config["device"] != device
        or config["device"] == "auto"
        and device != "cpu"
        or training["precision"] != ("float32" if device == "mps" else "float64")
        or training["framework"] != "pytorch"
        or not text(training["frameworkVersion"], 100)
        or manifest["versions"]["torch"] != training["frameworkVersion"]
        or not text(training["deviceReason"], 500, empty=True)
        or any(
            not text(training[key], 1000)
            for key in ("residualDefinition", "reactionDefinition", "energyDefinition")
        )
    ):
        raise EngineError(
            "invalid-cache", "Training backend or configuration provenance is invalid."
        )
    normalization = training["normalization"]
    if (
        not isinstance(normalization, dict)
        or set(normalization) != {"length", "stress", "displacement"}
        or any(not number(value) or value == 0 for value in normalization.values())
    ):
        raise EngineError("invalid-cache", "Training physical normalization is invalid.")
    study = project["study"]
    length = float(np.ptp(mesh.positions[:, :2], axis=0).max())
    prescribed = constraint_dofs(mesh, study["constraints"])
    young = study["material"]["young"]
    stress = max(
        float(np.linalg.norm(edge_tractions(mesh, study["loads"]), axis=1).max()),
        young * max(map(abs, prescribed.values()), default=0) / length,
        young * 1e-8,
    )
    for key, actual in {
        "length": length,
        "stress": stress,
        "displacement": stress * length / young,
    }.items():
        if not np.isclose(normalization[key], actual, rtol=1e-12, atol=0):
            raise EngineError(
                "invalid-cache", "Training normalization does not match physical inputs."
            )
    timings = training["timings"]
    if (
        not isinstance(timings, dict)
        or set(timings) != {"trainingSeconds", "inferenceSeconds"}
        or any(not number(value) for value in timings.values())
    ):
        raise EngineError("invalid-cache", "Training timings are invalid.")
    history = training["history"]
    steps = config["steps"]
    interval = max(1, math.ceil(steps / 1000))
    expected_steps = list(range(0, steps + 1, interval))
    if expected_steps[-1] != steps:
        expected_steps.append(steps)
    if (
        not isinstance(history, list)
        or not 2 <= len(history) <= 1001
        or len(history) != len(expected_steps)
    ):
        raise EngineError(
            "invalid-cache", "Training history does not cover its bounded sampling schedule."
        )
    elapsed = -1.0
    for metric, expected_step in zip(history, expected_steps, strict=True):
        if (
            not isinstance(metric, dict)
            or set(metric) != {"jobId", "step", "elapsed", "total", "pde", "boundary", "device"}
            or type(metric["step"]) is not int
            or metric["step"] != expected_step
            or metric["jobId"] != manifest["jobId"]
            or metric["device"] != device
            or any(not number(metric[key]) for key in ("elapsed", "total", "pde", "boundary"))
            or metric["elapsed"] < elapsed
        ):
            raise EngineError("invalid-cache", "Training history contains invalid measurements.")
        elapsed = metric["elapsed"]
    if "validation" in training:
        validate_held_out(training["validation"], config, training["precision"])
    return training


def validate_held_out(value: Any, configuration: dict[str, Any], precision: str) -> None:
    """Validate the versioned optional diagnostic; older caches omit this object."""
    scalar_keys = {"total", "pde", "boundary", "displacement", "traction"}
    keys = scalar_keys | {
        "schemaVersion",
        "sampling",
        "seed",
        "interiorPoints",
        "boundaryPointsPerRegion",
    }
    if (
        not isinstance(value, dict)
        or set(value) != keys
        or type(value["schemaVersion"]) is not int
        or value["schemaVersion"] != 1
        or value["sampling"] != "independent-uniform"
        or any(
            type(value[key]) is not int
            for key in ("seed", "interiorPoints", "boundaryPointsPerRegion")
        )
        or value["seed"] != configuration["seed"] ^ 0x5EED5EED
        or value["interiorPoints"] != configuration["interiorPoints"]
        or value["boundaryPointsPerRegion"] != configuration["boundaryPoints"]
        or any(not number(value[key]) for key in scalar_keys)
    ):
        raise EngineError("invalid-cache", "Held-out residual diagnostics are malformed or stale.")
    epsilon = np.finfo(np.float32 if precision == "float32" else np.float64).eps
    # Only serialized sums of the measured loss components are compared here;
    # this accounts for the declared training precision, not physical accuracy.
    for total, components in (
        ("total", ("pde", "boundary")),
        ("boundary", ("displacement", "traction")),
    ):
        if not np.isclose(
            value[total], sum(value[key] for key in components), rtol=8 * epsilon, atol=0
        ):
            raise EngineError("invalid-cache", "Held-out loss components do not sum consistently.")


def validate_result(
    mesh: Mesh2D,
    study: dict[str, Any],
    arrays: dict[str, Any],
    diagnostic: Any,
    training: dict[str, Any] | None,
) -> None:
    scalars = {
        "maxDisplacement",
        "maxVonMises",
        "strainEnergy",
        "relativeResidual",
        "relativeForceBalance",
        "relativeMomentBalance",
        "elapsedSeconds",
    }
    vectors = {"totalForce", "totalReaction", "forceBalance", "momentBalance"}
    if (
        not isinstance(diagnostic, dict)
        or set(diagnostic) != scalars | vectors
        or any(not number(diagnostic[key]) for key in scalars)
        or any(
            not isinstance(diagnostic[key], list)
            or len(diagnostic[key]) != 3
            or any(
                type(value) not in (int, float) or not math.isfinite(value)
                for value in diagnostic[key]
            )
            for key in vectors
        )
    ):
        raise EngineError("invalid-cache", "Invalid 2D result diagnostics.")
    if any(np.any(arrays[key][:, 2] != 0) for key in ("displacement", "reactions")) or np.any(
        arrays["stress"][:, [2, 4, 5]] != 0
    ):
        raise EngineError(
            "invalid-cache", "Plane-stress fields must have zero out-of-plane components."
        )
    equivalent = von_mises(arrays["stress"][:, [0, 1, 3]])
    if np.any(arrays["vonMises"] < 0) or not np.allclose(
        arrays["vonMises"], equivalent, rtol=1e-12, atol=0
    ):
        raise EngineError(
            "invalid-cache", "Equivalent stress disagrees with the planar stress tensor."
        )
    force = integrate_edge_loads(mesh, study["loads"])
    reactions = arrays["reactions"][:, :2]
    roundoff = 0.0
    if training is None:
        flat = arrays["displacement"][:, :2].reshape(-1)
        matrix = assemble(mesh, study["material"]["young"], study["material"]["poisson"])
        internal = matrix @ flat
        algebraic = abs(matrix) @ np.abs(flat)
        factor = 128 * np.finfo(float).eps / 1e-8
        roundoff = factor * np.sum(algebraic)
        prescribed = constraint_dofs(mesh, study["constraints"])
        fixed = np.array(sorted(prescribed), dtype=np.int64)
        free = np.setdiff1d(np.arange(len(flat)), fixed, assume_unique=True)
        residual = internal - force.reshape(-1)
        denominator = max(
            np.linalg.norm(force),
            np.linalg.norm(internal),
            factor * np.linalg.norm(algebraic),
            np.finfo(float).tiny,
        )
        expected_residual = float(np.linalg.norm(residual[free]) / denominator)
        if not np.array_equal(flat[fixed], [prescribed[int(dof)] for dof in fixed]):
            raise EngineError(
                "invalid-cache", "Cached FEM displacement violates prescribed supports."
            )
        expected_reactions = np.zeros_like(flat)
        expected_reactions[fixed] = residual[fixed]
        reaction_scale = max(np.linalg.norm(force, axis=1).sum(), roundoff, np.finfo(float).tiny)
        if not np.allclose(
            reactions.reshape(-1), expected_reactions, rtol=1e-12, atol=reaction_scale * 1e-12
        ):
            raise EngineError(
                "invalid-cache", "Cached FEM reactions disagree with constrained equilibrium."
            )
        energy = float(0.5 * flat @ internal)
        if not np.isclose(diagnostic["strainEnergy"], energy, rtol=1e-12, atol=0):
            raise EngineError("invalid-cache", "FEM strain energy disagrees with physical fields.")
    else:
        expected_residual = math.sqrt(training["history"][-1]["pde"])
    closure = force + reactions
    centered = mesh.positions[:, :2] - mesh.positions[:, :2].mean(axis=0)
    moment = float(np.sum(centered[:, 0] * closure[:, 1] - centered[:, 1] * closure[:, 0]))
    force_scale = max(
        np.linalg.norm(force, axis=1).sum(),
        np.linalg.norm(reactions, axis=1).sum(),
        roundoff,
        np.finfo(float).tiny,
    )
    length = np.linalg.norm(np.ptp(mesh.positions[:, :2], axis=0))
    vector_checks = {
        "totalForce": np.r_[force.sum(axis=0), 0],
        "totalReaction": np.r_[reactions.sum(axis=0), 0],
        "forceBalance": np.r_[closure.sum(axis=0), 0],
        "momentBalance": np.array([0.0, 0.0, moment]),
    }
    for key, actual in vector_checks.items():
        if not np.allclose(
            diagnostic[key],
            actual,
            rtol=1e-12,
            atol=force_scale * (length if key == "momentBalance" else 1) * 1e-12,
        ):
            raise EngineError(
                "invalid-cache", "2D force or moment diagnostics disagree with physical fields."
            )
    scalar_checks = {
        "maxDisplacement": np.linalg.norm(arrays["displacement"], axis=1).max(),
        "maxVonMises": arrays["vonMises"].max(),
        "relativeResidual": expected_residual,
        "relativeForceBalance": np.linalg.norm(closure.sum(axis=0)) / force_scale,
        "relativeMomentBalance": abs(moment) / (force_scale * length),
    }
    for key, actual in scalar_checks.items():
        if not np.isclose(
            diagnostic[key], actual, rtol=1e-12, atol=1e-15 if key.startswith("relative") else 0
        ):
            raise EngineError(
                "invalid-cache", "2D scalar diagnostics disagree with physical fields."
            )
    if (
        training is None
        and max(
            scalar_checks[key]
            for key in ("relativeResidual", "relativeForceBalance", "relativeMomentBalance")
        )
        > 1e-8
    ):
        raise EngineError("invalid-cache", "Classical 2D result failed physical equilibrium.")
