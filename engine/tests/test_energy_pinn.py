"""Independent potential-energy, traction, quadrature and optimization checks.

For axial stress S, ux=S*x/E and uy=-nu*S*y/E. Its strain energy is
S^2*area*thickness/(2E), external work twice that, and potential its negative.
These continuum identities do not depend on the FEM implementation or labels.
The variational method is adapted from https://doi.org/10.1016/j.cma.2023.116184;
these checks are not a claim to reproduce the paper's architectures or timings.
"""

from copy import deepcopy

import numpy as np
import pytest
import torch
from torch import nn

from phyra_engine.errors import EngineError
from phyra_engine.materials.isotropic import plane_stress_matrix
from phyra_engine.meshing.plane_stress import generate_rectangle
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.energy import (
    energy_quadrature,
    integration_audit,
    potential_energy,
)
from phyra_engine.methods.physicsml.lifting import profile_lifting
from phyra_engine.methods.physicsml.networks import DisplacementNetwork
from phyra_engine.methods.physicsml.normalization import normalization
from phyra_engine.methods.physicsml.plane_stress import train
from phyra_engine.methods.physicsml.sampling import edge_components, sample_points
from phyra_engine.physics.elasticity.plane_stress import edge_tractions, integrate_edge_loads


def settings(**overrides):
    return {
        "layers": 2,
        "width": 16,
        "activation": "tanh",
        "optimizer": "adam",
        "learningRate": 0.003,
        "steps": 8,
        "interiorPoints": 32,
        "boundaryPoints": 8,
        "seed": 42,
        "device": "cpu",
        "formulation": "potential-energy",
        **overrides,
    }


def axial_study(young=7e9, stress=1e6):
    return {
        "material": {"young": young, "poisson": 0.3},
        "constraints": [
            {"regions": ["left"], "components": [0, None, None]},
            {"regions": ["bottom"], "components": [None, 0, None]},
        ],
        "loads": [
            {
                "kind": "traction",
                "regions": ["right", "notch-v"],
                "traction": {
                    "kind": "affine",
                    "xx": [stress, 0, 0],
                    "yy": [0, 0, 0],
                    "xy": [0, 0, 0],
                },
            }
        ],
    }


def l_mesh(scale=0.05, origin=(0.0, 0.0)):
    """Hand-triangulated concave domain, independent of product meshing."""
    xy = scale * np.array([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], dtype=float) + origin
    return Mesh2D(
        np.column_stack((xy, np.zeros(len(xy)))),
        np.array([[0, 1, 3], [1, 2, 3], [0, 3, 5], [3, 4, 5]], dtype=np.uint32),
        np.array([[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]], dtype=np.uint32),
        np.arange(6, dtype=np.uint32),
        ("bottom", "right", "notch-h", "notch-v", "top", "left"),
        0.002,
    )


class AxialField(nn.Module):
    def __init__(self, amplitude=1.0):
        super().__init__()
        self.amplitude = nn.Parameter(torch.tensor(amplitude, dtype=torch.float64))

    def forward(self, coordinates):
        # Add a zero nonlinear term to keep autograd second derivatives defined.
        x, y = coordinates.T
        return self.amplitude * torch.stack((x + 0 * x**3, -0.3 * y + 0 * y**3), dim=1)


def test_exact_variational_energy_stationarity_and_work_on_concave_domain():
    mesh, study = l_mesh(origin=(-2.0, 3.0)), axial_study()
    scales = normalization(mesh, study)
    material = torch.tensor(plane_stress_matrix(1, 0.3))
    quadrature = energy_quadrature(
        mesh, scales, study, TrainingConfiguration.from_mapping(settings()), "cpu", torch.float64
    )
    model = AxialField()
    energy = potential_energy(model, material, quadrature)
    normalized_area = 3 / 4
    np.testing.assert_allclose(
        energy.measure().to_mapping()["strain"], normalized_area / 2, rtol=1e-14
    )
    np.testing.assert_allclose(energy.measure().work, normalized_area, rtol=1e-14)
    np.testing.assert_allclose(energy.measure().potential, -normalized_area / 2, rtol=1e-14)
    derivative = torch.autograd.grad(energy.potential, model.amplitude)[0]
    assert abs(float(derivative)) < 1e-15
    for amplitude in (0.8, 1.2):
        model = AxialField(amplitude)
        energy = potential_energy(model, material, quadrature)
        derivative = torch.autograd.grad(energy.potential, model.amplitude)[0]
        np.testing.assert_allclose(float(derivative), normalized_area * (amplitude - 1), rtol=1e-14)
    audit = integration_audit(
        AxialField(),
        mesh,
        study,
        scales,
        material,
        "cpu",
        torch.float64,
        TrainingConfiguration.from_mapping(settings()),
    )
    np.testing.assert_allclose(
        list(audit.to_mapping().values()),
        [-normalized_area / 2, normalized_area / 2, normalized_area],
        rtol=1e-14,
    )
    np.testing.assert_allclose(
        integrate_edge_loads(mesh, study["loads"]).sum(axis=0),
        [1e6 * 0.1 * mesh.thickness, 0],
        rtol=1e-14,
    )


def test_domain_sampling_never_visits_notch_and_is_area_uniform():
    mesh, study = l_mesh(), axial_study()
    scales = normalization(mesh, study)
    configuration = TrainingConfiguration.from_mapping(
        settings(interiorPoints=4096, width=4, layers=1)
    )
    points = sample_points(
        mesh, scales, configuration, study, np.random.default_rng(73), "cpu", torch.float64
    )
    physical = points.interior.detach().numpy() * scales.length + scales.origin
    assert not np.any((physical[:, 0] > 0.05) & (physical[:, 1] > 0.05))
    # Exact centroid is (5/6, 5/6)*scale. Statistical gate is independently
    # chosen as six standard errors for this fixed stream, not a fit to output.
    np.testing.assert_allclose(physical.mean(axis=0), [5 / 6 * 0.05] * 2, atol=0.002)


def test_profile_lifting_has_real_derivatives_and_no_interior_support():
    mesh, study = l_mesh(origin=(-1.0, 4.0)), axial_study()
    scales = normalization(mesh, study)
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(settings()),
        edge_components(mesh, study),
        scales,
        "cpu",
        torch.float64,
        profile_lifting(mesh, study, scales),
    )
    with torch.no_grad():
        model.network[-1].bias[:] = 1
    points = torch.tensor(
        [[0, 0.3], [0.2, 0], [0.25, 0.25]], dtype=torch.float64, requires_grad=True
    )
    displacement = model(points)
    np.testing.assert_allclose(
        displacement.detach().numpy(), [[0, 0.3], [0.2, 0], [0.25, 0.25]], atol=1e-14
    )
    dx = torch.autograd.grad(displacement[:, 0].sum(), points, retain_graph=True)[0]
    dy = torch.autograd.grad(displacement[:, 1].sum(), points)[0]
    np.testing.assert_allclose(dx.detach().numpy(), [[1, 0]] * 3, atol=1e-14)
    np.testing.assert_allclose(dy.detach().numpy(), [[0, 1]] * 3, atol=1e-14)


def segmented_bottom_mesh():
    rectangle = generate_rectangle(1, 1, 0.01, 1 / 61)
    bottom = np.flatnonzero(rectangle.edge_regions == 2)
    assert len(bottom) == 61
    # Reverse alternate edge windings: physical segments have no orientation.
    edges = rectangle.edges.copy()
    edges[bottom[::2]] = edges[bottom[::2], ::-1]
    indices = rectangle.edge_regions.copy()
    indices[indices == 3] = 2
    indices[bottom] = np.arange(3, 64)
    return Mesh2D(
        rectangle.positions,
        rectangle.cells,
        edges,
        indices,
        ("left", "right", "top", *(f"bottom-{index}" for index in range(61))),
        rectangle.thickness,
    )


@pytest.mark.parametrize("dtype", [torch.float64, torch.float32])
def test_lifting_preserves_trial_space_under_collinear_semantic_subdivision(dtype):
    mesh = segmented_bottom_mesh()
    study = {
        "material": {"young": 1e7, "poisson": 0.2},
        "constraints": [{"regions": list(mesh.regions[3:]), "components": [0, 0, None]}],
        "loads": [{"kind": "force", "regions": ["top"], "vector": [0, 100, 0]}],
    }
    scales = normalization(mesh, study)
    lifting = profile_lifting(mesh, study, scales)
    assert all(len(item.groups[0].segments) == 1 for item in lifting)
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(settings(layers=1, width=4)),
        edge_components(mesh, study),
        scales,
        "cpu",
        dtype,
        lifting,
    )
    with torch.no_grad():
        model.network[-1].bias[:] = 1
    coordinates = torch.tensor(
        [[0.5, 0], [0.5, 0.05], [0.5, 0.25], [0.5, 0.5]],
        dtype=dtype,
        requires_grad=True,
    )
    displacement = model(coordinates)
    np.testing.assert_allclose(
        displacement.detach().numpy(),
        np.repeat(coordinates.detach().numpy()[:, 1:2], 2, 1),
        rtol=1e-7,
        atol=0,
    )
    for component in range(2):
        gradient = torch.autograd.grad(
            displacement[:, component].sum(), coordinates, retain_graph=True
        )[0]
        np.testing.assert_array_equal(gradient.detach().numpy(), [[0, 1]] * len(coordinates))


def test_merging_semantic_subdivision_preserves_unassigned_collinear_gap():
    mesh = segmented_bottom_mesh()
    assigned = [*mesh.regions[3:23], *mesh.regions[44:]]
    study = {
        "material": {"young": 1e7, "poisson": 0.2},
        "constraints": [{"regions": assigned, "components": [0, 0, None]}],
        "loads": [{"kind": "force", "regions": ["top"], "vector": [0, 100, 0]}],
    }
    scales = normalization(mesh, study)
    lifting = profile_lifting(mesh, study, scales)
    assert all(len(item.groups[0].segments) == 2 for item in lifting)
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(settings()),
        edge_components(mesh, study),
        scales,
        "cpu",
        torch.float64,
        lifting,
    )
    with torch.no_grad():
        model.network[-1].bias[:] = 1
    points = torch.tensor([[0.1, 0], [0.5, 0], [0.9, 0]], dtype=torch.float64)
    displacement = model(points).detach().numpy()
    np.testing.assert_array_equal(displacement[[0, 2]], 0)
    assert np.all(displacement[1] > 0)


@pytest.mark.parametrize("dtype", [torch.float64, torch.float32])
def test_harmonic_union_of_disjoint_supports_has_finite_nonzero_gradients(dtype):
    mesh = segmented_bottom_mesh()
    study = {
        "material": {"young": 1e7, "poisson": 0.2},
        "constraints": [{"regions": list(mesh.regions[3::2]), "components": [0, 0, None]}],
        "loads": [{"kind": "force", "regions": ["top"], "vector": [0, 100, 0]}],
    }
    scales = normalization(mesh, study)
    lifting = profile_lifting(mesh, study, scales)
    assert all(len(item.groups[0].segments) == 31 for item in lifting)
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(settings(layers=1, width=4)),
        edge_components(mesh, study),
        scales,
        "cpu",
        dtype,
        lifting,
    )
    with torch.no_grad():
        model.network[-1].bias[:] = 1
    coordinates = torch.tensor(
        [[0.5, y] for y in (0.001, 0.005, 0.05, 0.25, 0.5)],
        dtype=dtype,
        requires_grad=True,
    )
    # Independent closed-form union and derivative: d=1/sum(1/phi_i),
    # d_y=d^2*sum(phi_i,y/phi_i^2). Alternating unit-square bottom intervals
    # have phi_i=(y+overhang^2)/(1+max(a,1-b)^2).
    low = np.arange(0, 61, 2) / 61
    high = low + 1 / 61
    scale = 1 + np.maximum(low, 1 - high) ** 2
    x, y = coordinates.detach().double().numpy().T
    tail = np.maximum(low - x[:, None], 0) ** 2 + np.maximum(x[:, None] - high, 0) ** 2
    distances = (y[:, None] + tail) / scale
    expected = 1 / np.sum(1 / distances, axis=1)
    expected_dy = expected**2 * np.sum(1 / (scale * distances**2), axis=1)
    displacement = model(coordinates)
    gradient = torch.autograd.grad(displacement[:, 0].sum(), coordinates)[0]
    assert torch.all(displacement > 0) and torch.all(gradient[:, 1] > 0)
    np.testing.assert_allclose(displacement[:, 0].detach().numpy(), expected, rtol=3e-6)
    np.testing.assert_allclose(gradient[:, 1].detach().numpy(), expected_dy, rtol=3e-6)


def test_harmonic_union_corner_has_finite_weak_first_derivative():
    from phyra_engine.methods.physicsml.networks import _union_distance

    coordinates = torch.tensor(
        [[0, 0], [1e-30, 1e-30], [1e-20, 1e-20], [0.1, 0.2]],
        dtype=torch.float32,
        requires_grad=True,
    )
    union, _ = _union_distance(coordinates[:, 0], coordinates[:, 1])
    gradient = torch.autograd.grad(union.sum(), coordinates, create_graph=True)[0]
    hessian_row = torch.autograd.grad(gradient[:, 0].sum(), coordinates)[0]
    assert torch.isfinite(union).all() and torch.isfinite(gradient).all()
    assert torch.isfinite(hessian_row).all()
    np.testing.assert_allclose(union.detach().numpy(), [0, 5e-31, 5e-21, 1 / 15], rtol=2e-7)
    np.testing.assert_allclose(
        gradient.detach().numpy(), [[0, 0], [0.25, 0.25], [0.25, 0.25], [4 / 9, 1 / 9]], rtol=2e-7
    )
    # d_aa=-2*b^2/(a+b)^3 and d_ab=2*a*b/(a+b)^3. Both tiny
    # Hessians are representable in float32 and must remain finite for the
    # held-out second-derivative PDE diagnostics, independently of energy loss.
    np.testing.assert_allclose(
        hessian_row.detach().numpy()[1:],
        [[-2.5e29, 2.5e29], [-2.5e19, 2.5e19], [-80 / 27, 40 / 27]],
        rtol=2e-7,
    )


@pytest.mark.parametrize("defect", ["curved", "interior"])
def test_lifting_refuses_hidden_or_unimplemented_constraints(defect):
    mesh, study = l_mesh(), axial_study()
    study = deepcopy(study)
    if defect == "curved":
        # A named region with non-collinear pieces represents an unsupported curve.
        mesh.edge_regions[4] = 1
        study["constraints"][0]["regions"] = ["right"]
    else:
        study["constraints"][0]["regions"] = ["notch-v"]
    with pytest.raises(EngineError) as error:
        profile_lifting(mesh, study, normalization(mesh, study))
    assert error.value.code == "unsupported-essential-boundary"


def eccentric_mesh(size=0.125):
    rectangle = generate_rectangle(1, 1, 0.01, size)
    indices = rectangle.edge_regions.copy()
    top = indices == 3
    midpoints = rectangle.positions[rectangle.edges, 0].mean(axis=1)
    indices[top & (midpoints > 0.5)] = 4
    return Mesh2D(
        rectangle.positions,
        rectangle.cells,
        rectangle.edges,
        indices,
        ("left", "right", "bottom", "top-left", "top-right"),
        rectangle.thickness,
    )


def eccentric_study():
    return {
        "material": {"young": 1e7, "poisson": 0.2},
        "constraints": [
            {"regions": ["bottom"], "components": [0, 0, None]},
            {"regions": ["top-left"], "components": [0, 0.1, None]},
        ],
        "loads": [],
    }


def test_finite_partial_support_nonzero_lifting_frees_unassigned_collinear_edge():
    mesh, study = eccentric_mesh(), eccentric_study()
    scales = normalization(mesh, study)
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(settings()),
        edge_components(mesh, study),
        scales,
        "cpu",
        torch.float64,
        profile_lifting(mesh, study, scales),
    )
    with torch.no_grad():
        model.network[-1].bias[:] = 0.4
    coordinates = torch.tensor(
        [[0.1, 0], [0.9, 0], [0.1, 1], [0.5, 1], [0.8, 1]], dtype=torch.float64, requires_grad=True
    )
    displacement = model(coordinates)
    physical = displacement.detach().numpy() * scales.displacement
    np.testing.assert_array_equal(physical[:2], 0)
    np.testing.assert_allclose(physical[2:4], [[0, 0.1], [0, 0.1]], rtol=1e-14)
    assert physical[4, 0] > 0 and abs(physical[4, 1] - 0.1) > 1e-4
    for component in range(2):
        gradient = torch.autograd.grad(
            displacement[:, component].sum(), coordinates, retain_graph=True
        )[0]
        assert torch.isfinite(gradient).all()
    # The paper's top midpoint switches essential/natural conditions: the free
    # interval remains trainable, while prescribed finite-segment values remain exact.


def test_energy_training_signed_history_audit_and_cancellation():
    mesh, study = l_mesh(), axial_study()
    first = train(mesh, study, settings(steps=12))
    second = train(mesh, study, settings(steps=12))
    energy = first["training"]["energy"]
    assert energy["history"][0]["potential"] == 0
    assert energy["history"][-1]["potential"] < 0
    assert energy["interiorPoints"] == 48 and energy["boundaryPoints"] == 48
    assert energy["audit"]["strain"] >= 0
    np.testing.assert_array_equal(first["displacement"], second["displacement"])
    count = []
    with pytest.raises(EngineError) as error:
        train(mesh, study, settings(steps=50), count.append, cancelled=lambda: len(count) >= 3)
    assert error.value.code == "cancelled"
    assert len(count) == 3


def test_energy_quadrature_resource_budget_is_independent_of_collocation_budget():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.005)
    study = {
        "material": {"young": 7e9, "poisson": 0.3},
        "constraints": [{"regions": ["x0"], "components": [0, 0, None]}],
        "loads": [{"kind": "force", "regions": ["x1"], "vector": [100, 0, 0]}],
    }
    with pytest.raises(EngineError) as error:
        energy_quadrature(
            mesh,
            normalization(mesh, study),
            study,
            TrainingConfiguration.from_mapping(settings(width=128, layers=6)),
            "cpu",
            torch.float64,
        )
    assert error.value.code == "resource-limit"


@pytest.mark.slow
@pytest.mark.parametrize("seed", [42, 81])
def test_energy_pinn_actual_optimization_matches_independent_axial_solution(seed):
    mesh, study = l_mesh(), axial_study()
    trained = train(
        mesh, study, settings(steps=1500, seed=seed, interiorPoints=1024, boundaryPoints=64)
    )
    stress, young, poisson = 1e6, 7e9, 0.3
    x, y = mesh.positions[:, :2].T
    expected = stress / young * np.column_stack((x, -poisson * y, np.zeros(len(x))))
    relative = np.linalg.norm(trained["displacement"] - expected) / np.linalg.norm(expected)
    assert relative < 0.03
    stress_reference = np.tile([stress, 0, 0, 0, 0, 0], (len(mesh.cells), 1))
    assert (
        np.linalg.norm(trained["stress"] - stress_reference) / np.linalg.norm(stress_reference)
        < 0.05
    )
    assert trained["summary"]["relativeForceBalance"] < 0.03
    assert trained["summary"]["relativeMomentBalance"] < 0.03
    exact_energy = stress**2 * 3 * 0.05**2 * mesh.thickness / (2 * young)
    audit = trained["training"]["energy"]
    assert (
        abs(audit["audit"]["strain"] * audit["physicalScale"] - exact_energy) / exact_energy < 0.03
    )
    assert audit["relativeIntegrationDifference"] < 0.01


def test_energy_cache_roundtrip_preserves_signed_measurements_and_rejects_forgery(tmp_path):
    import json
    from pathlib import Path

    from phyra_engine.execution.application import _owned_training_result
    from phyra_engine.results.plane_stress import validate_cached, write_output
    from phyra_engine.studies.mesh import generate_study_mesh

    project = json.loads(
        (Path(__file__).resolve().parents[2] / "examples/energy-tension.json").read_text()
    )
    project["study"]["solver"]["pinn"]["steps"] = 4
    mesh = generate_study_mesh(project)
    result = _owned_training_result(
        train(mesh, project["study"], project["study"]["solver"]["pinn"]), "energy-cache"
    )
    manifest = write_output(tmp_path, project, "energy-cache", "train", mesh, result)
    blob = (tmp_path / "buffer.bin").read_bytes()
    assert validate_cached(project, manifest, blob) == manifest
    assert manifest["training"]["energy"]["history"][-1]["potential"] < 0
    for defect in ("signed", "count", "step", "integration", "scale", "missing"):
        bad = deepcopy(manifest)
        energy = bad["training"]["energy"]
        if defect == "signed":
            energy["audit"]["potential"] += 1
        elif defect == "count":
            energy["interiorPoints"] += 1
        elif defect == "step":
            energy["history"][-1]["step"] -= 1
        elif defect == "integration":
            energy["relativeIntegrationDifference"] += 0.1
        elif defect == "scale":
            energy["physicalScale"] *= 2
        else:
            del bad["training"]["energy"]
        with pytest.raises(EngineError) as error:
            validate_cached(project, bad, blob)
        assert error.value.code == "invalid-cache"


def test_spatial_collocation_loads_evaluate_at_actual_points():
    mesh, study = l_mesh(), axial_study()
    study["loads"][0]["traction"]["xx"] = [0, 1e6, 0]
    scales = normalization(mesh, study)
    configuration = TrainingConfiguration.from_mapping(settings())
    points = sample_points(
        mesh, scales, configuration, study, np.random.default_rng(42), "cpu", torch.float64
    )
    physical = points.boundary.detach().numpy() * scales.length + scales.origin
    normals = points.normals.detach().numpy()
    tractions = points.traction.detach().numpy() * scales.stress
    np.testing.assert_allclose(
        tractions[:, 0],
        1e6
        * physical[:, 0]
        * normals[:, 0]
        * np.isin(np.repeat(np.arange(6), configuration.boundary_points), [1, 3]),
        atol=1e-10,
    )
    # A sample on the changing affine field must not inherit the midpoint's value.
    study["loads"][0]["traction"]["xx"] = [0, 0, 1e6]
    points = sample_points(
        mesh, scales, configuration, study, np.random.default_rng(42), "cpu", torch.float64
    )
    physical = points.boundary.detach().numpy() * scales.length + scales.origin
    normals = points.normals.detach().numpy()
    tractions = points.traction.detach().numpy() * scales.stress
    selected = np.isin(np.repeat(np.arange(6), configuration.boundary_points), [1, 3])
    np.testing.assert_allclose(
        tractions[selected, 0], 1e6 * physical[selected, 1] * normals[selected, 0], atol=1e-10
    )
    assert np.ptp(tractions[selected, 0]) > 100


def midpoint_zero_affine_study():
    return {
        "material": {"young": 7e9, "poisson": 0.3},
        "constraints": [{"regions": ["x0"], "components": [0, 0, None]}],
        "loads": [
            {
                "kind": "traction",
                "regions": ["x1"],
                "traction": {
                    "kind": "affine",
                    "xx": [-1e6, 0, 2e6],
                    "yy": [0, 0, 0],
                    "xy": [0, 0, 0],
                },
            }
        ],
    }


@pytest.mark.parametrize("size", [1.0, 0.125])
def test_midpoint_zero_affine_traction_has_mesh_independent_physical_scale_and_energy(size):
    from phyra_engine.methods.physicsml.elasticity import equilibrium_residual, stress_and_strain

    mesh, study = generate_rectangle(1, 1, 0.02, size), midpoint_zero_affine_study()
    if size == 1:
        # Every coarse-edge midpoint is zero, although the authored boundary
        # field has a nonzero couple. Midpoint-only scaling used the E*1e-8
        # fallback (70 Pa), instead of the exact endpoint maximum (1 MPa).
        np.testing.assert_array_equal(edge_tractions(mesh, study["loads"]), 0)
    scales = normalization(mesh, study)
    assert scales.stress == 1e6
    assert scales.displacement == 1e6 / 7e9
    config = TrainingConfiguration.from_mapping(settings())
    batch = sample_points(
        mesh, scales, config, study, np.random.default_rng(42), "cpu", torch.float64
    )
    selected = batch.normals[:, 0] == 1
    targets = batch.traction[selected, 0].detach().numpy()
    y = batch.boundary[selected, 1].detach().numpy()
    np.testing.assert_allclose(targets, 2 * (y - 0.5), rtol=1e-14)
    assert targets.min() < 0 < targets.max() and np.max(np.abs(targets)) <= 1

    class CenteredBendingField(nn.Module):
        def forward(self, coordinates):
            x, y = coordinates.T
            return torch.stack((2 * x * (y - 0.5), -(x * x + 0.3 * (y - 0.5) ** 2)), dim=1)

    material = torch.tensor(plane_stress_matrix(1, 0.3))
    _, stress, _ = stress_and_strain(CenteredBendingField(), batch.interior, material)
    expected = np.column_stack(
        (2 * (batch.interior.detach().numpy()[:, 1] - 0.5), np.zeros((len(batch.interior), 2)))
    )
    np.testing.assert_allclose(stress.detach().numpy(), expected, atol=5e-16)
    np.testing.assert_allclose(
        equilibrium_residual(stress, batch.interior).detach().numpy(), 0, atol=5e-16
    )
    quadrature = energy_quadrature(mesh, scales, study, config, "cpu", torch.float64)
    energy = potential_energy(CenteredBendingField(), material, quadrature).measure()
    # Independent continuum identities for sigma_xx=A*(y-1/2):
    # U=A^2*h/(24E), W=A^2*h/(12E). This is an integration/autograd
    # reference, not an assertion that the trial meets the clamped support.
    physical_scale = scales.stress * scales.displacement * scales.length * mesh.thickness
    exact = (2e6) ** 2 * mesh.thickness / (24 * study["material"]["young"])
    np.testing.assert_allclose(
        [energy.strain, energy.work, energy.potential],
        [exact, 2 * exact, -exact] / np.asarray(physical_scale),
        rtol=1e-14,
    )


def test_midpoint_zero_affine_training_cache_roundtrip_rejects_old_fallback_scale(tmp_path):
    import json
    from pathlib import Path

    from phyra_engine.execution.application import _owned_training_result
    from phyra_engine.results.plane_stress import validate_cached, write_output
    from phyra_engine.studies.mesh import generate_study_mesh

    project = json.loads(
        (Path(__file__).resolve().parents[2] / "examples/energy-tension.json").read_text()
    )
    project["study"].update(midpoint_zero_affine_study())
    project["study"]["material"]["name"] = "Generic elastic material"
    project["study"]["constraints"][0].update(id="clamp", name="Fixed edge")
    project["study"]["loads"][0].update(
        id="bending", name="Sign-changing traction", vector=[0, 0, 0], pressure=0
    )
    project["geometry"].update(length=1, width=1)
    project["study"]["thickness"] = 0.02
    project["study"]["mesh"]["size"] = 1
    project["study"]["solver"]["pinn"].update(settings(steps=4))
    mesh = generate_study_mesh(project)
    result = _owned_training_result(
        train(mesh, project["study"], project["study"]["solver"]["pinn"]), "affine-cache"
    )
    manifest = write_output(tmp_path, project, "affine-cache", "train", mesh, result)
    blob = (tmp_path / "buffer.bin").read_bytes()
    assert validate_cached(project, manifest, blob) == manifest
    assert manifest["training"]["normalization"]["stress"] == 1e6
    assert all(np.isfinite(item["total"]) for item in manifest["training"]["history"])
    forged = deepcopy(manifest)
    forged["training"]["normalization"].update(stress=70, displacement=1e-8)
    with pytest.raises(EngineError) as error:
        validate_cached(project, forged, blob)
    assert error.value.code == "invalid-cache"
    assert "normalization does not match" in str(error.value)


@pytest.mark.parametrize("kind", ["force", "pressure"])
def test_constant_load_normalization_remains_identical_to_legacy_midpoints(kind):
    mesh, study = generate_rectangle(0.2, 0.1, 0.02, 0.04), midpoint_zero_affine_study()
    study["loads"] = [
        {
            "kind": kind,
            "regions": ["x1", "y1"],
            **({"vector": [60, -80, 0]} if kind == "force" else {"pressure": 2e6}),
        }
    ]
    legacy_scale = float(np.linalg.norm(edge_tractions(mesh, study["loads"]), axis=1).max())
    assert normalization(mesh, study).stress == legacy_scale


@pytest.mark.parametrize("version", [2, 3, 4])
def test_v5_formulation_upgrade_preserves_old_digest_and_keeps_energy_distinct(version):
    import json
    from pathlib import Path

    from phyra_engine.studies.project import fingerprint, migrate_project

    old = json.loads(
        (Path(__file__).resolve().parents[2] / "examples/plane-stress-tension.json").read_text()
    )
    old["schemaVersion"] = version
    del old["study"]["solver"]["pinn"]["formulation"]
    if version == 2:
        del old["namedSelections"]
    original = deepcopy(old)
    current = migrate_project(old)
    assert old == original
    assert current["schemaVersion"] == 5
    assert current["study"]["solver"]["pinn"]["formulation"] == "strong-form"
    assert fingerprint(current) == fingerprint(old)
    current["study"]["solver"]["pinn"]["formulation"] = "potential-energy"
    assert fingerprint(current) != fingerprint(old)


class CubicField(nn.Module):
    def forward(self, coordinates):
        x, y = coordinates.T
        return torch.stack((x**3, 0 * y**3), dim=1)


def test_nonlinear_quadrature_error_converges_separately_from_optimization():
    from phyra_engine.methods.physicsml.normalization import Normalization

    mesh = l_mesh(scale=0.5)
    study = {"loads": []}
    scales = Normalization(1, 1, 1, np.zeros(2), np.ones(2))
    material = torch.tensor(plane_stress_matrix(1, 0.3))
    # eps_xx=3*x^2, so U=9/(2*(1-nu^2))*integral(x^4). The unit
    # L domain is the unit square minus its upper-right half-size square.
    exact = 9 / (2 * (1 - 0.3**2)) * (1 / 5 - (1 - 0.5**5) / 10)
    errors = []
    for count in (12, 48, 192):
        configuration = TrainingConfiguration.from_mapping(settings(interiorPoints=count))
        quadrature = energy_quadrature(mesh, scales, study, configuration, "cpu", torch.float64)
        coarse = potential_energy(CubicField(), material, quadrature).measure()
        audit = integration_audit(
            CubicField(), mesh, study, scales, material, "cpu", torch.float64, configuration
        )
        errors.append(abs(coarse.strain - exact))
        assert abs(audit.strain - exact) < abs(coarse.strain - exact)
    assert errors[1] < errors[0] / 3 and errors[2] < errors[1] / 3


def test_coarse_energy_integration_fails_before_field_publication(monkeypatch):
    class FifthOrderTrial(nn.Module):
        def __init__(self):
            super().__init__()
            self.amplitude = nn.Parameter(torch.tensor(1.0, dtype=torch.float64))

        def forward(self, coordinates):
            x, y = coordinates.T
            return self.amplitude * torch.stack((x**5, 0 * y**5), dim=1)

    # A valid essential-boundary trial has strongly varying strain energy;
    # degree-two quadrature on four coarse triangles cannot resolve its x^8
    # density. The finer integration gate must catch this even with finite,
    # decreasing Adam measurements. No FEM/reference labels enter optimization.
    import phyra_engine.methods.physicsml.plane_stress as method

    monkeypatch.setattr(method, "DisplacementNetwork", lambda *args: FifthOrderTrial())
    mesh, study = l_mesh(), axial_study()
    study["loads"] = []
    measured = []
    with pytest.raises(EngineError) as error:
        train(mesh, study, settings(steps=1, interiorPoints=8, boundaryPoints=4), measured.append)
    assert error.value.code == "underintegrated-training"
    assert "No fields were published" in str(error.value)
    assert len(measured) == 2 and measured[-1]["total"] < measured[0]["total"]
