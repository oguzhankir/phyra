"""Autograd continuum references and actual force-driven PINN training.

The nonlinear displacement reference has σxx=ky, σyy=σxy=0 and zero divergence.
The training reference is exact axial extension with free Poisson contraction;
no reference displacement or stress is supplied to the train() implementation.
"""

from dataclasses import replace

import numpy as np
import pytest
import torch
from torch import nn

from phyra_engine.errors import EngineError
from phyra_engine.execution.devices import device_capabilities, select_device
from phyra_engine.materials.isotropic import plane_stress_matrix as constitutive_matrix
from phyra_engine.meshing.plane_stress import generate_rectangle
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.elasticity import equilibrium_residual, stress_and_strain
from phyra_engine.methods.physicsml.evaluation import evaluate_fields
from phyra_engine.methods.physicsml.networks import DisplacementNetwork
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.methods.physicsml.plane_stress import train


def configuration(**overrides):
    return {
        "layers": 2,
        "width": 16,
        "activation": "tanh",
        "optimizer": "adam",
        "learningRate": 0.003,
        "steps": 4,
        "interiorPoints": 32,
        "boundaryPoints": 8,
        "seed": 42,
        "device": "cpu",
        **overrides,
    }


def study(force=100, young=70e9, poisson=0.3):
    return {
        "material": {"young": young, "poisson": poisson},
        "constraints": [
            {"regions": ["x0"], "components": [0, None, None]},
            {"regions": ["y0"], "components": [None, 0, None]},
        ],
        "loads": [{"kind": "force", "regions": ["x1"], "vector": [force, 0, 0]}],
    }


class BendingReference(nn.Module):
    def forward(self, coordinates):
        x, y = coordinates.T
        return torch.stack((x * y, -(x * x + 0.3 * y * y) / 2), dim=1)


def test_exact_nonlinear_autograd_stress_and_pde():
    coordinates = torch.tensor(
        [[0.13, 0.21], [0.33, 0.14], [0.75, 0.44]], dtype=torch.float64, requires_grad=True
    )
    _, stress, strain = stress_and_strain(
        BendingReference(), coordinates, torch.tensor(constitutive_matrix(1, 0.3))
    )
    np.testing.assert_allclose(
        stress.detach().numpy(),
        np.column_stack((coordinates.detach().numpy()[:, 1], np.zeros((3, 2)))),
        atol=2e-16,
    )
    np.testing.assert_allclose(strain.detach().numpy()[:, 2], 0, atol=2e-16)
    residual = equilibrium_residual(stress, coordinates)
    np.testing.assert_allclose(residual.detach().numpy(), 0, atol=2e-16)
    # A wrong spatial derivative or engineering shear convention would break
    # this nontrivial exact continuum solution, independently of FEM assembly.


def test_chunked_field_evaluation_preserves_locations_and_physical_units():
    length, displacement, young, poisson = 0.4, 0.002, 3e9, 0.3
    stress = young * displacement / length
    scales = Normalization(
        length, stress, displacement, np.array([2.0, -3.0]), np.array([length, 0.1])
    )
    normalized = np.random.default_rng(19).random((2051, 2)) * [1, 0.25]
    locations = scales.origin + length * normalized
    fields = evaluate_fields(
        BendingReference(),
        locations,
        scales,
        torch.tensor(constitutive_matrix(1, poisson)),
        "cpu",
        torch.float64,
    )
    x, y = normalized.T
    expected_displacement = displacement * np.column_stack((x * y, -(x * x + poisson * y * y) / 2))
    expected_stress = stress * np.column_stack((y, np.zeros((len(y), 2))))
    expected_strain = displacement / length * np.column_stack((y, -poisson * y, np.zeros(len(y))))
    np.testing.assert_allclose(fields.displacement, expected_displacement, rtol=1e-12, atol=1e-17)
    np.testing.assert_allclose(fields.stress, expected_stress, rtol=1e-12, atol=1e-8)
    np.testing.assert_allclose(fields.strain, expected_strain, rtol=1e-12, atol=1e-17)
    assert all(
        field.dtype == np.float64 for field in (fields.displacement, fields.stress, fields.strain)
    )


def test_explicit_component_lifting_preserves_nonzero_supports():
    scales = Normalization(0.1, 1e6, 1e-4, np.zeros(2), np.array([0.1, 0.05]))
    components = {"x0": [2e-4, None], "x1": [4e-4, None], "y0": [None, -3e-4], "y1": [None, None]}
    model = DisplacementNetwork(
        TrainingConfiguration.from_mapping(configuration()),
        components,
        scales,
        "cpu",
        torch.float64,
    )
    # Perturb the neural output: explicit support values must still hold.
    final = model.network[-1]
    assert isinstance(final, nn.Linear)
    with torch.no_grad():
        final.weight.fill_(0.1)
        final.bias.fill_(0.4)
    points = torch.tensor(
        [[0, 0.23], [1, 0.43], [0.37, 0]], dtype=torch.float64, requires_grad=True
    )
    value = model(points).detach().numpy() * scales.displacement
    np.testing.assert_allclose(value[:2, 0], [2e-4, 4e-4], rtol=1e-14)
    np.testing.assert_allclose(value[2, 1], -3e-4, rtol=1e-14)


def test_real_training_metrics_shapes_and_reproducibility():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.025)
    metrics = []
    first = train(mesh, study(), configuration(steps=12), metrics.append)
    second = train(mesh, study(), configuration(steps=12))
    assert [event["step"] for event in metrics] == list(range(13))
    assert all(event["device"] == "cpu" for event in metrics)
    assert metrics[-1]["total"] < metrics[0]["total"]
    for event in metrics:
        assert event["total"] == event["pde"] + event["boundary"]
        assert event["boundary"] == event["displacement"] + event["traction"]
        assert event["displacement"] < 1e-28
        assert event["elapsedSeconds"] >= 0
    assert first["training"]["device"] == "cpu"
    assert first["training"]["precision"] == "float64"
    assert first["displacement"].shape == mesh.positions.shape
    assert first["stress"].shape == (len(mesh.cells), 6)
    assert first["reactions"].shape == mesh.positions.shape
    assert first["vonMises"].shape == (len(mesh.cells),)
    for key in ("displacement", "stress", "reactions", "vonMises"):
        np.testing.assert_array_equal(first[key], second[key])
        assert np.isfinite(first[key]).all()
    np.testing.assert_array_equal(first["stress"][:, [2, 4, 5]], 0)
    assert set(first["training"]["timings"]) == {"trainingSeconds", "inferenceSeconds"}
    # Undertrained fields must disclose measured residuals and a warning.
    assert first["warnings"]
    assert first["summary"]["relativeForceBalance"] > 0.01


def test_cooperative_cancellation_publishes_no_result():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.025)
    metrics = []
    with pytest.raises(EngineError) as error:
        train(
            mesh,
            study(),
            configuration(steps=100),
            metrics.append,
            cancelled=lambda: len(metrics) >= 3,
        )
    assert error.value.code == "cancelled"
    assert [event["step"] for event in metrics] == [0, 1, 2]


def test_metrics_callback_cannot_mutate_measured_training_history():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.025)
    settings = configuration()

    def mutate_receiving_event(event):
        event["step"] = -1
        event["total"] = float("nan")
        # The trainer has already decoded the request; editing its source does
        # not change the running step budget or the persisted configuration.
        settings["steps"] = 100

    result = train(mesh, study(), settings, mutate_receiving_event)
    history = result["training"]["history"]
    assert [event["step"] for event in history] == list(range(5))
    assert all(np.isfinite(event["total"]) for event in history)
    assert result["training"]["configuration"]["steps"] == 4


@pytest.mark.parametrize(
    "overrides",
    [
        {"steps": True},
        {"steps": 20001},
        {"width": 129},
        {"layers": 0},
        {"seed": -1},
        {"interiorPoints": 4097},
        {"boundaryPoints": 1025},
        {"learningRate": 0},
        {"learningRate": float("nan")},
        {"learningRate": True},
        {"activation": "relu"},
        {"optimizer": "lbfgs"},
        {"device": "other"},
        {"unknown": 1},
    ],
)
def test_invalid_configuration_is_rejected(overrides):
    with pytest.raises(EngineError):
        TrainingConfiguration.from_mapping(configuration(**overrides))


def test_devices_are_capability_probed_and_auto_is_explicit():
    devices = device_capabilities()
    assert {entry["id"] for entry in devices} == {"cpu", "mps", "cuda"}
    cpu = next(entry for entry in devices if entry["id"] == "cpu")
    assert cpu["available"] and cpu["precision"] == "float64"
    device, dtype, reason = select_device("auto")
    assert device == "cpu" and dtype == torch.float64 and "Auto" in reason
    unavailable = next((entry["id"] for entry in devices if not entry["available"]), None)
    if unavailable:
        with pytest.raises(EngineError) as error:
            select_device(unavailable)
        assert error.value.code == "device-unavailable"


def test_pinn_rejects_out_of_plane_or_underconstrained_physics():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.025)
    bad = study()
    bad["loads"][0]["vector"][2] = 1
    with pytest.raises(EngineError, match="out-of-plane"):
        train(mesh, bad, configuration())
    bad = study()
    bad["constraints"] = [{"regions": ["x0"], "components": [0, None, None]}]
    with pytest.raises(EngineError, match="rigid"):
        train(mesh, bad, configuration())
    with pytest.raises(EngineError):
        train(replace(mesh, thickness=0), study(), configuration())


@pytest.mark.slow
def test_real_axial_training_converges_without_fem_warmstart():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.01)
    physical = study()
    result = train(
        mesh,
        physical,
        configuration(
            layers=3,
            width=32,
            learningRate=0.001,
            steps=1000,
            interiorPoints=128,
            boundaryPoints=32,
        ),
    )
    exact_stress = 100 / (0.05 * 0.002)
    exact_strain = exact_stress / 70e9
    exact_displacement = mesh.positions * [exact_strain, -0.3 * exact_strain, 0]
    expected = np.tile([exact_stress, 0, 0, 0, 0, 0], (len(mesh.cells), 1))
    displacement_error = np.linalg.norm(
        result["displacement"] - exact_displacement
    ) / np.linalg.norm(exact_displacement)
    stress_error = np.linalg.norm(result["stress"] - expected) / np.linalg.norm(expected)
    assert displacement_error < 0.008, displacement_error
    assert stress_error < 0.008, stress_error
    history = result["training"]["history"]
    assert len(history) <= 1001
    assert history[-1]["step"] == 1000
    assert history[-1]["total"] < 1e-5
    assert history[-1]["total"] < history[0]["total"] * 1e-4
    # Support reactions come from the learned stress field, not forced balance.
    assert result["summary"]["relativeForceBalance"] < 0.01
    assert result["summary"]["relativeMomentBalance"] < 0.001
    np.testing.assert_allclose(
        result["summary"]["strainEnergy"], 100**2 * 0.1 / (2 * 70e9 * 0.05 * 0.002), rtol=0.015
    )


def test_combined_training_resource_budget_is_bounded():
    with pytest.raises(EngineError) as error:
        TrainingConfiguration.from_mapping(
            configuration(layers=6, width=128, interiorPoints=4096, boundaryPoints=1024)
        )
    assert error.value.code == "resource-limit"


def test_zero_load_and_force_applied_at_supported_edge_have_zero_work():
    mesh = generate_rectangle(0.1, 0.05, 0.002, 0.025)
    physical = study(force=0)
    zero = train(mesh, physical, configuration(steps=1))
    for field in ("displacement", "stress", "vonMises", "reactions"):
        np.testing.assert_array_equal(zero[field], 0)
    assert zero["summary"]["strainEnergy"] == 0
    physical["loads"][0]["regions"] = ["x0"]
    physical["loads"][0]["vector"] = [100, 0, 0]
    loaded = train(mesh, physical, configuration(steps=1))
    np.testing.assert_array_equal(loaded["displacement"], 0)
    np.testing.assert_array_equal(loaded["stress"], 0)
    np.testing.assert_allclose(loaded["summary"]["totalReaction"], [-100, 0, 0], atol=1e-13)
    np.testing.assert_allclose(loaded["summary"]["forceBalance"], 0, atol=1e-13)
    assert loaded["summary"]["strainEnergy"] == 0
