"""Experimental displacement PINN for homogeneous rectangular plane stress.

Autograd differentiates displacement twice to enforce div(sigma)=0. Boundary
tractions use the same explicit thickness and selected-edge total force as FEM.
The network is trained without reference fields. Explicit constant component
supports are lifted exactly; unconstrained components receive natural tractions.
All losses are dimensionless. Returned stresses are evaluated at triangle
centroids, rather than derived from or averaged through the FEM discretization."""

import math
import time
from typing import Any

import numpy as np
import torch
from torch import Tensor, nn

from phyra_engine.errors import EngineError
from phyra_engine.execution.devices import select_device
from phyra_engine.execution.events import Cancellation, Metrics
from phyra_engine.materials.isotropic import plane_stress_matrix as constitutive_matrix
from phyra_engine.meshing.plane_stress import cell_areas, edge_geometry, validate_mesh
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.elasticity import equilibrium_residual, stress_and_strain
from phyra_engine.methods.physicsml.networks import DisplacementNetwork, Normalization
from phyra_engine.results.diagnostics import summary
from phyra_engine.results.fields import pack_stress, von_mises
from phyra_engine.studies.plane_stress import (
    constraint_dofs,
    edge_tractions,
    integrate_edge_loads,
    validate_constraints,
)


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


def evaluate_held_out(
    model: nn.Module,
    mesh: Mesh2D,
    study: dict[str, Any],
    configuration: dict[str, Any],
    scales: Normalization,
    material: Tensor,
    device: str,
    dtype: torch.dtype,
) -> dict[str, Any]:
    """Measure residuals on independent points; neither optimize nor certify field accuracy.

    The strong-form and boundary loss definitions follow the adapted PINN method
    cited in elasticity.py. A separate deterministic sampling stream is evaluated
    only after Adam finishes, so these points never supply parameter gradients.
    """
    seed = configuration["seed"] ^ 0x5EED5EED
    points = _sample_points(
        mesh, scales, configuration, study, np.random.default_rng(seed), device, dtype
    )
    losses = _losses(model, material, points)
    if not all(bool(torch.isfinite(value)) for value in losses.values()):
        raise EngineError("nonfinite-validation", "Held-out residual evaluation was nonfinite.")
    return {
        "schemaVersion": 1,
        "sampling": "independent-uniform",
        "seed": seed,
        "interiorPoints": configuration["interiorPoints"],
        "boundaryPointsPerRegion": configuration["boundaryPoints"],
        **{key: float(value.detach().cpu()) for key, value in losses.items()},
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
    validation = evaluate_held_out(
        model, mesh, study, configuration, scales, material, device, dtype
    )
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
    if validation["total"] > 1e-4:
        warnings.append(
            "Held-out residual losses exceed 1e-4; these losses are not a field-error bound."
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
            "validation": validation,
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
