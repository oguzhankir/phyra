"""Independent continuum residuals and post-training sampling/gradient isolation.

For axial traction S, ux=Sx/E and uy=-nu Sy/E give constant sigma_xx=S
and zero div(sigma); their exact natural and prescribed boundary conditions
provide a continuum reference without any FEM labels. A quadratic perturbation
ux += a x^2 in normalized coordinates gives div(sigma)_x=2a/(1-nu^2).
The strong-form method is adapted from https://doi.org/10.1016/j.jcp.2018.10.045.
Held-out residuals are measurements, not a mathematical field-error bound.
"""

import numpy as np
import pytest
import torch
from torch import nn

from phyra_engine.errors import EngineError
from phyra_engine.materials.isotropic import plane_stress_matrix
from phyra_engine.meshing.plane_stress import generate_rectangle
from phyra_engine.methods.physicsml import plane_stress as method
from phyra_engine.methods.physicsml import training, validation
from phyra_engine.methods.physicsml.configuration import TrainingConfiguration
from phyra_engine.methods.physicsml.normalization import normalization


def configuration(**overrides):
    return {
        "layers": 1,
        "width": 8,
        "activation": "tanh",
        "optimizer": "adam",
        "learningRate": 0.001,
        "steps": 8,
        "interiorPoints": 16,
        "boundaryPoints": 8,
        "seed": 42,
        "device": "cpu",
        **overrides,
    }


def study():
    return {
        "material": {"young": 70e9, "poisson": 0.3},
        "constraints": [
            {"regions": ["x0"], "components": [0, None, None]},
            {"regions": ["y0"], "components": [None, 0, None]},
        ],
        "loads": [{"regions": ["x1"], "kind": "force", "vector": [100, 0, 0]}],
    }


class AxialField(nn.Module):
    def __init__(self, poisson=0.3, factor=1.0, quadratic=0.0):
        super().__init__()
        self.poisson, self.factor, self.quadratic = poisson, factor, quadratic

    def forward(self, x):
        # Zero quadratic terms retain the derivative graph of the exact affine
        # reference; no samples or continuum labels enter the learned network.
        return torch.stack(
            (
                self.factor * x[:, 0] + self.quadratic * x[:, 0].square(),
                -self.factor * self.poisson * x[:, 1] + 0 * x[:, 1].square(),
            ),
            dim=1,
        )


def evaluate(model, config=None, length_scale=1.0, modulus_scale=1.0):
    mesh = generate_rectangle(*(length_scale * value for value in (0.4, 0.1, 0.02, 0.05)))
    physics = study()
    physics["material"]["young"] *= modulus_scale
    physics["loads"][0]["vector"][0] *= modulus_scale * length_scale**2
    scales = normalization(mesh, physics)
    young = physics["material"]["young"]
    material = torch.tensor(plane_stress_matrix(young, physics["material"]["poisson"]) / young)
    return method.evaluate_held_out(
        model,
        mesh,
        physics,
        TrainingConfiguration.from_mapping(config or configuration()),
        scales,
        material,
        "cpu",
        torch.float64,
    )


def test_exact_axial_continuum_field_has_zero_independent_residuals():
    diagnostic = evaluate(AxialField())
    assert diagnostic["schemaVersion"] == 1
    assert diagnostic["sampling"] == "independent-uniform"
    assert diagnostic["seed"] != configuration()["seed"]
    assert diagnostic["interiorPoints"] == 16 and diagnostic["boundaryPointsPerRegion"] == 8
    assert all(
        diagnostic[key] < 1e-28 for key in ("total", "pde", "boundary", "displacement", "traction")
    )
    assert evaluate(AxialField()) == diagnostic


@pytest.mark.parametrize("length_scale", [1e-3, 1.0, 1e3])
@pytest.mark.parametrize("modulus_scale", [1e-3, 1.0, 1e3])
def test_dimensionless_held_out_reference_preserves_physical_similarity(
    length_scale, modulus_scale
):
    # L -> aL, t -> at, E -> bE, F -> ba²F keeps stress/E and
    # displacement/L unchanged; the normalized continuum problem is identical.
    diagnostic = evaluate(AxialField(), length_scale=length_scale, modulus_scale=modulus_scale)
    assert all(
        diagnostic[key] < 1e-28 for key in ("total", "pde", "boundary", "displacement", "traction")
    )


def test_zero_pde_does_not_hide_a_misspecified_boundary_traction():
    wrong = evaluate(AxialField(factor=1.5))
    assert wrong["pde"] == 0
    assert wrong["displacement"] == 0
    # Six unconstrained boundary-component groups; one has traction error 1/2.
    np.testing.assert_allclose(wrong["traction"], 0.5**2 / 6, rtol=1e-14, atol=0)
    assert wrong["total"] > 0.04


def test_manufactured_quadratic_error_has_the_expected_nonzero_equilibrium_residual():
    coefficient, poisson = 0.2, 0.3
    wrong = evaluate(AxialField(poisson, quadratic=coefficient))
    expected = (2 * coefficient / (1 - poisson**2)) ** 2 / 2
    np.testing.assert_allclose(wrong["pde"], expected, rtol=1e-14, atol=0)
    assert wrong["pde"] > 0.09


def test_nonfinite_held_out_fields_are_rejected():
    with pytest.raises(EngineError) as error:
        evaluate(AxialField(factor=float("nan")))
    assert error.value.code == "nonfinite-validation"


def test_held_out_points_never_supply_optimizer_gradients(monkeypatch):
    config = configuration()
    mesh = generate_rectangle(0.4, 0.1, 0.02, 0.05)
    original_sample, original_losses = method.sample_points, training.residual_losses
    original_step, original_validation = torch.optim.Adam.step, method.evaluate_held_out
    batches, backwards, steps = [], [], []

    def sample(*args, **kwargs):
        points = original_sample(*args, **kwargs)
        batches.append(points)
        return points

    def losses(model, material, points):
        result = original_losses(model, material, points)
        batch = next(index for index, value in enumerate(batches) if value is points)
        result.total.register_hook(lambda gradient: backwards.append(batch))
        return result

    def step(optimizer, *args, **kwargs):
        result = original_step(optimizer, *args, **kwargs)
        steps.append(1)
        return result

    def validate_after_training(model, *args, **kwargs):
        assert len(steps) == config["steps"]
        before = [parameter.detach().clone() for parameter in model.parameters()]
        assert all(parameter.grad is None for parameter in model.parameters())
        result = original_validation(model, *args, **kwargs)
        assert all(parameter.grad is None for parameter in model.parameters())
        for expected, actual in zip(before, model.parameters(), strict=True):
            torch.testing.assert_close(actual, expected, rtol=0, atol=0)
        return result

    monkeypatch.setattr(method, "sample_points", sample)
    monkeypatch.setattr(validation, "sample_points", sample)
    monkeypatch.setattr(training, "residual_losses", losses)
    monkeypatch.setattr(validation, "residual_losses", losses)
    monkeypatch.setattr(torch.optim.Adam, "step", step)
    monkeypatch.setattr(method, "evaluate_held_out", validate_after_training)
    result = method.train(mesh, study(), config)
    assert len(batches) == 2 and backwards == [0] * config["steps"]
    assert not torch.equal(batches[0].interior, batches[1].interior)
    assert not torch.equal(batches[0].boundary, batches[1].boundary)
    assert result["training"]["validation"]["seed"] == config["seed"] ^ 0x5EED5EED
