"""Bounded Adam optimization and immutable measured training history.

This trainer owns optimizer state for one execution. It neither validates a
project nor samples/evaluates held-out points, publishes fields or saves weights.
"""

import math
import time
from dataclasses import dataclass
from typing import Any

import torch
from torch import Tensor, nn

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Cancellation, Metrics
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.elasticity import LossMetrics, residual_losses
from phyra_engine.methods.physicsml.sampling import CollocationBatch


@dataclass(frozen=True, slots=True)
class TrainingMeasurement:
    step: int
    elapsed_seconds: float
    losses: LossMetrics
    device: str

    def to_mapping(self) -> dict[str, Any]:
        return {
            "step": self.step,
            "elapsedSeconds": self.elapsed_seconds,
            **self.losses.to_mapping(),
            "device": self.device,
        }


@dataclass(frozen=True, slots=True)
class TrainingTrace:
    history: tuple[TrainingMeasurement, ...]
    training_seconds: float


class AdamTrainer:
    def __init__(
        self,
        configuration: TrainingConfiguration,
        device: str,
        metrics: Metrics | None = None,
        cancelled: Cancellation | None = None,
    ):
        self.configuration = configuration
        self.device = device
        self.metrics = metrics
        self.cancelled = cancelled

    def run(
        self, model: nn.Module, material: Tensor, points: CollocationBatch, started: float
    ) -> TrainingTrace:
        optimizer = torch.optim.Adam(model.parameters(), lr=self.configuration.learning_rate)
        history: list[TrainingMeasurement] = []
        interval = max(1, math.ceil(self.configuration.steps / 1000))
        training_started = time.perf_counter()
        for step in range(self.configuration.steps + 1):
            if self.cancelled and self.cancelled():
                raise EngineError("cancelled", "PINN training was cancelled.")
            optimizer.zero_grad(set_to_none=True)
            losses = residual_losses(model, material, points)
            if not losses.is_finite():
                raise EngineError("nonfinite-training", "Training produced a nonfinite loss.")
            if step % interval == 0 or step == self.configuration.steps:
                measurement = TrainingMeasurement(
                    step, time.perf_counter() - started, losses.measure(), self.device
                )
                history.append(measurement)
                if self.metrics:
                    self.metrics(measurement.to_mapping())
            if step == self.configuration.steps:
                break
            # Collocation coordinates are reusable leaves; only parameter
            # gradients are needed by Adam, avoiding accumulated leaf gradients.
            losses.total.backward(inputs=tuple(model.parameters()))
            if any(
                parameter.grad is not None and not bool(torch.isfinite(parameter.grad).all())
                for parameter in model.parameters()
            ):
                raise EngineError(
                    "nonfinite-training", "Training produced a nonfinite parameter gradient."
                )
            optimizer.step()
        return TrainingTrace(tuple(history), time.perf_counter() - training_started)
