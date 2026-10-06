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
from phyra_engine.geometry.cad.topology import entities, properties, selected_edges, subshapes
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
