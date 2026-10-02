"""Exact profile topology, owned boundaries and library traction/assembly checks."""

import hashlib
import json
from copy import deepcopy
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.geometry.profile import profile_area, validate_profile
from phyra_engine.meshing.plane_stress import cell_areas, edge_geometry, generate_rectangle
from phyra_engine.meshing.profile import generate_profile, validate_profile_mesh
from phyra_engine.methods.classical.plane_stress import assemble, element_matrices, solve_system
from phyra_engine.physics.elasticity.plane_stress import integrate_edge_loads, validate_traction


def circle_plate(radius=0.4):
    vertices = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    return {
        "outer": [
            {
                "id": name,
                "name": name,
                "kind": "line",
                "start": vertices[index],
                "end": vertices[(index + 1) % 4],
            }
            for index, name in enumerate(["bottom", "right", "top", "left"])
        ],
        "holes": [{"id": "cavity", "name": "Circular cavity", "center": [0, 0], "radius": radius}],
    }


def quarter_profile(radius=1, length=4):
    vertices = [[0, radius], [0, length], [-length, length], [-length, 0], [-radius, 0]]
    edges = [
        {
            "id": name,
            "name": name,
            "kind": "line",
            "start": vertices[index],
            "end": vertices[index + 1],
        }
        for index, name in enumerate(["x0", "y1", "x1", "y0"])
    ]
    edges.append(
        {
            "id": "hole",
            "name": "Traction-free cavity",
            "kind": "arc",
            "start": vertices[-1],
            "end": vertices[0],
            "center": [0, 0],
            "clockwise": True,
        }
    )
    return {"outer": edges, "holes": []}


def test_exact_minor_arc_and_hole_area():
    validate_profile(quarter_profile())
    np.testing.assert_allclose(profile_area(quarter_profile()), 16 - np.pi / 4, rtol=1e-15)
    validate_profile(circle_plate())
    np.testing.assert_allclose(profile_area(circle_plate()), 4 - np.pi * 0.4**2, rtol=1e-15)


@pytest.mark.parametrize("size", [0.35, 0.2])
def test_occ_hole_curves_normals_and_owned_boundaries_survive_remeshing(size):
    profile = circle_plate()
    mesh = generate_profile(profile, 0.05, size, size / 2)
    assert mesh.regions == ("bottom", "right", "top", "left", "cavity")
    assert len(np.unique(mesh.cells)) == len(mesh.positions)  # No OCC construction center DOF.
    validate_profile_mesh(mesh, profile)
    hole = mesh.edges[mesh.edge_regions == 4]
    np.testing.assert_allclose(
        np.linalg.norm(mesh.positions[np.unique(hole), :2], axis=1), 0.4, atol=1e-12
    )
    _, normals = edge_geometry(mesh)
    midpoint = mesh.positions[hole, :2].mean(axis=1)
    assert np.all(np.sum(midpoint * normals[mesh.edge_regions == 4], axis=1) < 0)
    assert 0 < cell_areas(mesh).sum() - profile_area(profile) < 0.005
    with pytest.raises(EngineError, match="line|circle|arc"):
        validate_profile_mesh(
            replace(mesh, edge_regions=(mesh.edge_regions + 1) % len(mesh.regions)), profile
        )


def test_occ_two_semicircles_are_one_exact_outer_circle():
    profile = {
        "outer": [
            {
                "id": "upper",
                "name": "Upper arc",
                "kind": "arc",
                "start": [1, 0],
                "end": [-1, 0],
                "center": [0, 0],
            },
            {
                "id": "lower",
                "name": "Lower arc",
                "kind": "arc",
                "start": [-1, 0],
                "end": [1, 0],
                "center": [0, 0],
            },
        ],
        "holes": [],
    }
    validate_profile(profile)
    mesh = generate_profile(profile, 0.05, 0.15)
    validate_profile_mesh(mesh, profile)
    np.testing.assert_allclose(
        np.linalg.norm(mesh.positions[np.unique(mesh.edges), :2], axis=1), 1, atol=1e-12
    )


@pytest.mark.parametrize(
    "mutation,message",
    [
        (lambda p: p["outer"][0].update(end=[0.8, -1]), "close|meet|match"),
        (lambda p: p["holes"][0].update(center=[0.9, 0]), "strictly inside"),
        (
            lambda p: p["holes"].append(
                {"id": "overlap", "name": "Overlap", "center": [0.5, 0], "radius": 0.3}
            ),
            "overlap",
        ),
        (lambda p: p["outer"][1].update(id="bottom"), "unique"),
        (lambda p: p["holes"][0].update(radius=0), "positive"),
    ],
)
def test_actionable_invalid_geometry(mutation, message):
    profile = circle_plate()
    mutation(profile)
    with pytest.raises(EngineError, match=message):
        validate_profile(profile)


def test_crossing_lines_arc_intersections_major_arcs_and_clockwise_rejected():
    crossing = circle_plate()
    vertices = [[-1, -1], [1, 1], [-1, 1], [1, -1]]
    for index, edge in enumerate(crossing["outer"]):
        edge.update(start=vertices[index], end=vertices[(index + 1) % 4])
    with pytest.raises(EngineError, match="counterclockwise|intersect|positive"):
        validate_profile(crossing)
    arc = quarter_profile()
    arc["outer"][-1]["center"] = [0.2, 0]
    with pytest.raises(EngineError, match="circle"):
        validate_profile(arc)
    major = quarter_profile()
    major["outer"][-1]["clockwise"] = False
    with pytest.raises(EngineError, match="180"):
        validate_profile(major)
    clockwise = circle_plate()
    clockwise["outer"] = [
        {**edge, "start": edge["end"], "end": edge["start"]} for edge in clockwise["outer"][::-1]
    ]
    with pytest.raises(EngineError, match="counterclockwise"):
        validate_profile(clockwise)


def test_profile_resource_preflight_before_gmsh():
    with pytest.raises(EngineError) as error:
        generate_profile(circle_plate(), 0.05, 1e-300)
    assert error.value.code == "resource-limit"


def test_affine_stress_traction_resultant_moment_and_outward_sign():
    mesh = generate_rectangle(2, 1, 0.1, 0.17)
    # sigma_xx=2+3x+4y Pa; sigma_xy=5+6x+7y Pa. Right side x=2.
    traction = {"kind": "affine", "xx": [2, 3, 4], "yy": [8, 9, 10], "xy": [5, 6, 7]}
    force = integrate_edge_loads(
        mesh, [{"kind": "traction", "regions": ["x1"], "traction": traction}]
    )
    np.testing.assert_allclose(force.sum(axis=0), 0.1 * np.array([10, 20.5]), atol=1e-14)
    moment = np.sum(mesh.positions[:, 0] * force[:, 1] - mesh.positions[:, 1] * force[:, 0])
    # integral_0^1 (2*(17+7y)-y*(8+4y)) dy * thickness.
    np.testing.assert_allclose(moment, 0.1 * (34 + 7 - 4 - 4 / 3), atol=1e-14)
    closed = integrate_edge_loads(
        mesh, [{"kind": "traction", "regions": list(mesh.regions), "traction": traction}]
    )
    # Divergence theorem: div(sigma)=[3+7,6+10] Pa/m over area 2 m².
    np.testing.assert_allclose(closed.sum(axis=0), 0.1 * 2 * np.array([10, 16]), atol=1e-14)
    constant = {**traction, "xx": [13, 0, 0], "yy": [7, 0, 0], "xy": [3, 0, 0]}
    zero = integrate_edge_loads(
        mesh, [{"kind": "traction", "regions": list(mesh.regions), "traction": constant}]
    )
    np.testing.assert_allclose(zero.sum(axis=0), 0, atol=1e-14)
    np.testing.assert_allclose(
        np.sum(mesh.positions[:, 0] * zero[:, 1] - mesh.positions[:, 1] * zero[:, 0]), 0, atol=1e-14
    )


@pytest.mark.parametrize(
    "invalid",
    [
        {"kind": "expression", "source": '__import__("os")'},
        {"kind": "affine", "xx": [1, 2], "yy": [0, 0, 0], "xy": [0, 0, 0]},
        {"kind": "affine", "xx": [float("inf"), 0, 0], "yy": [0, 0, 0], "xy": [0, 0, 0]},
        {"kind": "kirsch", "center": [0, 0], "radius": -1, "tension": 1},
    ],
)
def test_safe_typed_traction_rejects_unsupported_or_nonfinite_inputs(invalid):
    with pytest.raises(EngineError):
        validate_traction(invalid)


def test_library_assembly_matches_independent_cst_oracle_and_patch_on_hole():
    mesh = generate_profile(circle_plate(), 0.05, 0.25)
    young, poisson = 2e6, 0.27
    _, _, local = element_matrices(mesh, young, poisson)
    rng = np.random.default_rng(521)
    trial = rng.normal(size=(len(mesh.positions), 2))
    cell_trial = trial[mesh.cells].reshape(-1, 6)
    independent_energy = np.einsum("ci,cij,cj->", cell_trial, local, cell_trial)
    np.testing.assert_allclose(
        trial.ravel() @ assemble(mesh, young, poisson) @ trial.ravel(),
        independent_energy,
        rtol=1e-14,
    )
    gradient = np.array([[0.002, 0.0004], [-0.0007, -0.0003]])
    exact = mesh.positions[:, :2] @ gradient.T + [0.0002, -0.0005]
    fixed = {
        2 * int(node) + axis: exact[node, axis]
        for node in np.unique(mesh.edges)
        for axis in range(2)
    }
    result = solve_system(mesh, young, poisson, np.zeros_like(exact), fixed)
    np.testing.assert_allclose(result["displacement"][:, :2], exact, rtol=2e-11, atol=2e-14)


@pytest.fixture
def profile_project():
    root = Path(__file__).resolve().parents[2]
    return json.loads((root / "examples/kirsch-quarter.json").read_text())


@pytest.fixture
def profile_result(profile_project, tmp_path):
    from phyra_engine.methods.classical.plane_stress import solve_mesh
    from phyra_engine.results.plane_stress import write_output
    from phyra_engine.studies.mesh import generate_study_mesh

    mesh = generate_study_mesh(profile_project)
    result = solve_mesh(mesh, profile_project["study"])
    manifest = write_output(tmp_path, profile_project, "profile-cache", "solve", mesh, result)
    return manifest, (tmp_path / "buffer.bin").read_bytes()


def test_profile_reference_cache_roundtrip(profile_project, profile_result):
    from phyra_engine.results import validate_cached

    manifest, blob = profile_result
    assert manifest["reference"]["kind"] == "kirsch-plane-stress"
    assert manifest["versions"]["scikit-fem"] == "12.0.2"
    assert validate_cached(profile_project, manifest, blob) == manifest


@pytest.mark.parametrize(
    "defect", ["reference", "boolean", "regions", "stress", "material", "backend"]
)
def test_profile_cache_rejects_forged_physics_and_reference(
    profile_project, profile_result, defect
):
    from phyra_engine.results import validate_cached
    from phyra_engine.results.fields import von_mises

    manifest, blob = profile_result
    manifest = deepcopy(manifest)
    if defect == "reference":
        manifest["reference"]["displacement"]["relativeL2"] = 0
    elif defect == "boolean":
        manifest["reference"]["parameters"]["center"][0] = False
    elif defect == "regions":
        manifest["regions"][0]["name"] = "Silently moved support"
    elif defect == "backend":
        manifest["versions"]["scikit-fem"] = False
    elif defect == "material":
        profile_project["study"]["material"]["young"] *= 2
    else:
        altered = bytearray(blob)
        descriptor = manifest["arrays"]["stress"]
        values = np.frombuffer(
            altered, dtype="<f8", offset=descriptor["offset"], count=np.prod(descriptor["shape"])
        ).reshape(descriptor["shape"])
        values[0, 0] *= 2
        descriptor = manifest["arrays"]["vonMises"]
        np.frombuffer(
            altered, dtype="<f8", offset=descriptor["offset"], count=descriptor["shape"][0]
        )[:] = von_mises(values[:, [0, 1, 3]])
        blob = bytes(altered)
        manifest["bufferHash"] = hashlib.sha256(blob).hexdigest()
    with pytest.raises(EngineError):
        validate_cached(profile_project, manifest, blob)


def test_profile_unsupported_training_and_solid_traction_are_explicit(profile_project):
    from phyra_engine.execution.registry import methods_for_operation
    from phyra_engine.studies.project import validate_project

    for operation in ("train", "compare"):
        with pytest.raises(EngineError) as error:
            methods_for_operation(profile_project, operation)
        assert error.value.code == "unsupported-study"
    profile_project["study"]["solver"]["kind"] = "pinn"
    with pytest.raises(EngineError, match="FEM"):
        validate_project(profile_project)


def test_v2_definition_is_validated_before_migration_and_preserved():
    from phyra_engine.studies.project import migrate_project

    root = Path(__file__).resolve().parents[2]
    original = json.loads((root / "examples/plane-stress-tension.json").read_text())
    original["schemaVersion"] = 2
    original.pop("namedSelections")
    retained = deepcopy(original)
    upgraded = migrate_project(original)
    assert original == retained and upgraded["schemaVersion"] == 4
    assert upgraded["study"] == original["study"]
    original["study"]["mesh"]["boundarySize"] = 0.001
    with pytest.raises(EngineError, match="boundarySize"):
        migrate_project(original)
