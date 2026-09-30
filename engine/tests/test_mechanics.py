"""Analytical references using continuum tensors, not the FEM implementation.

Voigt order is xx, yy, zz, xy, yz, xz; shear strains are engineering strains.
The axial case admits Poisson contraction. The affine case has an interior node,
so the check exercises assembly and prescribed-displacement elimination.
"""

from dataclasses import replace

import numpy as np
import pytest
from conftest import brick_mesh
from scipy.sparse import coo_matrix

from phyra_engine.errors import EngineError
from phyra_engine.fem import (
    assemble,
    constitutive_matrix,
    element_matrices,
    integrate_surface_loads,
    solve_system,
)


def load(regions, vector=(0, 0, 0), pressure=0, kind="force"):
    return {
        "id": "load",
        "name": "Test",
        "regions": regions,
        "kind": kind,
        "vector": list(vector),
        "pressure": pressure,
    }


def assert_balance(mesh, force, reactions, scale):
    np.testing.assert_allclose((force + reactions).sum(axis=0), 0, atol=scale * 2e-9)
    moments = np.cross(mesh.positions, force + reactions).sum(axis=0)
    length = np.linalg.norm(np.ptp(mesh.positions, axis=0))
    np.testing.assert_allclose(moments, 0, atol=scale * length * 2e-9)


def _gamma(operations):
    """Float64 dot-product bound γₙ = nε/(1−nε), without a fitted force tolerance."""
    product = np.asarray(operations) * np.finfo(np.float64).eps
    return product / (1 - product)


def _rigid_modes(mesh):
    length = np.max(np.ptp(mesh.positions, axis=0))
    for axis in np.eye(3):
        yield np.tile(length * axis, (len(mesh.positions), 1))
        yield np.cross(axis, mesh.positions)


def _assert_rigid_roundoff(mesh, young, poisson, stiffness, displacement):
    """Bound representation error; no stiffness correction or physical tolerance change.

    With A = Σ V|B|ᵀ|D||B|, two six-term products and volume scaling cost
    6+6+1 operations. Assembly adds at most q incident elements per entry;
    a CSR row product adds m terms. Thus γ_(13+q+m) A|r| bounds formation,
    assembly and multiplication. A uses positive terms before cancellation.
    Represented Br contributes separately: |Br| ≤ |fl(Br)| + γ₁₂|B||r|.
    The strain assertion prevents that term from excusing a defective B.
    """
    strain, volumes, _ = element_matrices(mesh.positions, mesh.cells, young, poisson)
    material = constitutive_matrix(young, poisson)
    dofs = (mesh.cells[:, :, None] * 3 + np.arange(3)).reshape(-1, 12)
    local_r = displacement[mesh.cells].reshape(-1, 12)
    absolute_b, absolute_d = np.abs(strain), np.abs(material)
    measured_strain = np.einsum("cai,ci->ca", strain, local_r, optimize=False)
    strain_scale = np.einsum("cai,ci->ca", absolute_b, np.abs(local_r), optimize=False)
    strain_bound = _gamma(12) * strain_scale / (1 - _gamma(14))
    assert np.all(np.abs(measured_strain) <= np.nextafter(strain_bound, np.inf)), (
        "Rigid mode has strain exceeding its float64 representation bound."
    )

    db = np.einsum("ab,cbj->caj", absolute_d, absolute_b, optimize=False)
    local_a = np.einsum("cai,caj->cij", absolute_b, db, optimize=False)
    local_a *= volumes[:, None, None]
    rows = np.broadcast_to(dofs[:, :, None], local_a.shape).ravel()
    columns = np.broadcast_to(dofs[:, None, :], local_a.shape).ravel()
    envelope = coo_matrix((local_a.ravel(), (rows, columns)), shape=stiffness.shape).tocsr()
    q = np.repeat(np.bincount(mesh.cells.ravel(), minlength=len(mesh.positions)), 3)
    m = np.diff(stiffness.indptr)
    r = displacement.ravel()
    envelope_force = envelope @ np.abs(r)
    represented_strain = np.abs(measured_strain) + _gamma(12) * strain_scale
    represented_stress = np.einsum("ab,cb->ca", absolute_d, represented_strain, optimize=False)
    local_force = np.einsum("cai,ca->ci", absolute_b, represented_stress, optimize=False)
    local_force *= volumes[:, None]
    kinematic_force = np.zeros_like(r)
    np.add.at(kinematic_force, dofs.ravel(), local_force.ravel())
    # Upward inflation also accounts for evaluating the positive bounds:
    # A|r| costs 13+q+nnz(A row); the kinematic term costs 12+2+6+12+1+q;
    # combining them costs two operations. The next float encloses final rounding.
    envelope_terms = int(np.diff(envelope.indptr).max())
    bound_operations = max(13 + int(q.max()) + envelope_terms, 33 + int(q.max())) + 2
    inflation = 1 / (1 - _gamma(bound_operations))
    force_bound = (kinematic_force + _gamma(13 + q + m) * envelope_force) * inflation
    force_bound = np.nextafter(force_bound, np.inf)
    force = stiffness @ r
    assert np.all(np.abs(force) <= force_bound), (
        "Rigid force exceeds the derived float64 formation/assembly/product bound."
    )
    # Normalize energy by its positive formation envelope, not by zero physical
    # energy. The last γ_ndof term accounts for the energy dot product itself.
    energy_scale = np.abs(r) @ envelope_force
    normalized_energy = abs(r @ force) / energy_scale
    energy_bound = (
        np.abs(r) @ force_bound + _gamma(len(r)) * (np.abs(r) @ np.abs(force))
    ) / energy_scale
    energy_inflation = 1 / (1 - _gamma(len(r) + 3))
    assert normalized_energy <= np.nextafter(energy_bound * energy_inflation, np.inf)


def test_element_symmetry_and_rigid_energy(cube):
    _, volumes, element = element_matrices(cube.positions, cube.cells, 210e9, 0.3)
    np.testing.assert_allclose(volumes.sum(), 1, rtol=1e-14)
    np.testing.assert_allclose(element, element.transpose(0, 2, 1), atol=5e-5, rtol=1e-14)
    stiffness = assemble(cube, 210e9, 0.3)
    np.testing.assert_allclose((stiffness - stiffness.T).data, 0, atol=1e-4)
    for displacement in _rigid_modes(cube):
        _assert_rigid_roundoff(cube, 210e9, 0.3, stiffness, displacement)
    _assert_rigid_roundoff(
        cube, 210e9, 0.3, stiffness, np.cross(np.array([0.3, -0.2, 0.7]), cube.positions)
    )


@pytest.mark.parametrize("material_scale", [1e-6, 1, 1e3])
@pytest.mark.parametrize("length_scale", [1e-3, 1, 1e3])
def test_rigid_roundoff_guard_is_invariant_under_material_and_length_scaling(
    cube, material_scale, length_scale
):
    mesh = replace(cube, positions=cube.positions * length_scale)
    young = 210e9 * material_scale
    stiffness = assemble(mesh, young, 0.3)
    for displacement in _rigid_modes(mesh):
        _assert_rigid_roundoff(mesh, young, 0.3, stiffness, displacement)


@pytest.mark.parametrize("material_scale", [1e-6, 1, 1e3])
def test_rigid_roundoff_guard_rejects_a_positive_ground_spring(cube, material_scale):
    young = 210e9 * material_scale
    stiffness = assemble(cube, young, 0.3)
    broken = stiffness.copy()
    broken[0, 0] += young * 1e-10
    # At the lowest E this spring produces just 2.1e-5 N: the previous fixed
    # 1e-4 N assertion would miss it, while the precision-derived bound rejects it.
    displacement = next(_rigid_modes(cube))
    with pytest.raises(AssertionError, match="Rigid force"):
        _assert_rigid_roundoff(cube, young, 0.3, broken, displacement)


def test_affine_patch_with_nonzero_prescribed_displacement(cube):
    young, poisson = 17e9, 0.27
    gradient = np.array(
        [[0.002, 0.0007, 0.0005], [0.0004, -0.0003, 0.0002], [0.0001, 0.0008, 0.0009]]
    )
    translation = np.array([0.003, -0.001, 0.002])
    exact = cube.positions @ gradient.T + translation
    boundary_nodes = np.unique(cube.surface)
    prescribed = {
        3 * int(node) + axis: exact[node, axis] for node in boundary_nodes for axis in range(3)
    }
    force = np.zeros_like(cube.positions)
    result = solve_system(cube, young, poisson, force, prescribed)
    np.testing.assert_allclose(result["displacement"], exact, rtol=2e-11, atol=2e-14)
    strain = (gradient + gradient.T) / 2
    mu = young / (2 * (1 + poisson))
    lame = young * poisson / ((1 + poisson) * (1 - 2 * poisson))
    stress_tensor = 2 * mu * strain + lame * np.trace(strain) * np.eye(3)
    expected = stress_tensor[[0, 1, 2, 0, 1, 0], [0, 1, 2, 1, 2, 2]]
    np.testing.assert_allclose(
        result["stress"], np.tile(expected, (len(cube.cells), 1)), rtol=2e-11
    )
    assert_balance(cube, force, result["reactions"], np.linalg.norm(expected))


def test_axial_extension_allows_lateral_contraction():
    mesh = brick_mesh((0.4, 0.05, 0.03), (8, 2, 2))
    young, poisson, total_force = 210e9, 0.3, 1200.0
    force = integrate_surface_loads(mesh, [load(["x1"], (total_force, 0, 0))])
    x0 = np.flatnonzero(np.isclose(mesh.positions[:, 0], 0))
    origin = np.flatnonzero(np.all(np.isclose(mesh.positions, 0), axis=1))[0]
    y_corner = np.flatnonzero(np.all(np.isclose(mesh.positions, [0, 0.05, 0]), axis=1))[0]
    # The end plane fixes only ux; three point DOFs remove remaining rigid motions.
    prescribed = {3 * int(node): 0.0 for node in x0}
    prescribed.update(
        {3 * int(origin) + 1: 0.0, 3 * int(origin) + 2: 0.0, 3 * int(y_corner) + 2: 0.0}
    )
    result = solve_system(mesh, young, poisson, force, prescribed)
    axial_stress = total_force / (0.05 * 0.03)
    axial_strain = axial_stress / young
    exact = mesh.positions * [axial_strain, -poisson * axial_strain, -poisson * axial_strain]
    np.testing.assert_allclose(result["displacement"], exact, rtol=5e-9, atol=2e-15)
    expected_stress = np.tile([axial_stress, 0, 0, 0, 0, 0], (len(mesh.cells), 1))
    np.testing.assert_allclose(result["stress"], expected_stress, atol=axial_stress * 5e-9)
    np.testing.assert_allclose(result["vonMises"], axial_stress, rtol=5e-9)
    assert_balance(mesh, force, result["reactions"], total_force)


def test_multisurface_total_force_is_not_applied_per_face(cube):
    expected = np.array([71.0, -32.0, 14.0])
    force = integrate_surface_loads(cube, [load(["x1", "y1"], expected)])
    np.testing.assert_allclose(force.sum(axis=0), expected, rtol=2e-14, atol=1e-13)
    # Equal-area faces have centroid (1,.5,.5) and (.5,1,.5).
    moment = np.cross(cube.positions, force).sum(axis=0)
    np.testing.assert_allclose(
        moment, np.cross([0.75, 0.75, 0.5], expected), rtol=2e-14, atol=1e-13
    )


def test_positive_pressure_pushes_inward_and_closed_surface_balances(cube):
    force = integrate_surface_loads(cube, [load(["x1"], kind="pressure", pressure=700)])
    np.testing.assert_allclose(force.sum(axis=0), [-700, 0, 0], atol=1e-11)
    np.testing.assert_allclose(
        np.cross(cube.positions, force).sum(axis=0), [0, -350, 350], atol=1e-11
    )
    closed = integrate_surface_loads(
        cube, [load(list(cube.regions), kind="pressure", pressure=700)]
    )
    np.testing.assert_allclose(closed.sum(axis=0), 0, atol=1e-11)
    np.testing.assert_allclose(np.cross(cube.positions, closed).sum(axis=0), 0, atol=1e-11)


def test_linear_load_scaling_and_force_moment_reactions(cube):
    fixed = np.flatnonzero(np.isclose(cube.positions[:, 0], 0))
    prescribed = {3 * int(node) + component: 0 for node in fixed for component in range(3)}
    force = integrate_surface_loads(cube, [load(["x1"], (10, -2, -3))])
    first = solve_system(cube, 5e6, 0.2, force, prescribed)
    second = solve_system(cube, 5e6, 0.2, 3 * force, prescribed)
    for field in ("displacement", "stress", "reactions", "vonMises"):
        np.testing.assert_allclose(second[field], 3 * first[field], rtol=2e-11, atol=1e-12)
    assert_balance(cube, force, first["reactions"], 12)


def test_dimensional_scaling_preserves_strain_and_stress(cube):
    """Scaling lengths by s and forces by s² preserves strain and stress."""
    fixed = np.flatnonzero(np.isclose(cube.positions[:, 0], 0))
    prescribed = {3 * int(node) + axis: 0 for node in fixed for axis in range(3)}
    force = integrate_surface_loads(cube, [load(["x1"], (10, -2, -3))])
    original = solve_system(cube, 5e6, 0.2, force, prescribed)
    scale = 1e-3
    scaled_mesh = replace(cube, positions=cube.positions * scale)
    scaled_force = integrate_surface_loads(
        scaled_mesh, [load(["x1"], np.array([10, -2, -3]) * scale**2)]
    )
    scaled = solve_system(scaled_mesh, 5e6, 0.2, scaled_force, prescribed)
    np.testing.assert_allclose(
        scaled["displacement"], original["displacement"] * scale, rtol=2e-10, atol=1e-18
    )
    np.testing.assert_allclose(scaled["stress"], original["stress"], rtol=2e-10, atol=1e-9)
    np.testing.assert_allclose(
        scaled["reactions"], original["reactions"] * scale**2, rtol=2e-10, atol=1e-15
    )
    np.testing.assert_allclose(
        scaled["summary"]["strainEnergy"],
        original["summary"]["strainEnergy"] * scale**3,
        rtol=2e-10,
    )


@pytest.mark.parametrize(
    "young,poisson", [(0, 0.3), (-1, 0.3), (1, -1), (1, 0.5), (1, 0.49), (np.inf, 0.3), (1, np.nan)]
)
def test_invalid_or_unsupported_materials_are_rejected(young, poisson):
    with pytest.raises(EngineError):
        constitutive_matrix(young, poisson)


def test_unrestrained_solid_is_rejected(cube):
    force = integrate_surface_loads(cube, [load(["x1"], (1, 0, 0))])
    with pytest.raises(EngineError):
        solve_system(cube, 210e9, 0.3, force, {})


@pytest.mark.parametrize("support", ["x0", "boundary", "all"])
def test_prescribed_rigid_translation_without_load(cube, support):
    """Rigid translations carry no strain; zero-load roundoff must not become failure."""
    young = 17e9
    translation = np.array([0.001, 0.002, 0.003])
    if support == "x0":
        nodes = np.flatnonzero(np.isclose(cube.positions[:, 0], 0))
    elif support == "boundary":
        nodes = np.unique(cube.surface)
    else:
        nodes = np.arange(len(cube.positions))
    prescribed = {3 * int(node) + axis: translation[axis] for node in nodes for axis in range(3)}
    result = solve_system(cube, young, 0.27, np.zeros_like(cube.positions), prescribed)
    expected = np.tile(translation, (len(cube.positions), 1))
    np.testing.assert_allclose(result["displacement"], expected, rtol=2e-11, atol=2e-15)
    # Absolute bound follows E*|u|/L times floating-point assembly/solve accuracy.
    stress_roundoff = young * np.linalg.norm(translation) * 1e-12
    np.testing.assert_allclose(result["stress"], 0, atol=stress_roundoff)
    np.testing.assert_allclose(result["reactions"], 0, atol=stress_roundoff)


@pytest.mark.slow
def test_cantilever_bending_mesh_convergence():
    """Euler–Bernoulli end displacement FL³/(3EI), L/h=10, square section.

    A fixed 3D end produces a local constraint layer; shear deformation is about
    0.8% here. Linear tetrahedra are deliberately stiff in bending. The test
    requires decreasing error under refinement and a <=15% finest-mesh error;
    it does not imply that coarse engineering meshes have that accuracy.
    """
    length, width, height, young, poisson = 1.0, 0.1, 0.1, 2e9, 0.3
    inertia = width * height**3 / 12
    reference = length**3 / (3 * young * inertia)
    errors = []
    for n in (2, 4, 8):
        mesh = brick_mesh((length, width, height), (10 * n, n, n))
        force = integrate_surface_loads(mesh, [load(["x1"], (0, 0, -1))])
        fixed = np.flatnonzero(np.isclose(mesh.positions[:, 0], 0))
        prescribed = {3 * int(node) + component: 0 for node in fixed for component in range(3)}
        result = solve_system(mesh, young, poisson, force, prescribed)
        # Work-conjugate end average uses the actual traction quadrature weights.
        displacement = np.sum(force[:, 2] * result["displacement"][:, 2])
        errors.append(abs(displacement - reference) / reference)
        assert_balance(mesh, force, result["reactions"], 1)
        print(
            f"bending subdivisions={10 * n}x{n}x{n}, cells={len(mesh.cells)}, "
            f"deflection={displacement:.12g} m, reference={reference:.12g} m, "
            f"relative error={errors[-1]:.6%}"
        )
    assert errors[1] < errors[0]
    assert errors[2] < errors[1]
    assert errors[-1] <= 0.15
