"""Displacement networks with exact compatible constant-component lifting."""

import torch
from torch import Tensor, nn

from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.lifting import ComponentLifting
from phyra_engine.methods.physicsml.normalization import Normalization


def _union_distance(first: Tensor, second: Tensor) -> tuple[Tensor, Tensor]:
    """Harmonic union of nonnegative finite-segment vanishing functions.

    The union is a*b/(a+b), equivalently 1/(1/a+1/b). Unlike a product
    of many factors, it has no exponential attenuation. It vanishes exactly
    on either prescribed segment and is smooth elsewhere. At compatible
    support junctions a=b=0, its bounded weak first derivatives may have
    direction-dependent limits; the isolated junction uses the finite zero
    representative. The exact-zero branch introduces no regularization.
    """
    denominator = first + second
    denominator = torch.where(denominator == 0, torch.ones_like(denominator), denominator)
    return first * (second / denominator), denominator


class DisplacementNetwork(nn.Module):
    span: Tensor

    def __init__(
        self,
        configuration: TrainingConfiguration,
        components: dict[str, list[float | None]],
        scales: Normalization,
        device: str,
        dtype: torch.dtype,
        lifting: tuple[ComponentLifting, ComponentLifting] | None = None,
    ):
        super().__init__()
        layers: list[nn.Module] = [nn.Linear(2, configuration.width), nn.Tanh()]
        for _ in range(configuration.layers - 1):
            layers += [nn.Linear(configuration.width, configuration.width), nn.Tanh()]
        layers.append(nn.Linear(configuration.width, 2))
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
        self.lifting = lifting
        if lifting is not None:
            for component, item in enumerate(lifting):
                for index, group in enumerate(item.groups):
                    self.register_buffer(
                        f"segments_{component}_{index}",
                        torch.tensor(group.segments, device=device, dtype=dtype),
                    )
        self.register_buffer(
            "span", torch.tensor(scales.span / scales.length, device=device, dtype=dtype)
        )

    def forward(self, coordinates: Tensor) -> Tensor:
        unit = coordinates / self.span
        raw = self.network(2 * unit - 1)
        outputs = []
        for component in range(2):
            if self.lifting is not None:
                item = self.lifting[component]
                vanishing = []
                for index, _group in enumerate(item.groups):
                    segments = getattr(self, f"segments_{component}_{index}")
                    normal = coordinates @ segments[:, :2].T + segments[:, 2]
                    tangent = coordinates @ segments[:, 3:5].T
                    tail = (
                        torch.relu(segments[:, 5] - tangent).square()
                        + torch.relu(tangent - segments[:, 6]).square()
                    )
                    distances = (normal + tail) / segments[:, 7]
                    union = distances[:, 0]
                    for segment in range(1, distances.shape[1]):
                        union, _ = _union_distance(union, distances[:, segment])
                    vanishing.append(union)
                base = torch.zeros_like(raw[:, component])
                factor = torch.ones_like(base)
                if vanishing:
                    base = base + item.groups[0].value
                    factor = vanishing[0]
                    for group, distance in zip(item.groups[1:], vanishing[1:], strict=True):
                        union, denominator = _union_distance(factor, distance)
                        base = (distance / denominator) * base + (
                            factor / denominator
                        ) * group.value
                        factor = union
                outputs.append(base + factor * raw[:, component])
                continue
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
