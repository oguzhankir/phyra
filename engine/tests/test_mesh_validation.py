"""Mesh topology, curved-domain geometry and invalid-project checks."""

from copy import deepcopy
from dataclasses import replace

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.fem import constraint_dofs, integrate_surface_loads, solve_mesh
from phyra_engine.mesh import generate_mesh, tetra_volumes, validate_mesh
from phyra_engine.validation import fingerprint, validate_project


@pytest.mark.parametrize("kind", ["box", "cylinder", "bracket"])
def test_actual_primitive_meshing_and_solve(project, kind):
    project["geometry"]["kind"] = kind
    mesh = generate_mesh(project)
    validate_mesh(mesh)
    geometry = project["geometry"]
    volume = tetra_volumes(mesh.positions, mesh.cells).sum()
    if kind == "box":
        reference = geometry["length"] * geometry["width"] * geometry["height"]
        np.testing.assert_allclose(volume, reference, rtol=2e-12)
        assert set(mesh.regions) == {"x0", "x1", "y0", "y1", "z0", "z1"}
    elif kind == "bracket":
        reference = (
            geometry["thickness"]
            * (geometry["length"] + geometry["width"] - geometry["thickness"])
            * geometry["height"]
        )
        np.testing.assert_allclose(volume, reference, rtol=2e-12)
        assert set(mesh.regions) == {"x0", "x1", "y0", "y1", "z0", "z1", "inner-x", "inner-y"}
    else:
        reference = np.pi * geometry["radius"] ** 2 * geometry["length"]
        # Linear triangles approximate the curved wall. Twelve points per full
        # circumference imply <=4.51% inscribed polygon area loss; use 5%.
        assert 0 < (reference - volume) / reference < 0.05
        assert set(mesh.regions) == {"x0", "x1", "outer"}
    result = solve_mesh(mesh, project["study"])
    assert result["summary"]["maxDisplacement"] > 0
    np.testing.assert_allclose(result["summary"]["totalReaction"], [0, 0, 1], atol=2e-9)
    assert result["summary"]["relativeResidual"] < 1e-8
    assert result["summary"]["relativeMomentBalance"] < 1e-8


@pytest.mark.parametrize(
    "defect", ["nan", "index", "inverted", "surface", "owner", "region", "duplicate"]
)
def test_invalid_meshes_are_rejected(cube, defect):
    positions, cells, surface = cube.positions.copy(), cube.cells.copy(), cube.surface.copy()
    owners, regions = cube.surface_cells.copy(), cube.surface_regions.copy()
    if defect == "nan":
        positions[0, 0] = np.nan
    elif defect == "index":
        cells[0, 0] = len(positions)
    elif defect == "inverted":
        cells[0, [1, 2]] = cells[0, [2, 1]]
    elif defect == "surface":
        surface[0, [1, 2]] = surface[0, [2, 1]]
    elif defect == "owner":
        owners[0] = (owners[0] + 1) % len(cells)
    elif defect == "region":
        regions[0] = len(cube.regions)
    else:
        cells[1] = cells[0]
    invalid = replace(
        cube,
        positions=positions,
        cells=cells,
        surface=surface,
        surface_cells=owners,
        surface_regions=regions,
    )
    with pytest.raises(EngineError):
        validate_mesh(invalid)


@pytest.mark.parametrize(
    "defect", ["version", "nonfinite", "material", "unknown-key", "region", "limit"]
)
def test_invalid_projects_are_rejected(project, defect):
    if defect == "version":
        project["schemaVersion"] = 2
    elif defect == "nonfinite":
        project["geometry"]["length"] = np.inf
    elif defect == "material":
        project["study"]["material"]["poisson"] = 0.499
    elif defect == "unknown-key":
        project["command"] = "unsupported"
    elif defect == "region":
        project["study"]["loads"][0]["regions"] = ["outer"]
    else:
        project["study"]["mesh"]["size"] = 1e-7
    with pytest.raises(EngineError):
        validate_project(project)


def test_display_units_and_names_preserve_physical_fingerprint(project):
    original = fingerprint(project)
    other = deepcopy(project)
    other.update(displayUnits="m", revision=42, name="Presentation only")
    assert fingerprint(other) == original
    other["study"]["loads"][0]["vector"][2] *= 2
    assert fingerprint(other) != original
    other = deepcopy(project)
    other["id"] = "another-project"
    assert fingerprint(other) != original


def test_component_constraints_free_values_and_conflict(cube):
    support = {"id": "support", "name": "Support", "regions": ["x0"], "components": [1e-5, None, 0]}
    prescribed = constraint_dofs(cube, [support])
    assert all(dof % 3 != 1 for dof in prescribed)
    assert {value for dof, value in prescribed.items() if dof % 3 == 0} == {1e-5}
    conflict = deepcopy(support)
    conflict["id"] = "conflict"
    conflict["components"][0] = 2e-5
    with pytest.raises(EngineError) as error:
        constraint_dofs(cube, [support, conflict])
    assert error.value.code == "conflicting-constraints"


def test_invalid_load_selection_is_rejected(cube):
    for regions in (["absent"], [], ["x1", "x1"]):
        with pytest.raises(EngineError):
            integrate_surface_loads(
                cube, [{"kind": "force", "regions": regions, "vector": [1, 0, 0]}]
            )


def test_small_conflicting_prescriptions_are_not_rounded_to_geometry_scale(cube):
    supports = [
        {"regions": ["x0"], "components": [0, None, None]},
        {"regions": ["x0"], "components": [1e-16, None, None]},
    ]
    with pytest.raises(EngineError) as error:
        constraint_dofs(cube, supports)
    assert error.value.code == "conflicting-constraints"
