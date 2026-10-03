"""Experimental displacement PINNs for homogeneous plane stress.

Autograd differentiates displacement twice to enforce div(sigma)=0. Boundary
tractions use the same explicit thickness and selected-edge total force as FEM.
The network is trained without reference fields. The strong-form method uses
rectangles; the potential-energy method also uses bounded profiles with straight
external essential segments. Explicit constant component
supports are lifted exactly; unconstrained components receive natural tractions.
All losses are dimensionless. Returned stresses are evaluated at triangle
centroids, rather than derived from or averaged through the FEM discretization."""

import math
import time
from typing import Any

import numpy as np
import torch

from phyra_engine.errors import EngineError
from phyra_engine.execution.devices import select_device
from phyra_engine.execution.events import Cancellation, Metrics
from phyra_engine.materials.isotropic import plane_stress_matrix as constitutive_matrix
from phyra_engine.meshing.plane_stress import cell_areas, validate_mesh
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.energy import energy_quadrature, integration_audit
from phyra_engine.methods.physicsml.evaluation import evaluate_fields, support_reactions
from phyra_engine.methods.physicsml.lifting import profile_lifting
from phyra_engine.methods.physicsml.networks import DisplacementNetwork
from phyra_engine.methods.physicsml.normalization import normalization
from phyra_engine.methods.physicsml.sampling import edge_components, sample_points
from phyra_engine.methods.physicsml.training import AdamTrainer
from phyra_engine.methods.physicsml.validation import evaluate_held_out
from phyra_engine.physics.elasticity.plane_stress import (
    constraint_dofs,
    integrate_edge_loads,
    validate_constraints,
)
from phyra_engine.results.diagnostics import summary
from phyra_engine.results.fields import pack_stress, von_mises


def train(
    mesh: Mesh2D,
    study: dict[str, Any],
    configuration: dict[str, Any],
    metrics: Metrics | None = None,
    cancelled: Cancellation | None = None,
) -> dict[str, Any]:
    started = time.perf_counter()
    validate_mesh(mesh)
    settings = TrainingConfiguration.from_mapping(configuration)
    collocation_count = settings.interior_points + len(mesh.regions) * settings.boundary_points
    if collocation_count * settings.layers * settings.width > 1_000_000:
        raise EngineError(
            "resource-limit",
            "Reduce boundary samples, layers or width: the actual "
            "profile boundary count exceeds the training activation budget.",
        )
    young, poisson = study["material"]["young"], study["material"]["poisson"]
    physical_material = constitutive_matrix(young, poisson)
    prescribed = constraint_dofs(mesh, study["constraints"])
    validate_constraints(mesh, prescribed)
    device, dtype, reason = select_device(settings.device)
    scales = normalization(mesh, study)
    torch.manual_seed(settings.seed)
    rng = np.random.default_rng(settings.seed)
    # Small dense autograd networks run predictably with one CPU thread. The
    # worker is an isolated process, so this setting never changes desktop work.
    if device == "cpu":
        torch.set_num_threads(1)
    # Energy trials use verified finite external support segments, irrespective of region
    # spelling. Rectangle strong-form trials retain their compatible affine lift.
    lifting = (
        profile_lifting(mesh, study, scales) if settings.formulation == "potential-energy" else None
    )
    model = DisplacementNetwork(
        settings, edge_components(mesh, study), scales, device, dtype, lifting
    )
    material = torch.tensor(physical_material / young, device=device, dtype=dtype)
    points = sample_points(mesh, scales, settings, study, rng, device, dtype)
    quadrature = (
        energy_quadrature(mesh, scales, study, settings, device, dtype)
        if settings.formulation == "potential-energy"
        else None
    )
    trace = AdamTrainer(settings, device, metrics, cancelled).run(
        model, material, points, started, quadrature
    )
    last_losses = trace.history[-1].losses
    if cancelled and cancelled():
        raise EngineError("cancelled", "PINN evaluation was cancelled.")
    evaluation_started = time.perf_counter()
    validation = evaluate_held_out(model, mesh, study, settings, scales, material, device, dtype)
    energy_diagnostic: dict[str, Any] | None = None
    if quadrature is not None:
        last_energy = trace.energy_history[-1][1]
        audit = integration_audit(model, mesh, study, scales, material, device, dtype, settings)
        scale = max(abs(audit.strain), abs(audit.work), np.finfo(float).tiny)
        energy_diagnostic = {
            "schemaVersion": 1,
            "definition": "Dimensionless potential = strain energy minus boundary external work",
            "trainingQuadrature": "three-point triangles; two-point Gauss boundary edges",
            "auditQuadrature": (
                "four subdivided three-point triangles; five-point Gauss boundary edges"
            ),
            "interiorPoints": len(quadrature.interior),
            "boundaryPoints": len(quadrature.boundary),
            "physicalScale": scales.stress * scales.displacement * scales.length * mesh.thickness,
            "history": [
                {"step": step, **values.to_mapping()} for step, values in trace.energy_history
            ],
            "audit": audit.to_mapping(),
            "relativeIntegrationDifference": abs(last_energy.potential - audit.potential) / scale,
        }
        if energy_diagnostic["relativeIntegrationDifference"] > 0.01:
            difference = energy_diagnostic["relativeIntegrationDifference"]
            raise EngineError(
                "underintegrated-training",
                f"Potential energy differs by {100 * difference:.3g}% on finer quadrature "
                "(limit 1%). Increase integration points or refine the mesh, reduce the "
                "network or training budget, then rerun. No fields were published.",
            )
    displacement = evaluate_fields(
        model, mesh.positions[:, :2], scales, material, device, dtype
    ).displacement
    cell_fields = evaluate_fields(
        model, mesh.positions[mesh.cells, :2].mean(axis=1), scales, material, device, dtype
    )
    stress, strain = cell_fields.stress, cell_fields.strain
    reactions = support_reactions(model, mesh, study, scales, material, device, dtype)
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
        math.sqrt(last_losses.pde),
    )
    warnings = []
    if max(diagnostic["relativeForceBalance"], diagnostic["relativeMomentBalance"]) > 0.01:
        warnings.append(
            "Learned support tractions leave more than 1% global force or moment imbalance."
        )
    if last_losses.total > 1e-4:
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
            **({"energy": energy_diagnostic} if energy_diagnostic is not None else {}),
            "configuration": settings.to_mapping(),
            "device": device,
            "precision": "float32" if dtype == torch.float32 else "float64",
            "deviceReason": reason,
            "framework": "pytorch",
            "frameworkVersion": torch.__version__,
            "history": [measurement.to_mapping() for measurement in trace.history],
            "validation": validation,
            "normalization": {
                "length": scales.length,
                "stress": scales.stress,
                "displacement": scales.displacement,
            },
            "timings": {
                "trainingSeconds": trace.training_seconds,
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
