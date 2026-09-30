"""Experimental displacement PINN for homogeneous rectangular plane stress.

Autograd differentiates displacement twice to enforce div(sigma)=0. Boundary
tractions use the same explicit thickness and selected-edge total force as FEM.
The network is trained without reference fields. Explicit constant component
supports are lifted exactly; unconstrained components receive natural tractions.
All losses are dimensionless. Returned stresses are evaluated at triangle
centroids, rather than derived from or averaged through the FEM discretization.
"""

import math
import time
from dataclasses import dataclass
from typing import Any, Callable

import numpy as np
import torch
from torch import Tensor, nn

from .errors import EngineError
from .fem2d import (
    Mesh2D,
    cell_areas,
    constitutive_matrix,
    constraint_dofs,
    edge_geometry,
    edge_tractions,
    integrate_edge_loads,
    pack_stress,
    summary,
    validate_constraints,
    validate_mesh,
    von_mises,
)

Metrics = Callable[[dict[str, Any]], None]
Cancellation = Callable[[], bool]


@dataclass(frozen=True)
class Normalization:
    length: float
    stress: float
    displacement: float
    origin: np.ndarray
    span: np.ndarray


def validate_configuration(configuration: dict[str, Any]) -> dict[str, Any]:
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
            "Reduce width, layers or points: their combined training resource budget is too large.",
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
    if set(configuration) != set(limits) | {"learningRate", "activation", "optimizer", "device"}:
        raise EngineError("invalid-training", "Training configuration contains unknown fields.")
    return dict(configuration)


def _probe_device(device: str, dtype: torch.dtype) -> tuple[bool, str]:
    try:
        # Probe the required second spatial derivative and parameter gradient,
        # since allocation alone does not establish PINN operation support.
        coordinate = torch.tensor([[0.2, -0.3]], device=device, dtype=dtype, requires_grad=True)
        weight = torch.tensor([[0.4], [-0.1]], device=device, dtype=dtype, requires_grad=True)
        displacement = torch.tanh(coordinate @ weight)
        first = torch.autograd.grad(displacement.sum(), coordinate, create_graph=True)[0]
        second = torch.autograd.grad(first.sum(), coordinate, create_graph=True)[0]
        loss = second.square().sum() + first.square().sum()
        loss.backward()
        if weight.grad is None or not bool(torch.isfinite(weight.grad).all()):
            return False, "Required elasticity derivatives did not produce finite gradients."
        return True, "Second spatial derivatives and parameter backpropagation passed."
    except (RuntimeError, TypeError, NotImplementedError) as error:
        return False, str(error)[:400]


def device_capabilities() -> list[dict[str, Any]]:
    devices = []
    candidates = [("cpu", "CPU", torch.float64, True)]
    candidates += [
        ("mps", "Apple GPU · MPS", torch.float32, torch.backends.mps.is_available()),
        ("cuda", "NVIDIA GPU · CUDA", torch.float64, torch.cuda.is_available()),
    ]
    for device, label, dtype, backend_available in candidates:
        available, reason = (
            _probe_device(device, dtype)
            if backend_available
            else (False, "The installed runtime reports this backend unavailable.")
        )
        devices.append(
            {
                "id": device,
                "label": label,
                "precision": "float64" if dtype == torch.float64 else "float32",
                "available": available,
                "reason": reason,
            }
        )
    return devices


def select_device(requested: str) -> tuple[str, torch.dtype, str]:
    chosen = "cpu" if requested == "auto" else requested
    capability = next((entry for entry in device_capabilities() if entry["id"] == chosen), None)
    if capability is None or not capability["available"]:
        reason = capability["reason"] if capability else "Unknown device."
        raise EngineError("device-unavailable", f"{chosen}: {reason}")
    reason = (
        "Auto selects CPU float64 for stable derivatives on these small elasticity jobs."
        if requested == "auto"
        else capability["reason"]
    )
    return chosen, torch.float32 if chosen == "mps" else torch.float64, reason


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


def _edge_components(mesh: Mesh2D, study: dict[str, Any]) -> dict[str, list[float | None]]:
    components: dict[str, list[float | None]] = {region: [None, None] for region in mesh.regions}
    for constraint in study["constraints"]:
        for region in constraint["regions"]:
            for component, value in enumerate(constraint["components"][:2]):
                if value is not None:
                    components[region][component] = float(value)
    return components


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


def stress_and_strain(
    model: nn.Module, coordinates: Tensor, material_normalized: Tensor
) -> tuple[Tensor, Tensor, Tensor]:
    """Normalized stress and engineering strain using true spatial autograd."""
    displacement = model(coordinates)
    dx = torch.autograd.grad(displacement[:, 0].sum(), coordinates, create_graph=True)[0]
    dy = torch.autograd.grad(displacement[:, 1].sum(), coordinates, create_graph=True)[0]
    strain = torch.stack((dx[:, 0], dy[:, 1], dx[:, 1] + dy[:, 0]), dim=1)
    return displacement, strain @ material_normalized.T, strain


def equilibrium_residual(stress: Tensor, coordinates: Tensor) -> Tensor:
    derivatives = [
        torch.autograd.grad(stress[:, component].sum(), coordinates, create_graph=True)[0]
        for component in range(3)
    ]
    return torch.stack(
        (derivatives[0][:, 0] + derivatives[2][:, 1], derivatives[2][:, 0] + derivatives[1][:, 1]),
        dim=1,
    )


def _sample_points(
    mesh: Mesh2D,
    scales: Normalization,
    configuration: dict[str, Any],
    study: dict[str, Any],
    rng: np.random.Generator,
    device: str,
    dtype: torch.dtype,
) -> tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor]:
    interior = rng.random((configuration["interiorPoints"], 2)) * scales.span / scales.length
    edge_components = _edge_components(mesh, study)
    tractions = edge_tractions(mesh, study["loads"])
    lengths, normals = edge_geometry(mesh)
    boundary, normal, traction, constrained, target = [], [], [], [], []
    # Sample by physical edge length inside each stable region, keeping the
    # region loss equally weighted so a short support cannot disappear.
    for ri, region in enumerate(mesh.regions):
        selected = np.flatnonzero(mesh.edge_regions == ri)
        probabilities = lengths[selected] / lengths[selected].sum()
        chosen = rng.choice(selected, size=configuration["boundaryPoints"], p=probabilities)
        along = rng.random((len(chosen), 1))
        points = (1 - along) * mesh.positions[mesh.edges[chosen, 0], :2] + along * mesh.positions[
            mesh.edges[chosen, 1], :2
        ]
        boundary.append((points - scales.origin) / scales.length)
        normal.append(normals[chosen])
        traction.append(tractions[chosen] / scales.stress)
        flags = [value is not None for value in edge_components[region]]
        values = [
            0 if value is None else value / scales.displacement for value in edge_components[region]
        ]
        constrained.append(np.tile(flags, (len(chosen), 1)))
        target.append(np.tile(values, (len(chosen), 1)))

    def tensor(values: np.ndarray, requires_grad: bool = False) -> Tensor:
        return torch.tensor(values, device=device, dtype=dtype, requires_grad=requires_grad)

    return (
        tensor(interior, True),
        tensor(np.concatenate(boundary), True),
        tensor(np.concatenate(normal)),
        tensor(np.concatenate(traction)),
        tensor(np.concatenate(constrained)),
        tensor(np.concatenate(target)),
    )


def _losses(
    model: nn.Module,
    material: Tensor,
    points: tuple[Tensor, Tensor, Tensor, Tensor, Tensor, Tensor],
) -> dict[str, Tensor]:
    interior, boundary, normals, targets, constrained, prescribed = points
    _, stress, _ = stress_and_strain(model, interior, material)
    pde = equilibrium_residual(stress, interior).square().mean()
    displacement, edge_stress, _ = stress_and_strain(model, boundary, material)
    traction = torch.stack(
        (
            edge_stress[:, 0] * normals[:, 0] + edge_stress[:, 2] * normals[:, 1],
            edge_stress[:, 2] * normals[:, 0] + edge_stress[:, 1] * normals[:, 1],
        ),
        dim=1,
    )
    free = 1 - constrained
    traction_loss = ((traction - targets) * free).square().sum() / torch.clamp(free.sum(), min=1)
    displacement_loss = ((displacement - prescribed) * constrained).square().sum() / torch.clamp(
        constrained.sum(), min=1
    )
    boundary_loss = traction_loss + displacement_loss
    return {
        "total": pde + boundary_loss,
        "pde": pde,
        "boundary": boundary_loss,
        "displacement": displacement_loss,
        "traction": traction_loss,
    }


def _evaluate(
    model: nn.Module,
    locations: np.ndarray,
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    output, stresses, strains = [], [], []
    # Bound autograd working memory independently of the rendering mesh size.
    for begin in range(0, len(locations), 1024):
        coordinates = torch.tensor(
            (locations[begin : begin + 1024] - scales.origin) / scales.length,
            device=device,
            dtype=dtype,
            requires_grad=True,
        )
        displacement, stress, strain = stress_and_strain(model, coordinates, material)
        output.append(displacement.detach().cpu().numpy().astype(np.float64) * scales.displacement)
        stresses.append(stress.detach().cpu().numpy().astype(np.float64) * scales.stress)
        strains.append(
            strain.detach().cpu().numpy().astype(np.float64) * scales.displacement / scales.length
        )
    return np.concatenate(output), np.concatenate(stresses), np.concatenate(strains)


def _support_reactions(
    model: nn.Module,
    mesh: Mesh2D,
    study: dict[str, Any],
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> np.ndarray:
    lengths, normals = edge_geometry(mesh)
    flags = np.array(
        [
            [value is not None for value in _edge_components(mesh, study)[mesh.regions[int(ri)]]]
            for ri in mesh.edge_regions
        ]
    )
    abscissas, weights = np.polynomial.legendre.leggauss(4)
    along = (abscissas + 1) / 2
    positions = mesh.positions[mesh.edges, :2]
    samples = (
        positions[:, :1] * (1 - along[None, :, None]) + positions[:, 1:] * along[None, :, None]
    )
    _, stress, _ = _evaluate(model, samples.reshape(-1, 2), scales, material, device, dtype)
    stress = stress.reshape(len(mesh.edges), 4, 3)
    traction = np.stack(
        (
            stress[:, :, 0] * normals[:, :1] + stress[:, :, 2] * normals[:, 1:],
            stress[:, :, 2] * normals[:, :1] + stress[:, :, 1] * normals[:, 1:],
        ),
        axis=2,
    )
    reactions = np.zeros((len(mesh.positions), 2), dtype=np.float64)
    for corner, shape in enumerate((1 - along, along)):
        contribution = np.einsum(
            "egi,g,g,e,ei->ei", traction, weights / 2, shape, lengths * mesh.thickness, flags
        )
        np.add.at(reactions, mesh.edges[:, corner], contribution)
    # A support balances the difference between learned constitutive traction
    # and explicitly applied traction on that same constrained edge component.
    # Corners have zero measure; natural traction on an adjacent free edge is
    # not subtracted a second time merely because a shared node is prescribed.
    applied = edge_tractions(mesh, study["loads"])
    contribution = applied * flags * lengths[:, None] * mesh.thickness / 2
    for corner in range(2):
        np.add.at(reactions, mesh.edges[:, corner], -contribution)
    return reactions


def train(
    mesh: Mesh2D,
    study: dict[str, Any],
    configuration: dict[str, Any],
    metrics: Metrics | None = None,
    cancelled: Cancellation | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    validate_mesh(mesh)
    configuration = validate_configuration(configuration)
    young, poisson = study["material"]["young"], study["material"]["poisson"]
    physical_material = constitutive_matrix(young, poisson)
    prescribed = constraint_dofs(mesh, study["constraints"])
    validate_constraints(mesh, prescribed)
    device, dtype, reason = select_device(configuration["device"])
    scales = normalization(mesh, study)
    torch.manual_seed(configuration["seed"])
    rng = np.random.default_rng(configuration["seed"])
    # Small dense autograd networks run predictably with one CPU thread. The
    # worker is an isolated process, so this setting never changes desktop work.
    if device == "cpu":
        torch.set_num_threads(1)
    model = DisplacementNetwork(configuration, _edge_components(mesh, study), scales, device, dtype)
    material = torch.tensor(physical_material / young, device=device, dtype=dtype)
    optimizer = torch.optim.Adam(model.parameters(), lr=configuration["learningRate"])
    points = _sample_points(mesh, scales, configuration, study, rng, device, dtype)
    history: list[dict[str, Any]] = []
    interval = max(1, math.ceil(configuration["steps"] / 1000))
    training_started = time.perf_counter()
    for step in range(configuration["steps"] + 1):
        if cancelled and cancelled():
            raise EngineError("cancelled", "PINN training was cancelled.")
        optimizer.zero_grad(set_to_none=True)
        losses = _losses(model, material, points)
        if not all(bool(torch.isfinite(value)) for value in losses.values()):
            raise EngineError("nonfinite-training", "Training produced a nonfinite loss.")
        if step % interval == 0 or step == configuration["steps"]:
            event = {
                "step": step,
                "elapsedSeconds": time.perf_counter() - started,
                **{key: float(value.detach().cpu()) for key, value in losses.items()},
                "device": device,
            }
            history.append(event)
            if metrics:
                metrics(event)
        if step == configuration["steps"]:
            break
        # Collocation coordinates are reusable leaves; only parameter gradients
        # are needed by Adam, avoiding accumulated spatial leaf gradients.
        losses["total"].backward(inputs=tuple(model.parameters()))
        if any(
            parameter.grad is not None and not bool(torch.isfinite(parameter.grad).all())
            for parameter in model.parameters()
        ):
            raise EngineError(
                "nonfinite-training", "Training produced a nonfinite parameter gradient."
            )
        optimizer.step()
    training_seconds = time.perf_counter() - training_started
    if cancelled and cancelled():
        raise EngineError("cancelled", "PINN evaluation was cancelled.")
    evaluation_started = time.perf_counter()
    displacement, _, _ = _evaluate(model, mesh.positions[:, :2], scales, material, device, dtype)
    _, stress, strain = _evaluate(
        model, mesh.positions[mesh.cells, :2].mean(axis=1), scales, material, device, dtype
    )
    reactions = _support_reactions(model, mesh, study, scales, material, device, dtype)
    force = integrate_edge_loads(mesh, study["loads"])
    energy = 0.5 * np.sum(np.sum(strain * stress, axis=1) * cell_areas(mesh) * mesh.thickness)
    diagnostic = summary(
        mesh,
        displacement,
        stress,
        reactions,
        force,
        float(energy),
        time.perf_counter() - started,
        math.sqrt(history[-1]["pde"]),
    )
    warnings = []
    if max(diagnostic["relativeForceBalance"], diagnostic["relativeMomentBalance"]) > 0.01:
        warnings.append(
            "Learned support tractions leave more than 1% global force or moment imbalance."
        )
    if history[-1]["total"] > 1e-4:
        warnings.append(
            "Training losses remain above 1e-4; compare the fields with the FEM reference."
        )
    arrays = {
        "displacement": np.column_stack((displacement, np.zeros(len(displacement)))),
        "stress": pack_stress(stress),
        "vonMises": von_mises(stress),
        "reactions": np.column_stack((reactions, np.zeros(len(reactions)))),
    }
    if any(not np.isfinite(array).all() for array in arrays.values()) or not np.isfinite(energy):
        raise EngineError("nonfinite-result", "PINN field evaluation produced nonfinite values.")
    return {
        **arrays,
        "summary": diagnostic,
        "warnings": warnings,
        "training": {
            "configuration": configuration,
            "device": device,
            "precision": "float32" if dtype == torch.float32 else "float64",
            "deviceReason": reason,
            "framework": "pytorch",
            "frameworkVersion": torch.__version__,
            "history": history,
            "normalization": {
                "length": scales.length,
                "stress": scales.stress,
                "displacement": scales.displacement,
            },
            "timings": {
                "trainingSeconds": training_seconds,
                "inferenceSeconds": time.perf_counter() - evaluation_started,
            },
            "residualDefinition": "RMS of dimensionless div(sigma) at training interior points",
            "reactionDefinition": (
                "Learned stress traction integrated on constrained edge components; "
                "applied constrained-edge loads subtracted"
            ),
            "energyDefinition": (
                "Cell-centroid quadrature of one half strain contracted with stress"
            ),
        },
    }
