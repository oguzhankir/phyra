"""Independent SI geometry, failure, topology and owned CAD worker references."""

import hashlib
import io
import json
import math
import os
import subprocess
import sys
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from OCP.BRepPrimAPI import BRepPrimAPI_MakePrism, BRepPrimAPI_MakeRevol
from OCP.gp import gp_Ax1, gp_Dir, gp_Pnt, gp_Vec
from OCP.TopAbs import TopAbs_EDGE

from phyra_engine.errors import EngineError
from phyra_engine.execution.cad import execute
from phyra_engine.geometry.cad.kernel import (
    build,
    export_brep,
    export_step,
    import_step,
    profile_face,
    read_brep,
)
from phyra_engine.geometry.cad.tessellation import tessellate
from phyra_engine.geometry.cad.topology import (
    bounds,
    entities,
    properties,
    selected_edges,
    subshapes,
)
from phyra_engine.protocol.cad import CadRequest

ROOT = Path(__file__).resolve().parents[2]
BOX = {"id": "box", "name": "Box", "kind": "box", "length": 0.1, "width": 0.05, "height": 0.02}


def geometry(features=None, output=None):
    return {
        "kind": "cad",
        "dimension": "3d",
        "features": features or [deepcopy(BOX)],
        "outputFeatureId": output or "box",
        "assets": [],
    }


def request(tmp_path, definition=None):
    return {
        "protocolVersion": 1,
        "jobId": "cad-job",
        "projectId": "project",
        "revision": 3,
        "geometry": definition or geometry(),
        "assetRoot": str(tmp_path),
    }


def rectangle_profile(points):
    return {
        "outer": [
            {
                "id": f"edge-{i}",
                "kind": "line",
                "start": list(p),
                "end": list(points[(i + 1) % len(points)]),
            }
            for i, p in enumerate(points)
        ],
        "holes": [],
    }


def test_primitives_exact_si_volume_and_cylinder_axis():
    box = build(geometry(), {}).shape
    assert properties(box, "body")[0] == pytest.approx(0.0001, rel=1e-12)
    cylinder = {
        "id": "cylinder",
        "name": "Cylinder",
        "kind": "cylinder",
        "radius": 0.01,
        "length": 0.1,
    }
    shape = build(geometry([cylinder], "cylinder"), {}).shape
    measure, center = properties(shape, "body")
    assert measure == pytest.approx(math.pi * 0.01**2 * 0.1, rel=1e-12)
    assert center == pytest.approx([0.05, 0, 0], abs=1e-15)


@pytest.mark.parametrize("plane,normal", [("xy", [0, 0, 1]), ("xz", [0, -1, 0]), ("yz", [1, 0, 0])])
def test_exact_profile_extrusion_independent_volume_and_holes(plane, normal):
    profile = rectangle_profile([(0, 0), (0.1, 0), (0.1, 0.05), (0, 0.05)])
    profile["holes"] = [{"id": "hole", "name": "Hole", "center": [0.05, 0.025], "radius": 0.005}]
    face = profile_face(profile, plane)
    shape = BRepPrimAPI_MakePrism(face, gp_Vec(*(n * 20 for n in normal))).Shape()
    expected = (0.1 * 0.05 - math.pi * 0.005**2) * 0.02
    assert properties(shape, "body")[0] == pytest.approx(expected, rel=1e-12)


def test_exact_annulus_revolution_and_generated_topology_history():
    profile = rectangle_profile([(0.01, 0), (0.02, 0), (0.02, 0.05), (0.01, 0.05)])
    face = profile_face(profile, "xz")
    operation = BRepPrimAPI_MakeRevol(face, gp_Ax1(gp_Pnt(), gp_Dir(0, 0, 1)), 2 * math.pi)
    assert properties(operation.Shape(), "body")[0] == pytest.approx(
        math.pi * (0.02**2 - 0.01**2) * 0.05
    )
    assert any(list(operation.Generated(edge)) for edge in subshapes(face, TopAbs_EDGE))


@pytest.mark.parametrize(
    "operation,expected", [("cut", 0.00005), ("intersect", 0.00005), ("union", 0.0002)]
)
def test_boolean_exact_analytical_volume_and_explicit_history(operation, expected):
    other = {**BOX, "id": "other", "length": 0.05, "width": 0.1, "height": 0.03}
    boolean = {
        "id": "boolean",
        "name": "Boolean",
        "kind": "boolean",
        "operation": operation,
        "leftId": "box",
        "rightId": "other",
    }
    result = build(geometry([BOX, other, boolean], "boolean"), {})
    assert properties(result.shape, "body")[0] == pytest.approx(expected, rel=1e-12)
    history = result.feature_metadata[-1]["history"]
    assert {row["sourceId"] for row in history} == {"box", "other"}
    assert all(
        set(row) == {"sourceId", "faceId", "modified", "generated", "deleted"} for row in history
    )


def test_rigid_transform_rotation_then_translation_preserves_exact_shape_and_source():
    transform = {
        "id": "placed",
        "name": "Placed box",
        "kind": "transform",
        "inputId": "box",
        "translation": [0.02, -0.03, 0.04],
        "axisOrigin": [0.01, 0.02, 0],
        "axisDirection": [0, 0, 4],
        "angle": math.pi / 2,
    }
    definition = geometry([BOX, transform], "placed")
    original = deepcopy(definition)
    source = build(geometry(), {}).shape
    result = build(definition, {})
    # Independent Rz(90 degrees) about (10,20,0) mm followed by the global
    # translation. These bounds distinguish the opposite composition order.
    np.testing.assert_allclose(
        bounds(result.shape), [[0, -0.02, 0.04], [0.05, 0.08, 0.06]], rtol=0, atol=1e-14
    )
    assert properties(result.shape, "body")[1] == pytest.approx([0.025, 0.03, 0.05], abs=1e-14)
    assert properties(result.shape, "body")[0] == pytest.approx(0.0001, rel=1e-12)
    assert properties(result.shape, "face")[0] == pytest.approx(properties(source, "face")[0])
    np.testing.assert_allclose(bounds(source), [[0, 0, 0], [0.1, 0.05, 0.02]], rtol=0, atol=1e-14)
    history = result.feature_metadata[-1]["history"]
    assert len(history) == 6 and all(row["sourceId"] == "box" for row in history)
    assert all(row["modified"] == 1 and not row["deleted"] for row in history)
    assert definition == original


def test_placed_rotated_cylinder_cuts_real_off_origin_through_hole():
    cylinder = {
        "id": "drill",
        "name": "Drill cylinder",
        "kind": "cylinder",
        "radius": 0.005,
        "length": 0.04,
    }
    placement = {
        "id": "placed",
        "name": "Through-hole placement",
        "kind": "transform",
        "inputId": "drill",
        "translation": [0.05, 0.025, -0.01],
        "axisOrigin": [0, 0, 0],
        "axisDirection": [0, 1, 0],
        "angle": -math.pi / 2,
    }
    cut = {
        "id": "cut",
        "name": "Off-origin through hole",
        "kind": "boolean",
        "operation": "cut",
        "leftId": "box",
        "rightId": "placed",
    }
    result = build(geometry([BOX, cylinder, placement, cut], "cut"), {})
    assert properties(result.shape, "body")[0] == pytest.approx(
        0.0001 - math.pi * 0.005**2 * 0.02, rel=1e-12
    )


@pytest.mark.parametrize("axis", [[0, 0, 0], [float("nan"), 0, 1]])
def test_rigid_transform_rejects_invalid_axis_without_source_mutation(axis):
    feature = {
        "id": "bad",
        "name": "Invalid placement",
        "kind": "transform",
        "inputId": "box",
        "translation": [0, 0, 0],
        "axisOrigin": [0, 0, 0],
        "axisDirection": axis,
        "angle": 0,
    }
    with pytest.raises(EngineError, match="nonzero axis"):
        build(geometry([BOX, feature], "bad"), {})
    assert properties(build(geometry(), {}).shape, "body")[0] == pytest.approx(0.0001)


@pytest.mark.parametrize("kind", ["fillet", "chamfer"])
def test_finish_size_failure_and_changed_selection_require_repair(kind):
    shape = build(geometry(), {}).shape
    edge = entities(shape, "box", "edge")[0]
    size = "radius" if kind == "fillet" else "distance"
    feature = {
        "id": "finish",
        "name": "Finish",
        "kind": kind,
        "inputId": "box",
        "edgeIds": [edge.reference],
        size: 0.001,
    }
    result = build(geometry([BOX, feature], "finish"), {})
    removed_area = 0.001**2 * (1 - math.pi / 4 if kind == "fillet" else 0.5)
    assert properties(result.shape, "body")[0] == pytest.approx(
        0.0001 - removed_area * 0.02, rel=1e-12
    )
    with pytest.raises(EngineError) as error:
        build(geometry([BOX, {**feature, size: 0.1}], "finish"), {})
    assert error.value.code == "cad-feature-failed"
    assert properties(shape, "body")[0] == pytest.approx(0.0001)
    with pytest.raises(EngineError) as error:
        build(geometry([{**BOX, "height": 0.03}, feature], "finish"), {})
    assert error.value.code == "cad-selection-repair"


@pytest.mark.parametrize("unit", ["m", "mm"])
def test_step_declared_units_roundtrip_and_explicit_scale(unit):
    original = build(geometry(), {}).shape
    encoded = export_step(original, unit)
    restored, units = import_step(encoded)
    assert units == ["metre" if unit == "m" else "millimetre"]
    assert properties(restored, "body")[0] == pytest.approx(0.0001, rel=1e-12)
    scaled, _ = import_step(encoded, 2)
    assert properties(scaled, "body")[0] == pytest.approx(0.0008, rel=1e-12)
    with pytest.raises(EngineError, match="decoded"):
        import_step(b"Not a STEP model")


def test_brep_is_exact_and_display_preserves_si_and_outward_orientation():
    from OCP.BRep import BRep_Builder
    from OCP.BRepGProp import BRepGProp
    from OCP.BRepTools import BRepTools
    from OCP.GProp import GProp_GProps
    from OCP.TopoDS import TopoDS_Shape

    shape = build(geometry(), {}).shape
    encoded = export_brep(shape)
    # Independent raw OCCT read must find metre coordinates, without our reader's conversion.
    raw = TopoDS_Shape()
    BRepTools.Read_s(raw, io.BytesIO(encoded), BRep_Builder())
    raw_properties = GProp_GProps()
    BRepGProp.VolumeProperties_s(raw, raw_properties)
    assert raw_properties.Mass() == pytest.approx(0.0001, rel=1e-12)
    assert raw_properties.CentreOfMass().X() == pytest.approx(0.05, rel=1e-12)
    restored = read_brep(encoded)
    assert properties(restored, "body")[0] == pytest.approx(0.0001, rel=1e-12)
    before = {e.reference for e in entities(shape, "box", "edge")}
    display = tessellate(shape, "box")
    after = {e.reference for e in entities(shape, "box", "edge")}
    assert before == after
    positions = display.arrays["positions"]
    triangles = positions[display.arrays["triangles"]]
    signed_volume = (
        np.einsum("ij,ij->i", triangles[:, 0], np.cross(triangles[:, 1], triangles[:, 2])).sum() / 6
    )
    assert signed_volume == pytest.approx(0.0001, rel=1e-12)
    assert positions.max(axis=0) == pytest.approx([0.1, 0.05, 0.02])
    assert np.all(display.arrays["triangleFaces"] < len(display.faces))
    assert np.all(display.arrays["segmentEdges"] < len(display.edges))


def test_duplicate_coincident_topology_is_ambiguous():
    from OCP.BRep import BRep_Builder
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    from OCP.TopoDS import TopoDS_Compound

    shape = build(geometry(), {}).shape
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, shape)
    builder.Add(compound, BRepBuilderAPI_Copy(shape, True, False).Shape())
    edges = entities(compound, "assembly", "edge")
    assert edges and all(e.ambiguous for e in edges)
    assert len({edge.reference for edge in edges}) == len(edges)
    with pytest.raises(EngineError) as error:
        selected_edges(compound, "assembly", [edges[0].reference])
    assert error.value.code == "cad-selection-repair"
    display = tessellate(compound, "assembly")
    assert len({face.reference for face in display.faces}) == len(display.faces)


def test_coincident_step_import_publishes_unique_unassignable_display_tokens(tmp_path):
    from OCP.BRep import BRep_Builder
    from OCP.BRepBuilderAPI import BRepBuilderAPI_Copy
    from OCP.TopoDS import TopoDS_Compound

    shape = build(geometry(), {}).shape
    compound = TopoDS_Compound()
    builder = BRep_Builder()
    builder.MakeCompound(compound)
    builder.Add(compound, shape)
    builder.Add(compound, BRepBuilderAPI_Copy(shape, True, False).Shape())
    payload = export_step(compound)
    digest = hashlib.sha256(payload).hexdigest()
    (tmp_path / f"{digest}.step").write_bytes(payload)
    definition = geometry(
        [
            {
                "id": "import",
                "name": "Assembly",
                "kind": "import-step",
                "assetId": "source",
                "scaleFactor": 1,
            }
        ],
        "import",
    )
    definition["assets"] = [
        {
            "id": "source",
            "kind": "step-source",
            "originalName": "assembly.step",
            "sha256": digest,
            "byteLength": len(payload),
        }
    ]
    receipt = execute(CadRequest.from_payload(request(tmp_path, definition)), tmp_path / "output")
    assert receipt["assets"]["brep"]["units"] == "m"
    assert any(row["code"] == "ambiguous-topology" for row in receipt["diagnostics"])
    for collection in ("faces", "edges", "bodies"):
        records = receipt[collection]
        assert len({record["id"] for record in records}) == len(records)
        assert all(record["identity"] == "ambiguous" for record in records)
    assert receipt["analysisCompatibility"]["state"] == "unsupported"


def test_native_request_snapshot_and_recipe_references_are_bounded(tmp_path):
    payload = request(tmp_path)
    decoded = CadRequest.from_payload(payload)
    payload["geometry"]["features"][0]["length"] = 0.2
    assert decoded.geometry_definition()["features"][0]["length"] == 0.1
    for defect in [
        {**BOX, "length": float("nan")},
        {"id": "bad", "name": "Bad", "kind": "extrude", "sketchId": "missing", "distance": 0.1},
    ]:
        with pytest.raises(EngineError):
            CadRequest.from_payload(request(tmp_path, geometry([defect], defect["id"])))


def test_swapped_fifo_is_rejected_without_waiting_for_a_writer(tmp_path, monkeypatch):
    if not hasattr(os, "mkfifo") or not hasattr(os, "O_NONBLOCK"):
        pytest.skip("FIFO replacement is a POSIX file boundary.")
    from phyra_engine.execution.cad import _read_assets

    digest = "0" * 64
    source = tmp_path / f"{digest}.step"
    os.mkfifo(source)
    # Model replacement after the path-based check but before the owned fd open.
    original_is_file = Path.is_file
    monkeypatch.setattr(Path, "is_file", lambda path: path == source or original_is_file(path))
    original_open = os.open

    def guarded_open(path, flags):
        assert flags & os.O_NONBLOCK  # A missing guard fails safely instead of hanging this test.
        return original_open(path, flags)

    monkeypatch.setattr(os, "open", guarded_open)
    definition = geometry(
        [
            {
                "id": "import",
                "name": "Import",
                "kind": "import-step",
                "assetId": "source",
                "scaleFactor": 1,
            }
        ],
        "import",
    )
    definition["assets"] = [
        {
            "id": "source",
            "kind": "step-source",
            "originalName": "source.step",
            "sha256": digest,
            "byteLength": 1,
        }
    ]
    with pytest.raises(EngineError) as error:
        _read_assets(CadRequest.from_payload(request(tmp_path, definition)))
    assert error.value.code == "invalid-cad-assets"


@pytest.mark.parametrize("solve", [False, True], ids=["malformed", "actual-open-sketch"])
def test_sketch_entry_does_not_load_shape_or_numerical_runtimes(tmp_path, solve):
    # The isolated authoring path works even when shape construction, numerical
    # orchestration, algorithms and the training runtime cannot load.
    script = """
import runpy
import sys

class BlockUnusedRuntimes:
    def find_spec(self, fullname, path=None, target=None):
        blocked = (
            'OCP',
            'torch',
            'phyra_engine.execution.worker',
            'phyra_engine.execution.application',
            'phyra_engine.methods',
            'phyra_engine.geometry.cad.kernel',
            'phyra_engine.geometry.cad.topology',
            'phyra_engine.geometry.cad.tessellation',
        )
        if any(fullname == name or fullname.startswith(name + '.') for name in blocked):
            raise AssertionError('Sketch loaded an unused runtime: ' + fullname)
        return None

sys.meta_path.insert(0, BlockUnusedRuntimes())
sys.argv = sys.argv[1:]
runpy.run_path(sys.argv[0], run_name='__main__')
"""
    payload = {}
    if solve:
        sketch = {
            "points": [{"id": "a", "position": [0, 0]}, {"id": "b", "position": [0.1, 0.02]}],
            "entities": [
                {"id": "line", "name": "Open line", "kind": "line", "startId": "a", "endId": "b"}
            ],
            "constraints": [
                {"id": "origin", "kind": "fixedPoint", "pointId": "a"},
                {"id": "horizontal", "kind": "horizontal", "lineId": "line"},
                {
                    "id": "length",
                    "kind": "distance",
                    "firstPointId": "a",
                    "secondPointId": "b",
                    "value": 0.08,
                },
            ],
            "loops": [],
        }
        payload = sketch_request(tmp_path, sketch)
    result = subprocess.run(
        [
            sys.executable,
            "-c",
            script,
            str(ROOT / "engine" / "entry.py"),
            "--cad",
            "--output",
            str(tmp_path),
        ],
        input=json.dumps(payload) + "\n",
        text=True,
        capture_output=True,
        cwd=tmp_path,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == (0 if solve else 2), result.stderr
    event = json.loads(result.stdout)
    if solve:
        assert event["type"] == "complete"
        manifest = event["manifest"]
        assert manifest["operation"] == "solve-sketch"
        assert manifest["report"]["status"] == "solved"
        assert manifest["report"]["degreesOfFreedom"] == 0
        assert manifest["report"]["failedConstraintIds"] == []
        np.testing.assert_allclose(
            [point["position"] for point in manifest["sketch"]["points"]],
            [[0, 0], [0.08, 0]],
            atol=1e-12,
        )
        assert manifest["sketch"]["constraints"] == sketch["constraints"]
        assert manifest["sketch"]["loops"] == []
    else:
        assert event["type"] == "error" and event["code"] == "invalid-request"
        assert event["jobId"] == "unknown"
    assert "Sketch loaded an unused runtime" not in result.stderr
    assert not list(tmp_path.iterdir())


def test_real_cad_worker_publishes_json_only_and_binary_receipt(tmp_path):
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine" / "entry.py"),
            "--cad",
            "--output",
            str(tmp_path / "output"),
        ],
        input=json.dumps(request(tmp_path)),
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(messages) == 1 and messages[0]["type"] == "complete"
    manifest = messages[0]["manifest"]
    blob = (tmp_path / "output" / "buffer.bin").read_bytes()
    assert len(blob) == manifest["byteLength"]
    assert hashlib.sha256(blob).hexdigest() == manifest["bufferHash"]
    assert manifest["statistics"]["volume"] == pytest.approx(0.0001)
    assert manifest["statistics"]["bodyCount"] == 1
    for name in ("output.step", "output-mm.step"):
        shape, _ = import_step((tmp_path / "output" / name).read_bytes())
        assert properties(shape, "body")[0] == pytest.approx(0.0001)


def test_tampered_or_symlink_source_fails_before_publication(tmp_path):
    source = export_step(build(geometry(), {}).shape)
    digest = hashlib.sha256(source).hexdigest()
    definition = geometry(
        [
            {
                "id": "import",
                "name": "Import",
                "kind": "import-step",
                "assetId": "source",
                "scaleFactor": 1,
            }
        ],
        "import",
    )
    definition["assets"] = [
        {
            "id": "source",
            "kind": "step-source",
            "originalName": "part.step",
            "sha256": digest,
            "byteLength": len(source),
        }
    ]
    path = tmp_path / (digest + ".step")
    path.write_bytes(source)
    manifest = execute(CadRequest.from_payload(request(tmp_path, definition)), tmp_path / "valid")
    assert manifest["statistics"]["volume"] == pytest.approx(0.0001)
    path.write_bytes(b"x" * len(source))
    with pytest.raises(EngineError, match="integrity"):
        execute(CadRequest.from_payload(request(tmp_path, definition)), tmp_path / "invalid")
    assert not (tmp_path / "invalid").exists()
    path.unlink()
    path.symlink_to(tmp_path / "missing.step")
    with pytest.raises(EngineError, match="missing"):
        execute(CadRequest.from_payload(request(tmp_path, definition)), tmp_path / "invalid")


def sketch_request(tmp_path, sketch):
    feature = {
        "id": "sketch",
        "name": "Authoring sketch",
        "kind": "sketch",
        "plane": "xy",
        "sketch": sketch,
    }
    # An unrelated invalid finish demonstrates that solve-only never evaluates
    # the output dependency closure or source bytes of other features.
    broken = {
        "id": "finish",
        "name": "Inactive failure",
        "kind": "fillet",
        "inputId": "box",
        "edgeIds": ["missing"],
        "radius": 0.1,
    }
    payload = request(tmp_path, geometry([BOX, feature, broken], "finish"))
    payload.update(operation="solve-sketch", featureId="sketch")
    return payload


@pytest.mark.parametrize("blank", [False, True])
def test_solve_only_actual_blank_and_open_graph_dof_has_no_shape_publication(tmp_path, blank):
    sketch = {"points": [], "entities": [], "constraints": [], "loops": []}
    if not blank:
        sketch.update(
            points=[{"id": "a", "position": [0, 0]}, {"id": "b", "position": [0.1, 0.01]}],
            entities=[
                {"id": "line", "name": "Open line", "kind": "line", "startId": "a", "endId": "b"}
            ],
            constraints=[{"id": "horizontal", "kind": "horizontal", "lineId": "line"}],
        )
    payload = sketch_request(tmp_path, sketch)
    original = deepcopy(payload)
    # The root is intentionally absent: authoring requires no imported bytes.
    payload["assetRoot"] = str(tmp_path / "absent-assets")
    decoded = CadRequest.from_payload(payload)
    receipt = execute(decoded, tmp_path / "no-output")
    assert receipt["operation"] == "solve-sketch"
    assert receipt["report"]["status"] == "solved"
    assert receipt["report"]["degreesOfFreedom"] == (0 if blank else 3)
    assert receipt["featureId"] == "sketch" and receipt["revision"] == 3
    assert receipt["geometryFingerprint"] == hashlib.sha256(decoded._geometry_json).hexdigest()
    assert receipt["sketch"]["loops"] == []
    assert receipt["sketch"]["constraints"] == sketch["constraints"]
    if not blank:
        positions = [point["position"] for point in receipt["sketch"]["points"]]
        assert positions[0][1] == pytest.approx(positions[1][1], abs=1e-13)
        assert [point["id"] for point in receipt["sketch"]["points"]] == ["a", "b"]
    assert not (tmp_path / "no-output").exists()
    assert payload["geometry"] == original["geometry"]


def test_solve_only_conflict_returns_original_graph_and_actual_failed_dimensions(tmp_path):
    sketch = {
        "points": [{"id": "a", "position": [0, 0]}, {"id": "b", "position": [0.1, 0]}],
        "entities": [{"id": "line", "name": "Line", "kind": "line", "startId": "a", "endId": "b"}],
        "constraints": [
            {
                "id": "short",
                "kind": "distance",
                "firstPointId": "a",
                "secondPointId": "b",
                "value": 0.1,
            },
            {
                "id": "long",
                "kind": "distance",
                "firstPointId": "a",
                "secondPointId": "b",
                "value": 0.2,
            },
        ],
        "loops": [],
    }
    receipt = execute(
        CadRequest.from_payload(sketch_request(tmp_path, sketch)), tmp_path / "no-output"
    )
    assert receipt["report"]["status"] == "conflicting"
    assert receipt["report"]["degreesOfFreedom"] is None
    assert {"short", "long"}.issubset(receipt["report"]["failedConstraintIds"])
    assert receipt["sketch"] == sketch
    assert not (tmp_path / "no-output").exists()


def test_solve_only_actual_worker_circle_dimension_and_request_boundary(tmp_path):
    sketch = {
        "points": [{"id": "center", "position": [0.02, 0.03]}],
        "entities": [
            {
                "id": "circle",
                "name": "Circle",
                "kind": "circle",
                "centerId": "center",
                "radius": 0.01,
            }
        ],
        "constraints": [{"id": "diameter", "kind": "diameter", "curveId": "circle", "value": 0.05}],
        "loops": [],
    }
    payload = sketch_request(tmp_path, sketch)
    result = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine" / "entry.py"),
            "--cad",
            "--output",
            str(tmp_path / "no-output"),
        ],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    messages = [json.loads(line) for line in result.stdout.splitlines()]
    assert len(messages) == 1 and messages[0]["type"] == "complete"
    manifest = messages[0]["manifest"]
    assert manifest["report"]["degreesOfFreedom"] == 2
    assert manifest["sketch"]["entities"][0]["radius"] == pytest.approx(0.025, rel=1e-12)
    assert manifest["report"]["kernel"] == "SolveSpace 3.2"
    assert not (tmp_path / "no-output").exists()
    for forged in (
        {**payload, "featureId": "box"},
        {**payload, "featureId": "missing"},
        {**payload, "arbitraryScript": "forbidden"},
    ):
        with pytest.raises(EngineError, match="request|sketch"):
            CadRequest.from_payload(forged)
