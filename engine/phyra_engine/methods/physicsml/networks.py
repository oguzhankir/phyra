"""Displacement networks with exact compatible constant-component lifting."""

from dataclasses import dataclass
from typing import Any

import numpy as np
import torch
from torch import Tensor, nn


@dataclass(frozen=True)
class Normalization:
    length: float
    stress: float
    displacement: float
    origin: np.ndarray
    span: np.ndarray


class DisplacementNetwork(nn.Module):
    span: Tensor

    def __init__(
        self,
        configuration: dict[str, Any],
        components: dict[str, list[float | None]],
        scales: Normalization,
        device: str,
        dtype: torch.dtype,
    ):
        super().__init__()
        layers: list[nn.Module] = [nn.Linear(2, configuration["width"]), nn.Tanh()]
        for _ in range(configuration["layers"] - 1):
            layers += [nn.Linear(configuration["width"], configuration["width"]), nn.Tanh()]
        layers.append(nn.Linear(configuration["width"], 2))
        self.network = nn.Sequential(*layers).to(device=device, dtype=dtype)
        for layer in self.network:
            if isinstance(layer, nn.Linear):
                nn.init.xavier_uniform_(layer.weight)
                nn.init.zeros_(layer.bias)
        final = self.network[-1]
        assert isinstance(final, nn.Linear)
        # Zero initial displacement is a reproducible neutral starting point;
        # no continuum solution or FEM field initializes this network.
        nn.init.zeros_(final.weight)
        self.components = components
        self.scales = scales
        self.register_buffer(
            "span", torch.tensor(scales.span / scales.length, device=device, dtype=dtype)
        )

    def forward(self, coordinates: Tensor) -> Tensor:
        unit = coordinates / self.span
        raw = self.network(2 * unit - 1)
        outputs = []
        for component in range(2):
            constrained = {
                region: float(value) / self.scales.displacement
                for region, values in self.components.items()
                if (value := values[component]) is not None
            }
            factor = torch.ones_like(unit[:, component])
            for region in constrained:
                axis, side = (0 if region[0] == "x" else 1), int(region[1])
                factor = factor * (unit[:, axis] if side == 0 else 1 - unit[:, axis])
            base = torch.zeros_like(factor)
            if constrained:
                value = next(iter(constrained.values()))
                base = base + value
                # Constant data on adjacent edges are compatible only when
                # equal at their shared corner. Opposite edges admit a linear
                # lifting, which also handles nonzero imposed extension.
                for axis, prefix in enumerate(("x", "y")):
                    if prefix + "0" in constrained and prefix + "1" in constrained:
                        lower, upper = constrained[prefix + "0"], constrained[prefix + "1"]
                        if upper != lower:
                            base = lower + (upper - lower) * unit[:, axis]
            outputs.append(base + factor * raw[:, component])
        return torch.stack(outputs, dim=1)
