"""Validated, immutable settings for the implemented displacement PINN.

Project JSON remains the external contract. Decode it once at the method boundary
so numerical code uses named settings rather than repeatedly indexing wire keys.
"""

import math
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from phyra_engine.errors import EngineError


@dataclass(frozen=True, slots=True)
class TrainingConfiguration:
    layers: int
    width: int
    steps: int
    interior_points: int
    boundary_points: int
    seed: int
    learning_rate: float
    device: str
    formulation: str = "strong-form"
    explicit_formulation: bool = False

    @classmethod
    def from_mapping(cls, configuration: Mapping[str, Any]) -> "TrainingConfiguration":
        limits = {
            "layers": (1, 6),
            "width": (4, 128),
            "steps": (1, 20000),
            "interiorPoints": (8, 4096),
            "boundaryPoints": (4, 1024),
            "seed": (0, 2**31 - 1),
        }
        for key, (lower, upper) in limits.items():
            value = configuration.get(key)
            if type(value) is not int or not lower <= value <= upper:
                raise EngineError(
                    "invalid-training", f"{key} must be an integer in [{lower}, {upper}]."
                )
        activation_budget = (
            configuration["layers"]
            * configuration["width"]
            * (configuration["interiorPoints"] + 4 * configuration["boundaryPoints"])
        )
        if activation_budget > 1_000_000:
            raise EngineError(
                "resource-limit",
                "Reduce width, layers or points: "
                "their combined training resource budget is too large.",
            )
        rate = configuration.get("learningRate")
        if not isinstance(rate, (int, float)) or isinstance(rate, bool):
            raise EngineError("invalid-training", "learningRate must be a finite number.")
        if not math.isfinite(rate) or not 1e-6 <= rate <= 0.05:
            raise EngineError("invalid-training", "learningRate must be between 1e-6 and 0.05.")
        if configuration.get("activation") != "tanh" or configuration.get("optimizer") != "adam":
            raise EngineError("invalid-training", "The supported PINN uses tanh and Adam.")
        if configuration.get("device") not in ("auto", "cpu", "mps", "cuda"):
            raise EngineError("invalid-training", "Select auto, CPU, MPS or CUDA.")
        formulation = configuration.get("formulation", "strong-form")
        if formulation not in ("strong-form", "potential-energy"):
            raise EngineError(
                "invalid-training", "Select strong-form or potential-energy training."
            )
        if set(configuration) - {"formulation"} != set(limits) | {
            "learningRate",
            "activation",
            "optimizer",
            "device",
        }:
            raise EngineError("invalid-training", "Training configuration contains unknown fields.")
        return cls(
            layers=configuration["layers"],
            width=configuration["width"],
            steps=configuration["steps"],
            interior_points=configuration["interiorPoints"],
            boundary_points=configuration["boundaryPoints"],
            seed=configuration["seed"],
            learning_rate=float(rate),
            device=configuration["device"],
            formulation=formulation,
            explicit_formulation="formulation" in configuration,
        )

    def to_mapping(self) -> dict[str, Any]:
        """Emit the existing project/result keys; this is not a new archive format."""
        result = {
            "layers": self.layers,
            "width": self.width,
            "steps": self.steps,
            "interiorPoints": self.interior_points,
            "boundaryPoints": self.boundary_points,
            "seed": self.seed,
            "learningRate": self.learning_rate,
            "activation": "tanh",
            "optimizer": "adam",
            "device": self.device,
        }
        # The v5 definition adds an explicit method choice. Legacy direct callers
        # and v2-v4 cache configuration retain their original strong-form shape.
        if self.explicit_formulation:
            result["formulation"] = self.formulation
        return result
