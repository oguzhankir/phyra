"""Independent exact-volume, affine elasticity and worker-boundary CAD mesh evidence."""

import hashlib
import json
import math
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from OCP.BRep import BRep_Builder
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeSphere
from OCP.gp import gp_Pnt
from OCP.TopAbs import TopAbs_FACE
from OCP.TopoDS import TopoDS_Compound

from phyra_engine.errors import EngineError
from phyra_engine.execution.cad import execute
from phyra_engine.geometry.cad.compatibility import lower_geometry
from phyra_engine.geometry.cad.kernel import build, export_brep, export_step, read_brep
from phyra_engine.geometry.cad.topology import subshapes
from phyra_engine.meshing import cad as cad_meshing
from phyra_engine.meshing.cad import generate_cad_mesh
from phyra_engine.meshing.solid import tetra_volumes, validate_mesh
from phyra_engine.methods.classical.solid import solve_mesh
from phyra_engine.protocol.cad import CadRequest

ROOT = Path(__file__).resolve().parents[2]


def definition(hole=False, translated=False):
    features = [
        {"id": "box", "kind": "box", "name": "Box", "length": 0.1, "width": 0.05, "height": 0.02}
    ]
    output = "box"
    if hole:
        features.extend(
            [
                {
                    "id": "cylinder",
                    "kind": "cylinder",
                    "name": "Tool",
                    "length": 0.1,
                    "radius": 0.005,
                },
                {
                    "id": "placed",
                    "kind": "transform",
                    "name": "Tool placement",
                    "inputId": "cylinder",
                    "translation": [0, 0.025, 0.01],
                    "axisOrigin": [0, 0, 0],
                    "axisDirection": [1, 0, 0],
                    "angle": 0,
                },
                {
                    "id": "cut",
                    "kind": "boolean",
                    "name": "Through hole",
                    "operation": "cut",
                    "leftId": "box",
                    "rightId": "placed",
                },
            ]
        )
        output = "cut"
    if translated:
        features.append(
            {
                "id": "moved",
                "kind": "transform",
                "name": "Placed solid",
                "inputId": output,
                "translation": [0.2, -0.1, 0.3],
                "axisOrigin": [0, 0, 0],
                "axisDirection": [0, 0, 1],
                "angle": 0,
            }
        )
        output = "moved"
    return {
        "kind": "cad",
        "dimension": "3d",
        "features": features,
        "outputFeatureId": output,
        "assets": [],
    }


def request(tmp_path, geometry=None, size=0.012):
    return {
        "protocolVersion": 1,
        "operation": "mesh-cad",
        "jobId": "mesh-inspection",
        "projectId": "project",
        "revision": 4,
        "geometry": geometry or definition(),
        "assetRoot": str(tmp_path),
        "targetSize": size,
    }


def array(receipt, buffer, name):
    layout = receipt["arrays"][name]
    dtype = "<f8" if layout["dtype"] == "float64" else "<u4"
    return np.frombuffer(
        buffer,
        dtype=dtype,
        count=layout["byteLength"] // np.dtype(dtype).itemsize,
        offset=layout["offset"],
    ).reshape(layout["shape"])


@pytest.mark.parametrize("translated", [False, True])
def test_brep_box_volume_units_complete_boundary_and_placement(translated):
    authored = definition(translated=translated)
    original = deepcopy(authored)
    # Exercise the actual unitless BRep interchange, including nonzero SI origin.
    shape = read_brep(export_brep(build(authored, {}).shape))
    result = generate_cad_mesh(shape, 0.012)
    mesh = result.mesh
    validate_mesh(mesh)
    assert authored == original
    assert result.exact_volume == pytest.approx(0.1 * 0.05 * 0.02, rel=1e-12)
    assert tetra_volumes(mesh.positions, mesh.cells).sum() == pytest.approx(
        result.exact_volume, rel=1e-12
    )
    origin = np.array([0.2, -0.1, 0.3] if translated else [0, 0, 0])
    np.testing.assert_allclose(mesh.positions.min(axis=0), origin, atol=1e-14, rtol=0)
    np.testing.assert_allclose(
        mesh.positions.max(axis=0), origin + [0.1, 0.05, 0.02], atol=1e-14, rtol=0
    )
    assert set(mesh.surface_regions) == set(range(6))
    assert mesh.regions == tuple(f"mesh-face-{i}" for i in range(1, 7))
    points = mesh.positions[mesh.surface]
    area_vectors = np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]) / 2
    # Closed-boundary divergence identities are independent of the tetra extractor.
    np.testing.assert_allclose(area_vectors.sum(axis=0), 0, atol=1e-16)
    divergence_volume = np.einsum("ij,ij->", area_vectors, points.mean(axis=1)) / 3
    assert divergence_volume == pytest.approx(result.exact_volume, rel=1e-12)


def test_boolean_brep_real_fem_hydrostatic_patch_and_analysis_remains_gated():
    authored = definition(hole=True)
    result = generate_cad_mesh(build(authored, {}).shape, 0.012)
    mesh = result.mesh
    exact_volume = 0.1 * (0.05 * 0.02 - math.pi * 0.005**2)
    assert result.exact_volume == pytest.approx(exact_volume, rel=1e-12)
    assert (
        abs(tetra_volumes(mesh.positions, mesh.cells).sum() - exact_volume) / exact_volume < 0.002
    )
    with pytest.raises(EngineError) as unavailable:
        lower_geometry(authored)
    assert unavailable.value.code == "unsupported-cad-study"

    constraints = []
    for axis in range(3):
        selected = [
            region
            for index, region in enumerate(mesh.regions)
            if np.all(
                np.abs(mesh.positions[mesh.surface[mesh.surface_regions == index], axis]) < 1e-12
            )
        ]
        assert len(selected) == 1
        components = [None, None, None]
        components[axis] = 0
        constraints.append({"regions": selected, "components": components})
    pressure, young, poisson = 2e6, 210e9, 0.3
    solved = solve_mesh(
        mesh,
        {
            "material": {"young": young, "poisson": poisson},
            "constraints": constraints,
            "loads": [{"regions": list(mesh.regions), "kind": "pressure", "pressure": pressure}],
        },
    )
    # sigma=-pI and epsilon=-p(1-2nu)/E I solve equilibrium on every shape,
    # including the cavity. Pressure is integrated on every outward mesh face.
    strain = -pressure * (1 - 2 * poisson) / young
    np.testing.assert_allclose(
        solved["displacement"], strain * mesh.positions, rtol=1e-9, atol=1e-15
    )
    np.testing.assert_allclose(solved["stress"][:, :3], -pressure, rtol=1e-9)
    np.testing.assert_allclose(solved["stress"][:, 3:], 0, atol=pressure * 1e-9)
    discrete_volume = tetra_volumes(mesh.positions, mesh.cells).sum()
    energy = 3 * pressure**2 * (1 - 2 * poisson) / (2 * young) * discrete_volume
    assert solved["summary"]["strainEnergy"] == pytest.approx(energy, rel=1e-9)
    assert solved["summary"]["relativeForceBalance"] < 1e-8
    assert solved["summary"]["relativeMomentBalance"] < 1e-8
    assert solved["summary"]["relativeResidual"] < 1e-8


def test_curved_brep_volume_converges_to_independent_sphere_reference():
    radius = 0.01
    shape = BRepPrimAPI_MakeSphere(radius * 1000).Shape()
    exact = 4 * math.pi * radius**3 / 3
    errors, cell_counts = [], []
    for size in (0.004, 0.0015):
        result = generate_cad_mesh(shape, size)
        assert result.exact_volume == pytest.approx(exact, rel=1e-12)
        assert result.exact_surface_area == pytest.approx(4 * math.pi * radius**2, rel=1e-12)
        errors.append(
            abs(tetra_volumes(result.mesh.positions, result.mesh.cells).sum() - exact) / exact
        )
        cell_counts.append(len(result.mesh.cells))
    assert cell_counts[1] > cell_counts[0]
    assert errors[1] < 0.6 * errors[0]
    assert errors[1] < 0.01


def test_mesh_receipt_is_separate_bounded_and_contains_only_validated_inspection_arrays(tmp_path):
    payload = request(tmp_path, definition(hole=True))
    before = deepcopy(payload)
    output = tmp_path / "output"
    receipt = execute(CadRequest.from_payload(payload), output)
    assert payload == before
    assert receipt["operation"] == "mesh-cad" and receipt["purpose"] == "inspection-only"
    assert receipt["targetSize"] == payload["targetSize"]
    assert not {"analysisCompatibility", "assets", "fields", "stress", "displacement"}.intersection(
        receipt
    )
    assert {file.name for file in output.iterdir()} == {"buffer.bin", "receipt.json"}
    blob = (output / "buffer.bin").read_bytes()
    assert hashlib.sha256(blob).hexdigest() == receipt["bufferHash"]
    assert len(blob) == receipt["byteLength"] <= 64 * 1024 * 1024
    assert all(layout["offset"] % 8 == 0 for layout in receipt["arrays"].values())
    positions, cells, surface = (
        array(receipt, blob, name) for name in ("positions", "cells", "surface")
    )
    quality = array(receipt, blob, "quality")
    statistics = receipt["statistics"]
    assert quality.shape == (len(cells),)
    assert statistics["minQuality"] == pytest.approx(quality.min(), rel=1e-12)
    assert statistics["maxQuality"] == pytest.approx(quality.max(), rel=1e-12)
    assert statistics["meanQuality"] == pytest.approx(quality.mean(), rel=1e-12)
    assert sum(region["triangleCount"] for region in receipt["regions"]) == len(surface)
    assert sum(region["area"] for region in receipt["regions"]) == pytest.approx(
        statistics["meshSurfaceArea"], rel=1e-12
    )
    np.testing.assert_array_equal(
        statistics["bounds"], [positions.min(axis=0), positions.max(axis=0)]
    )
    assert all(region["identity"] == "mesh-scoped" for region in receipt["regions"])
    assert receipt["meshId"] == hashlib.sha256(positions.tobytes() + cells.tobytes()).hexdigest()


@pytest.mark.parametrize("size", [True, 0, -1, math.inf, math.nan, "0.01", 1001])
def test_mesh_request_rejects_invalid_target_sizes(tmp_path, size):
    with pytest.raises(EngineError):
        CadRequest.from_payload(request(tmp_path, size=size))


def test_mesh_request_rejects_extra_fields_and_non_3d_geometry(tmp_path):
    payload = request(tmp_path)
    payload["shapePath"] = "/untrusted/solid.brep"
    with pytest.raises(EngineError):
        CadRequest.from_payload(payload)
    payload = request(tmp_path)
    payload["geometry"]["dimension"] = "2d"
    with pytest.raises(EngineError):
        CadRequest.from_payload(payload)


def test_imported_step_meshes_without_enabling_analysis_and_rejects_tampered_asset(tmp_path):
    source = export_step(build(definition(hole=True), {}).shape)
    digest = hashlib.sha256(source).hexdigest()
    imported = {
        "kind": "cad",
        "dimension": "3d",
        "outputFeatureId": "import",
        "features": [
            {
                "id": "import",
                "name": "Imported solid",
                "kind": "import-step",
                "assetId": "source",
                "scaleFactor": 1,
            }
        ],
        "assets": [
            {
                "id": "source",
                "kind": "step-source",
                "originalName": "part.step",
                "sha256": digest,
                "byteLength": len(source),
            }
        ],
    }
    path = tmp_path / (digest + ".step")
    path.write_bytes(source)
    receipt = execute(
        CadRequest.from_payload(request(tmp_path, imported)), tmp_path / "import-mesh"
    )
    assert receipt["statistics"]["exactVolume"] == pytest.approx(
        0.1 * (0.05 * 0.02 - math.pi * 0.005**2), rel=1e-10
    )
    with pytest.raises(EngineError) as unavailable:
        lower_geometry(imported)
    assert unavailable.value.code == "unsupported-cad-study"
    path.write_bytes(b"x" * len(source))
    with pytest.raises(EngineError, match="integrity"):
        execute(CadRequest.from_payload(request(tmp_path, imported)), tmp_path / "rejected")
    assert not (tmp_path / "rejected").exists()


def test_independent_component_instance_is_not_implicitly_meshed_as_a_connected_domain(tmp_path):
    geometry = definition()
    geometry["features"].append(
        {
            "id": "assembly",
            "name": "Assembly",
            "kind": "assembly",
            "components": [{"id": "component", "name": "One component", "featureId": "box"}],
        }
    )
    geometry["outputFeatureId"] = "assembly"
    with pytest.raises(EngineError, match="component meshes"):
        execute(CadRequest.from_payload(request(tmp_path, geometry)), tmp_path / "rejected")
    assert not (tmp_path / "rejected").exists()


def test_excessive_curvature_sizing_work_aborts_without_clamping_or_publishing(monkeypatch):
    shape = BRepPrimAPI_MakeSphere(10).Shape()
    with monkeypatch.context() as bounded:
        bounded.setattr(cad_meshing, "MAX_SIZE_EVALUATIONS", 16)
        with pytest.raises(EngineError, match="curvature refinement") as failure:
            generate_cad_mesh(shape, 0.004)
        assert failure.value.code == "resource-limit"
    # The rejected mesh owns no receipt and releases Gmsh before a valid retry.
    assert len(generate_cad_mesh(shape, 0.004).mesh.cells) > 0


def test_rejects_shell_multiple_solids_and_resource_exhaustion():
    shape = BRepPrimAPI_MakeBox(100, 50, 20).Shape()
    with pytest.raises(EngineError, match="one closed solid"):
        generate_cad_mesh(subshapes(shape, TopAbs_FACE)[0], 0.01)
    builder, compound = BRep_Builder(), TopoDS_Compound()
    builder.MakeCompound(compound)
    builder.Add(compound, shape)
    builder.Add(compound, BRepPrimAPI_MakeBox(gp_Pnt(200, 0, 0), 100, 50, 20).Shape())
    with pytest.raises(EngineError, match="one closed solid"):
        generate_cad_mesh(compound, 0.01)
    with pytest.raises(EngineError) as limited:
        generate_cad_mesh(shape, 1e-8)
    assert limited.value.code == "resource-limit"
    # Failed admission must leave Gmsh ready for the next isolated operation.
    assert len(generate_cad_mesh(shape, 0.02).mesh.cells) > 0


def test_mesh_worker_stdout_is_json_only_and_publishes_inspection(tmp_path):
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "engine")}
    process = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine" / "entry.py"),
            "--cad",
            "--output",
            str(tmp_path / "job"),
        ],
        input=json.dumps(request(tmp_path)),
        text=True,
        capture_output=True,
        timeout=30,
        env=environment,
        cwd=ROOT,
    )
    assert process.returncode == 0, process.stderr + process.stdout
    messages = [json.loads(line) for line in process.stdout.splitlines()]
    assert messages[-1]["type"] == "complete"
    assert messages[-1]["manifest"]["purpose"] == "inspection-only"
