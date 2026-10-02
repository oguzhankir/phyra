"""Independent reference checks for the finite quarter-domain Kirsch workflow.

This is an SI realization of Le-Duc et al. §6.3/Appendix B.2, not neural-method
reproduction. Author values R=1,L=4,E=1e5,nu=.3,T=.5 have unstated units; here
length is m and E,T are Pa, and thickness=.1 m is explicitly chosen. The
changed case R=.75,T=.25 uses the same generic profile and boundary contracts.

Before measuring refinements, acceptance is set for P1 triangles at global
h=.5,.25,.125 and cavity h/2: finest area-weighted displacement error <1.5%,
Frobenius stress error <12%, cavity traction RMS/|T| <35%; finest/coarsest ratios
<.55,.7,.8 respectively. These are discretization gates, not paper claims.
Local error need not be strictly monotone. Exact hole stresses, continuum
force/moment integrals and displacement derivatives independently check signs
and constitutive factors without FEM labels.
"""

import copy
import json
import math
from pathlib import Path

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.physics.elasticity.kirsch import (
    kirsch_displacement,
    kirsch_stress,
    kirsch_traction,
)
from phyra_engine.results.kirsch import (
    _BARYCENTRIC,
    _WEIGHTS,
    _weighted_metric,
    eligible_reference,
    reference_diagnostics,
)


def quarter_case(radius=1.0, tension=0.5):
    """Exact second-quadrant profile; semantic IDs belong to this definition."""
    length = 4.0
    outer = [
        {
            "id": "bottom",
            "name": "Y symmetry",
            "kind": "line",
            "start": [-radius, 0],
            "end": [-length, 0],
        },
        {
            "id": "left",
            "name": "Outer left",
            "kind": "line",
            "start": [-length, 0],
            "end": [-length, length],
        },
        {
            "id": "top",
            "name": "Outer top",
            "kind": "line",
            "start": [-length, length],
            "end": [0, length],
        },
        {
            "id": "right",
            "name": "X symmetry",
            "kind": "line",
            "start": [0, length],
            "end": [0, radius],
        },
        {
            "id": "cavity",
            "name": "Free cavity",
            "kind": "arc",
            "start": [0, radius],
            "end": [-radius, 0],
            "center": [0, 0],
            "clockwise": False,
        },
    ]
    # Positive outer winding is part of the generic profile contract.
    outer = [
        {
            **edge,
            "start": edge["end"],
            "end": edge["start"],
            **({"clockwise": True} if edge["kind"] == "arc" else {}),
        }
        for edge in reversed(outer)
    ]
    geometry = {"kind": "profile", "profile": {"outer": outer, "holes": []}}
    study = {
        "type": "linear-static",
        "dimension": "2d",
        "formulation": "plane-stress",
        "material": {"young": 1e5, "poisson": 0.3},
        "thickness": 0.1,
        "mesh": {"size": 0.25, "boundarySize": 0.125},
        "constraints": [
            {"regions": ["bottom"], "components": [None, 0, None]},
            {"regions": ["right"], "components": [0, None, None]},
        ],
        "loads": [
            {
                "kind": "traction",
                "regions": ["left", "top"],
                "vector": [0, 0, 0],
                "pressure": 0,
                "traction": {
                    "kind": "kirsch",
                    "center": [0, 0],
                    "radius": radius,
                    "tension": tension,
                },
            }
        ],
    }
    return geometry, study


def test_known_hole_values_far_field_and_symmetry():
    young, poisson, radius, tension = 1e5, 0.3, 1.0, 0.5
    points = np.array([[radius, 0], [0, radius], [-radius, 0]])
    np.testing.assert_allclose(
        kirsch_displacement(points, young, poisson, radius, tension),
        [
            [3 * tension * radius / young, 0],
            [0, -tension * radius / young],
            [-3 * tension * radius / young, 0],
        ],
        atol=1e-20,
    )
    np.testing.assert_allclose(
        kirsch_stress(points, radius, tension),
        [[0, -tension, 0], [3 * tension, 0, 0], [0, -tension, 0]],
        atol=1e-14,
    )
    theta = np.linspace(0, 2 * np.pi, 101)
    circle = radius * np.column_stack((np.cos(theta), np.sin(theta)))
    np.testing.assert_allclose(
        kirsch_traction(circle, -circle / radius, radius, tension),
        0,
        atol=2e-15,
    )
    diagonal = np.array([[radius / np.sqrt(2), radius / np.sqrt(2)]])
    np.testing.assert_allclose(
        kirsch_stress(diagonal, radius, tension),
        [[tension / 2, tension / 2, -tension / 2]],
        atol=2e-15,
    )
    far = np.array([[1e9, 2e9]])
    np.testing.assert_allclose(kirsch_stress(far, radius, tension), [[tension, 0, 0]], atol=1e-15)
    np.testing.assert_allclose(
        kirsch_displacement(far, young, poisson, radius, tension),
        far * [tension / young, -poisson * tension / young],
        rtol=1e-14,
    )
    points = np.array([[2, 0.75], [-2, 0.75], [2, -0.75]])
    displacement = kirsch_displacement(points, young, poisson, radius, tension)
    np.testing.assert_allclose(displacement[1], displacement[0] * [-1, 1], atol=1e-20)
    np.testing.assert_allclose(displacement[2], displacement[0] * [1, -1], atol=1e-20)
    np.testing.assert_allclose(
        kirsch_displacement(points + [3, -2], young, poisson, radius, tension, [3, -2]),
        displacement,
        atol=1e-20,
    )


def test_displacement_derivatives_match_independent_plane_stress_constitutive_law():
    # Central difference of the displacement expression is independent of the
    # polar stress evaluator. Engineering shear is dux/dy + duy/dx.
    points = np.array([[1.25, 0.5], [-1.3, 1.8], [2.75, -0.7], [-3.2, 3.7]])
    young, poisson, radius, tension = 17e9, 0.27, 0.75, 1234.0
    derivative = []
    step = 1e-5
    for axis in range(2):
        offset = np.zeros(2)
        offset[axis] = step
        derivative.append(
            (
                kirsch_displacement(points + offset, young, poisson, radius, tension)
                - kirsch_displacement(points - offset, young, poisson, radius, tension)
            )
            / (2 * step)
        )
    dx, dy = derivative
    stress = np.column_stack(
        (
            young * (dx[:, 0] + poisson * dy[:, 1]) / (1 - poisson**2),
            young * (dy[:, 1] + poisson * dx[:, 0]) / (1 - poisson**2),
            young * (dy[:, 0] + dx[:, 1]) / (2 * (1 + poisson)),
        )
    )
    np.testing.assert_allclose(stress, kirsch_stress(points, radius, tension), rtol=3e-9, atol=1e-6)
    # Divergence-free stress checks equilibrium independently of displacement.
    stress_x = (
        kirsch_stress(points + [step, 0], radius, tension)
        - kirsch_stress(points - [step, 0], radius, tension)
    ) / (2 * step)
    stress_y = (
        kirsch_stress(points + [0, step], radius, tension)
        - kirsch_stress(points - [0, step], radius, tension)
    ) / (2 * step)
    np.testing.assert_allclose(stress_x[:, 0] + stress_y[:, 2], 0, atol=2e-6)
    np.testing.assert_allclose(stress_x[:, 2] + stress_y[:, 1], 0, atol=2e-6)


def test_continuum_resultants_moment_and_outward_signs():
    radius, length, tension = 1.0, 4.0, 0.5
    gp, gw = np.polynomial.legendre.leggauss(40)
    force, moment = np.zeros(2), 0.0
    outer_force = np.zeros(2)
    outer_moment = 0.0
    boundaries = [
        ([-length, 0], [-length, length], [-1, 0]),
        ([-length, length], [0, length], [0, 1]),
        ([0, radius], [0, length], [1, 0]),
        ([-length, 0], [-radius, 0], [0, -1]),
    ]
    for index, (a, b, normal) in enumerate(boundaries):
        a, b = np.array(a), np.array(b)
        points = a + (gp[:, None] + 1) * (b - a) / 2
        weights = gw * np.linalg.norm(b - a) / 2
        normals = np.tile(normal, (len(points), 1))
        traction = kirsch_traction(points, normals, radius, tension)
        np.testing.assert_allclose(
            kirsch_traction(points, -normals, radius, tension),
            -traction,
            atol=0,
        )
        integrated = np.sum(weights[:, None] * traction, axis=0)
        force += integrated
        if index < 2:
            outer_force += integrated
        edge_moment = np.sum(
            weights * (points[:, 0] * traction[:, 1] - points[:, 1] * traction[:, 0])
        )
        moment += edge_moment
        if index < 2:
            outer_moment += edge_moment
    np.testing.assert_allclose(force, 0, atol=1e-13)
    assert abs(moment) < 1e-13
    exact_outer = [
        -tension * (length - radius**2 / (2 * length) - radius**4 / (2 * length**3)),
        -tension / 2 * (radius**2 / length - radius**4 / length**3),
    ]
    np.testing.assert_allclose(outer_force, exact_outer, atol=1e-13)
    exact_moment = tension * (
        (length**2 - radius**2) / 2 + 1.5 * radius**2 * (1 - radius**2 / length**2)
    )
    np.testing.assert_allclose(outer_moment, exact_moment, atol=1e-13)


def test_quadrature_polynomial_integrals_and_zero_reference():
    # On the reference unit triangle, integral x^p y^q = p! q!/(p+q+2)!.
    for p in range(6):
        for q in range(6 - p):
            measured = 0.5 * np.sum(_WEIGHTS * _BARYCENTRIC[:, 1] ** p * _BARYCENTRIC[:, 2] ** q)
            exact = math.factorial(p) * math.factorial(q) / math.factorial(p + q + 2)
            np.testing.assert_allclose(measured, exact, rtol=2e-14, atol=1e-16)
    metric = _weighted_metric(np.zeros((2, 2)), np.array([[1, 0], [0, 2]]), np.array([0.1, 0.9]))
    assert metric == {"relativeL2": None, "maxAbsolute": 2.0, "referenceNorm": 0.0}


@pytest.mark.parametrize(
    "mutation",
    [
        lambda g, s: s["loads"][0]["traction"].update(radius=0.9),
        lambda g, s: s["loads"][0].update(regions=["left"]),
        lambda g, s: s["loads"][0].update(kind="force"),
        lambda g, s: s["constraints"][0].update(components=[0, 0, None]),
        lambda g, s: s["loads"].append({"kind": "pressure", "regions": ["cavity"], "pressure": 1}),
        lambda g, s: next(e for e in g["profile"]["outer"] if e["kind"] == "arc").update(
            clockwise=False
        ),
        lambda g, s: g["profile"]["outer"][1].update(end=[-4, 3.5]),
    ],
)
def test_reference_eligibility_rejects_changed_physics_or_domain(mutation):
    geometry, study = quarter_case()
    assert eligible_reference(geometry, study) is not None
    geometry, study = copy.deepcopy(geometry), copy.deepcopy(study)
    mutation(geometry, study)
    assert eligible_reference(geometry, study) is None


@pytest.mark.parametrize(
    "points,radius,tension",
    [
        ([[0, 0]], 1, 0.5),
        ([[np.nan, 1]], 1, 0.5),
        ([[1, 1, 1]], 1, 0.5),
        ([[1, 1]], 0, 0.5),
        ([[1, 1]], 1, np.inf),
        ([[1e-300, 0]], 1e300, 0.5),
    ],
)
def test_undefined_invalid_or_overflowed_reference_fails(points, radius, tension):
    with pytest.raises(EngineError):
        kirsch_stress(np.array(points), radius, tension)


def test_invalid_normal_material_and_zero_tension():
    with pytest.raises(EngineError):
        kirsch_traction(np.array([[2, 1]]), np.array([[2, 0]]), 1, 0.5)
    with pytest.raises(EngineError):
        kirsch_displacement(np.array([[2, 1]]), 0, 0.3, 1, 0.5)
    points = np.array([[2, 1]])
    np.testing.assert_array_equal(kirsch_stress(points, 1, 0), 0)
    np.testing.assert_array_equal(kirsch_displacement(points, 1e5, 0.3, 1, 0), 0)


@pytest.mark.slow
@pytest.mark.parametrize("radius,tension", [(1.0, 0.5), (0.75, 0.25)])
def test_kirsch_profile_mesh_refinement_and_changed_parameters(radius, tension):
    from phyra_engine.meshing.profile import generate_profile
    from phyra_engine.methods.classical.plane_stress import solve_mesh
    from phyra_engine.physics.elasticity.plane_stress import integrate_edge_loads

    geometry, study = quarter_case(radius, tension)
    measured = []
    for size in (0.5, 0.25, 0.125):
        study["mesh"] = {"size": size, "boundarySize": size / 2}
        mesh = generate_profile(geometry["profile"], study["thickness"], size, size / 2)
        result = solve_mesh(mesh, study)
        reference = reference_diagnostics(mesh, study, result, geometry)
        assert reference is not None
        force = integrate_edge_loads(mesh, study["loads"])
        closure = force + result["reactions"][:, :2]
        scale = np.linalg.norm(force, axis=1).sum()
        np.testing.assert_allclose(closure.sum(axis=0), 0, atol=scale * 1e-9)
        moment = np.sum(mesh.positions[:, 0] * closure[:, 1] - mesh.positions[:, 1] * closure[:, 0])
        assert abs(moment) < scale * 4 * 1e-9
        assert result["summary"]["relativeResidual"] < 1e-9
        for region, component in (("bottom", 1), ("right", 0)):
            nodes = np.unique(mesh.edges[mesh.edge_regions == mesh.regions.index(region)])
            np.testing.assert_array_equal(result["displacement"][nodes, component], 0)
        length = 4.0
        outer = (
            np.array(
                [
                    -tension * (length - radius**2 / (2 * length) - radius**4 / (2 * length**3)),
                    -tension / 2 * (radius**2 / length - radius**4 / length**3),
                ]
            )
            * mesh.thickness
        )
        np.testing.assert_allclose(force.sum(axis=0), outer, rtol=1e-9, atol=1e-12)
        row = {
            "size": size,
            "cells": len(mesh.cells),
            "dofs": 2 * len(mesh.positions),
            "displacement": reference["displacement"]["relativeL2"],
            "stress": reference["stress"]["relativeL2"],
            "holeTraction": reference["holeTraction"]["relativeRms"],
            "forceResidual": float(np.linalg.norm(closure.sum(axis=0))),
            "momentResidual": float(moment),
        }
        measured.append(row)
        print(f"Kirsch R={radius} T={tension}: {row}")
    first, last = measured[0], measured[-1]
    assert last["displacement"] < 0.015 and last["displacement"] < first["displacement"] * 0.55
    assert last["stress"] < 0.12 and last["stress"] < first["stress"] * 0.7
    assert last["holeTraction"] < 0.35 and last["holeTraction"] < first["holeTraction"] * 0.8


def test_reference_cache_recomputes_metrics_and_rejects_forgery(tmp_path):
    from phyra_engine.meshing.profile import generate_profile
    from phyra_engine.methods.classical.plane_stress import solve_mesh
    from phyra_engine.results.plane_stress import validate_cached, write_output

    root = Path(__file__).resolve().parents[2]
    project = json.loads((root / "examples/kirsch-quarter.json").read_text())
    project["study"]["mesh"] = {"size": 0.5, "boundarySize": 0.25}
    mesh = generate_profile(
        project["geometry"]["profile"], project["study"]["thickness"], 0.5, 0.25
    )
    result = solve_mesh(mesh, project["study"])
    manifest = write_output(tmp_path, project, "kirsch-cache", "solve", mesh, result)
    blob = (tmp_path / "buffer.bin").read_bytes()
    assert validate_cached(project, manifest, blob) == manifest
    assert manifest["reference"]["kind"] == "kirsch-plane-stress"
    for mutation in (
        lambda m: m["reference"]["stress"].update(relativeL2=0.0),
        lambda m: m.pop("reference"),
        lambda m: m["reference"]["parameters"].update(radius=0.75),
    ):
        corrupted = copy.deepcopy(manifest)
        mutation(corrupted)
        with pytest.raises(EngineError, match="reference metrics disagree"):
            validate_cached(project, corrupted, blob)


def test_weighted_metric_is_stable_across_buffer_alignment():
    rng = np.random.default_rng(732)
    reference = rng.normal(size=(200, 3)) * np.array([1e-5, 1, 1e5])
    prediction = reference + rng.normal(size=(200, 3)) * np.array([1e-7, 1e-2, 1e3])
    weights = rng.uniform(0.001, 1, size=200)
    expected = _weighted_metric(reference, prediction, weights)
    for padding in (0, 8, 40, 104):
        blob = (
            bytes(padding) + reference.astype("<f8").tobytes() + prediction.astype("<f8").tobytes()
        )
        restored_reference = np.frombuffer(
            blob, dtype="<f8", count=reference.size, offset=padding
        ).reshape(reference.shape)
        restored_prediction = np.frombuffer(
            blob, dtype="<f8", count=prediction.size, offset=padding + reference.nbytes
        ).reshape(prediction.shape)
        assert _weighted_metric(restored_reference, restored_prediction, weights) == expected


@pytest.mark.parametrize("scale", [1e-200, 1e200])
def test_weighted_reference_norm_avoids_intermediate_underflow_and_overflow(scale):
    reference = np.array([[3 * scale, 4 * scale], [0, 0]])
    prediction = reference * 1.2
    metric = _weighted_metric(reference, prediction, np.array([1.0, 1.0]))
    np.testing.assert_allclose(metric["referenceNorm"], 5 * scale, rtol=1e-14, atol=0)
    np.testing.assert_allclose(metric["relativeL2"], 0.2, rtol=1e-14, atol=0)
