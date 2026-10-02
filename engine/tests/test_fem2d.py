"""Independent plane-stress references, with no dependency on desktop imports.

The affine patch uses a full continuum displacement gradient; the axial case
uses σxx=F/(tW), εxx=σxx/E and εyy=-νσxx/E. The bending convergence case uses
ux=kxy/E, uy=-k(x²+νy²)/(2E), σxx=ky, σyy=σxy=0: its divergence is exactly zero.
Only boundary tractions and explicit displacement data enter the FEM solve.
"""

from collections import defaultdict
from dataclasses import replace

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.meshing.plane_stress import (
    cell_areas,
    edge_geometry,
    generate_rectangle,
    quality,
    validate_mesh,
)
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.classical.plane_stress import (
    assemble,
    element_matrices,
    solve_mesh,
    solve_system,
)
from phyra_engine.physics.elasticity.plane_stress import constraint_dofs, integrate_edge_loads


def rectangle(length=0.4, width=0.1, thickness=0.02, nx=4, ny=2):
    """Independent triangulation, alternating diagonals across grid squares."""
    positions = np.array(
        [[x, y, 0] for y in np.linspace(0, width, ny + 1) for x in np.linspace(0, length, nx + 1)]
    )
    cells = []
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            b, c, d = a + 1, a + nx + 2, a + nx + 1
            cells.extend(((a, b, d), (b, c, d)) if (i + j) % 2 else ((a, b, c), (a, c, d)))
    cells = np.array(cells, dtype=np.uint32)
    owners = defaultdict(list)
    for ci, cell in enumerate(cells):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            owners[tuple(sorted((int(cell[a]), int(cell[b]))))].append(ci)
    edges, regions = [], []
    for edge, values in owners.items():
        if len(values) != 1:
            continue
        a, b = edge
        p = positions[[a, b], :2]
        n = np.array([p[1, 1] - p[0, 1], p[0, 0] - p[1, 0]])
        center = positions[cells[values[0]], :2].mean(axis=0)
        if n @ (center - p.mean(axis=0)) > 0:
            a, b = b, a
        ri = next(
            ri
            for ri, (axis, value) in enumerate(((0, 0), (0, length), (1, 0), (1, width)))
            if np.all(p[:, axis] == value)
        )
        edges.append((a, b))
        regions.append(ri)
    return Mesh2D(
        positions,
        cells,
        np.array(edges, dtype=np.uint32),
        np.array(regions, dtype=np.uint32),
        ("x0", "x1", "y0", "y1"),
        thickness,
    )


def axial_study(force=120.0, young=17e9, poisson=0.27):
    return {
        "material": {"young": young, "poisson": poisson},
        "constraints": [
            {"regions": ["x0"], "components": [0, None, None]},
            {"regions": ["y0"], "components": [None, 0, None]},
        ],
        "loads": [{"kind": "force", "regions": ["x1"], "vector": [force, 0, 0]}],
    }


def balance(mesh, force, reactions, scale):
    np.testing.assert_allclose((force + reactions[:, :2]).sum(axis=0), 0, atol=scale * 2e-9)
    closure = force + reactions[:, :2]
    moment = np.sum(mesh.positions[:, 0] * closure[:, 1] - mesh.positions[:, 1] * closure[:, 0])
    assert abs(moment) < scale * np.linalg.norm(np.ptp(mesh.positions, axis=0)) * 2e-9


def test_triangle_geometry_boundary_and_stiffness():
    mesh = rectangle()
    validate_mesh(mesh)
    np.testing.assert_allclose(cell_areas(mesh).sum(), 0.04, rtol=1e-14)
    assert np.all((quality(mesh) > 0) & (quality(mesh) <= 1))
    lengths, normals = edge_geometry(mesh)
    expected = ((-1, 0), (1, 0), (0, -1), (0, 1))
    for ri, normal in enumerate(expected):
        selected = mesh.edge_regions == ri
        np.testing.assert_allclose(normals[selected], np.tile(normal, (selected.sum(), 1)))
        np.testing.assert_allclose(lengths[selected].sum(), 0.1 if ri < 2 else 0.4)
    _, _, matrices = element_matrices(mesh, 17e9, 0.27)
    np.testing.assert_allclose(matrices, matrices.transpose(0, 2, 1), atol=2e-7, rtol=1e-14)
    stiffness = assemble(mesh, 17e9, 0.27)
    for rigid in ([1, 0], [0, 1]):
        np.testing.assert_allclose(stiffness @ np.tile(rigid, len(mesh.positions)), 0, atol=1e-6)
    rotation = np.column_stack((-mesh.positions[:, 1], mesh.positions[:, 0]))
    np.testing.assert_allclose(stiffness @ rotation.ravel(), 0, atol=1e-6)


def test_affine_patch_nonzero_values_and_independent_energy():
    mesh = rectangle(nx=6, ny=4)
    young, poisson = 17e9, 0.27
    gradient = np.array([[0.002, 0.0007], [0.0004, -0.0003]])
    exact = mesh.positions[:, :2] @ gradient.T + [0.003, -0.001]
    boundary = np.unique(mesh.edges)
    prescribed = {2 * int(node) + axis: exact[node, axis] for node in boundary for axis in range(2)}
    result = solve_system(mesh, young, poisson, np.zeros_like(exact), prescribed)
    np.testing.assert_allclose(result["displacement"][:, :2], exact, rtol=2e-11, atol=2e-14)
    strain = (gradient + gradient.T) / 2
    stress = np.array(
        [
            young * (strain[0, 0] + poisson * strain[1, 1]) / (1 - poisson**2),
            young * (strain[1, 1] + poisson * strain[0, 0]) / (1 - poisson**2),
            young * strain[0, 1] / (1 + poisson),
        ]
    )
    np.testing.assert_allclose(
        result["stress"][:, [0, 1, 3]], np.tile(stress, (len(mesh.cells), 1)), rtol=2e-11
    )
    np.testing.assert_array_equal(result["stress"][:, [2, 4, 5]], 0)
    energy = (
        0.5
        * (strain[0, 0] * stress[0] + strain[1, 1] * stress[1] + 2 * strain[0, 1] * stress[2])
        * 0.4
        * 0.1
        * mesh.thickness
    )
    np.testing.assert_allclose(result["summary"]["strainEnergy"], energy, rtol=2e-11)
    balance(
        mesh, np.zeros_like(exact), result["reactions"], np.linalg.norm(stress) * mesh.thickness
    )


@pytest.mark.parametrize("thickness", [0.02, 0.007])
def test_axial_extension_and_poisson_contraction(thickness):
    mesh = rectangle(thickness=thickness, nx=8, ny=4)
    study = axial_study()
    result = solve_mesh(mesh, study)
    stress = 120 / (thickness * 0.1)
    strain = stress / 17e9
    exact = mesh.positions[:, :2] * [strain, -0.27 * strain]
    np.testing.assert_allclose(result["displacement"][:, :2], exact, rtol=2e-10, atol=2e-18)
    np.testing.assert_allclose(result["stress"][:, 0], stress, rtol=2e-10)
    np.testing.assert_allclose(result["stress"][:, 1:], 0, atol=stress * 2e-10)
    np.testing.assert_allclose(result["vonMises"], stress, rtol=2e-10)
    np.testing.assert_allclose(
        result["summary"]["strainEnergy"], 120**2 * 0.4 / (2 * 17e9 * 0.1 * thickness), rtol=2e-10
    )
    balance(mesh, integrate_edge_loads(mesh, study["loads"]), result["reactions"], 120)


def test_multiedge_total_force_and_inward_pressure_moment():
    mesh = rectangle()
    vector = [71, -32]
    force = integrate_edge_loads(
        mesh, [{"kind": "force", "regions": ["x1", "y1"], "vector": vector}]
    )
    np.testing.assert_allclose(force.sum(axis=0), vector, atol=1e-13)
    centroid = (0.1 * np.array([0.4, 0.05]) + 0.4 * np.array([0.2, 0.1])) / 0.5
    moment = np.sum(mesh.positions[:, 0] * force[:, 1] - mesh.positions[:, 1] * force[:, 0])
    np.testing.assert_allclose(
        moment, centroid[0] * vector[1] - centroid[1] * vector[0], atol=1e-13
    )
    pressure = integrate_edge_loads(
        mesh, [{"kind": "pressure", "regions": ["x1"], "pressure": 700}]
    )
    np.testing.assert_allclose(pressure.sum(axis=0), [-700 * 0.1 * 0.02, 0], atol=1e-13)
    closed = integrate_edge_loads(
        mesh, [{"kind": "pressure", "regions": list(mesh.regions), "pressure": 700}]
    )
    np.testing.assert_allclose(closed.sum(axis=0), 0, atol=1e-13)
    np.testing.assert_allclose(
        np.sum(mesh.positions[:, 0] * closed[:, 1] - mesh.positions[:, 1] * closed[:, 0]),
        0,
        atol=1e-13,
    )


def test_rigid_translation_and_geometric_scale():
    mesh = rectangle()
    constraints = [{"regions": ["x0"], "components": [2e-10, -7e-10, None]}]
    force = np.zeros((len(mesh.positions), 2))
    result = solve_system(mesh, 17e9, 0.27, force, constraint_dofs(mesh, constraints))
    np.testing.assert_allclose(
        result["displacement"][:, :2],
        np.tile([2e-10, -7e-10], (len(mesh.positions), 1)),
        atol=2e-23,
    )
    reference = solve_mesh(mesh, axial_study())
    scale = 1e-4
    scaled = replace(mesh, positions=mesh.positions * scale, thickness=mesh.thickness * scale)
    answer = solve_mesh(scaled, axial_study(force=120 * scale**2))
    np.testing.assert_allclose(
        answer["displacement"], reference["displacement"] * scale, rtol=2e-10, atol=1e-23
    )
    np.testing.assert_allclose(answer["stress"], reference["stress"], atol=1e-5)


@pytest.mark.slow
def test_manufactured_bending_mesh_convergence():
    young, poisson, coefficient = 17e9, 0.27, 5e6
    errors = []
    for subdivisions in [2, 4, 8, 16]:
        mesh = rectangle(length=0.2, width=0.1, nx=2 * subdivisions, ny=subdivisions)
        x, y = mesh.positions[:, :2].T
        exact = np.column_stack(
            (coefficient * x * y / young, -coefficient * (x * x + poisson * y * y) / (2 * young))
        )
        left = np.flatnonzero(x == 0)
        prescribed = {2 * int(node) + axis: exact[node, axis] for node in left for axis in range(2)}
        force = np.zeros_like(exact)
        for a, b in mesh.edges[mesh.edge_regions == 1]:
            ya, yb = y[a], y[b]
            length = abs(yb - ya)
            force[a, 0] += mesh.thickness * coefficient * length * (2 * ya + yb) / 6
            force[b, 0] += mesh.thickness * coefficient * length * (ya + 2 * yb) / 6
        result = solve_system(mesh, young, poisson, force, prescribed)
        error = np.linalg.norm(result["displacement"][:, :2] - exact) / np.linalg.norm(exact)
        errors.append(error)
        balance(mesh, force, result["reactions"], np.linalg.norm(force, axis=1).sum())
    assert all(b < 0.55 * a for a, b in zip(errors, errors[1:], strict=False)), errors
    assert errors[-1] < 0.01, errors


@pytest.mark.parametrize(
    "mutation,code",
    [
        (lambda m: replace(m, cells=m.cells[:, [0, 2, 1]]), "degenerate-mesh"),
        (lambda m: replace(m, edges=m.edges[:, ::-1]), "invalid-mesh"),
        (lambda m: replace(m, cells=np.concatenate((m.cells, m.cells[:1]))), "invalid-mesh"),
        (lambda m: replace(m, thickness=0), "invalid-thickness"),
        (lambda m: replace(m, positions=m.positions + [0, 0, 1]), "invalid-mesh"),
    ],
)
def test_invalid_mesh_failures(mutation, code):
    with pytest.raises(EngineError) as error:
        validate_mesh(mutation(rectangle()))
    assert error.value.code == code


def test_invalid_supports_material_loads_and_resource_limit():
    mesh = rectangle()
    with pytest.raises(EngineError, match="rigid"):
        solve_system(mesh, 17e9, 0.27, np.zeros((len(mesh.positions), 2)), {0: 0})
    with pytest.raises(EngineError, match="incompatible"):
        constraint_dofs(
            mesh,
            [
                {"regions": ["x0"], "components": [0, None]},
                {"regions": ["y0"], "components": [1e-20, None]},
            ],
        )
    with pytest.raises(EngineError, match="out-of-plane"):
        integrate_edge_loads(mesh, [{"kind": "force", "regions": ["x1"], "vector": [1, 0, 1]}])
    with pytest.raises(EngineError, match="material|ν"):
        solve_mesh(mesh, axial_study(poisson=0.499))
    with pytest.raises(EngineError) as error:
        generate_rectangle(0.1, 0.02, 0.001, 1e-300)
    assert error.value.code == "resource-limit"


def test_product_rectangle_generator_preserves_regions_and_volume():
    mesh = generate_rectangle(0.123, 0.037, 0.003, 0.013)
    validate_mesh(mesh)
    assert mesh.regions == ("x0", "x1", "y0", "y1")
    np.testing.assert_allclose(
        cell_areas(mesh).sum() * mesh.thickness, 0.123 * 0.037 * 0.003, rtol=1e-14
    )
    result = solve_mesh(mesh, axial_study())
    np.testing.assert_allclose(result["summary"]["totalReaction"], [-120, 0, 0], atol=1e-9)
