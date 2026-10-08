"""Exact source-face identity across independent remeshes and failed interchange."""

import io
import math
import xml.etree.ElementTree as ET
from dataclasses import replace
from pathlib import Path

import gmsh
import numpy as np
import pytest
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace, BRepBuilderAPI_Transform
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakeSphere
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Ax1, gp_Dir, gp_Pln, gp_Pnt, gp_Trsf, gp_Vec
from OCP.TopAbs import TopAbs_FACE
from OCP.TopTools import TopTools_FormatVersion_VERSION_3

from phyra_engine.geometry.cad.topology import entities, properties, subshapes
from phyra_engine.meshing import cad_correspondence as correspondence
from phyra_engine.meshing.cad import generate_cad_mesh


def serialize(shape):
    stream = io.BytesIO()
    BRepTools.Write_s(shape, stream, False, False, TopTools_FormatVersion_VERSION_3)
    return stream.getvalue()


def test_box_face_identity_matches_independent_plane_locations_across_remeshing():
    shape = BRepPrimAPI_MakeBox(gp_Pnt(-70, 110, -230), 100, 50, 20).Shape()
    source = {e.reference: e.metadata() for e in entities(shape, "placed", "face")}
    sizes, mappings = (0.015, 0.009), []
    for size in sizes:
        inspected = generate_cad_mesh(shape, size, owner_id="placed")
        assert inspected.correspondence.reason is None
        assert set(inspected.correspondence.face_ids) == set(source)
        mesh = inspected.mesh
        mappings.append(set(inspected.correspondence.face_ids))
        for index, face_id in enumerate(inspected.correspondence.face_ids):
            bounds = np.array(source[face_id]["bounds"])
            axis = int(np.argmin(bounds[1] - bounds[0]))
            # Independently inspect every triangle vertex on each actual plane.
            points = mesh.positions[mesh.surface[mesh.surface_regions == index]]
            np.testing.assert_allclose(points[:, :, axis], bounds[0, axis], atol=1e-14, rtol=0)
    assert mappings[0] == mappings[1]


@pytest.mark.parametrize("kind", ["sphere", "cylinder"])
def test_rotated_translated_curved_faces_have_exact_identity_or_explicit_unavailability(kind):
    shape = (
        BRepPrimAPI_MakeSphere(10).Shape()
        if kind == "sphere"
        else BRepPrimAPI_MakeCylinder(10, 30).Shape()
    )
    transform = gp_Trsf()
    transform.SetRotation(gp_Ax1(gp_Pnt(), gp_Dir(1, 2, -3)), 0.731)
    transform.SetTranslationPart(gp_Vec(-120, 83, -64))
    shape = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    source = {entity.reference for entity in entities(shape, "curved", "face")}
    checked = generate_cad_mesh(shape, 0.004, owner_id="curved")
    if checked.correspondence.reason:
        # Exact interchange may change the last bit of an arbitrary frame. It
        # must never be accepted by adding coordinate rounding or tolerances.
        assert not checked.correspondence.face_ids
        assert "exact" in checked.correspondence.reason
    else:
        assert set(checked.correspondence.face_ids) == source


def test_canonicalization_preserves_negative_coordinates_tolerances_orientation_and_source_flags():
    shape = BRepPrimAPI_MakeBox(gp_Pnt(-100, -50, -20), 100, 50, 20).Shape()
    face = subshapes(shape, TopAbs_FACE)[0]
    before = serialize(face)
    checked = face.Checked()
    canonical = correspondence.canonical_face_bytes(face)
    assert serialize(face) == before and face.Checked() == checked
    assert b"-100" in canonical
    mapping = correspondence._shape_map(face)
    saved = [
        (mapping.FindKey(index), mapping.FindKey(index).Checked())
        for index in range(1, mapping.Extent() + 1)
    ]
    for child, _ in saved:
        child.Checked(False)
    try:
        expected = serialize(face).split()
        assert canonical.split() == [b"0" if token == b"-0" else token for token in expected]
    finally:
        for child, was_checked in saved:
            child.Checked(was_checked)
    assert correspondence.canonical_face_bytes(face.Reversed()) != canonical
    moved = gp_Trsf()
    moved.SetTranslation(gp_Vec(1e-9, 0, 0))
    assert (
        correspondence.canonical_face_bytes(BRepBuilderAPI_Transform(face, moved, True).Shape())
        != canonical
    )


def test_same_area_and_centroid_do_not_establish_exact_surface_identity():
    # Equal centered area on orthogonal supports defeats area/centroid matching.
    first = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(), gp_Dir(0, 0, 1)), -1, 1, -1, 1).Shape()
    second = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(), gp_Dir(0, 1, 0)), -1, 1, -1, 1).Shape()
    first_area, first_center = properties(first, "face")
    second_area, second_center = properties(second, "face")
    assert first_area == second_area
    np.testing.assert_allclose(first_center, second_center, atol=1e-18, rtol=0)
    assert correspondence.canonical_face_bytes(first) != correspondence.canonical_face_bytes(second)


@pytest.mark.parametrize(
    "change", ["reverse", "swap", "missing", "duplicate", "external", "entity"]
)
def test_xao_table_order_is_irrelevant_but_changed_references_cannot_publish_partial_matches(
    monkeypatch, change
):
    original = gmsh.write

    def changed(filename):
        original(filename)
        path = Path(filename)
        if path.suffix != ".xao":
            return
        root = ET.fromstring(path.read_bytes())
        table = root.find("geometry/topology/faces")
        assert table is not None
        if change == "reverse":
            table[:] = list(reversed(table))
        elif change == "swap":
            first, second = table[0].get("reference"), table[1].get("reference")
            table[0].set("reference", second)
            table[1].set("reference", first)
        elif change == "missing":
            table.remove(table[0])
        elif change == "duplicate":
            table[1].set("reference", table[0].get("reference"))
        elif change == "external":
            root.find("geometry/shape").set("file", "/untrusted/shape.brep")
        if change == "entity":
            path.write_bytes(b'<!DOCTYPE XAO [<!ENTITY test "bad">]>' + ET.tostring(root))
        else:
            path.write_bytes(ET.tostring(root))

    monkeypatch.setattr(gmsh, "write", changed)
    result = generate_cad_mesh(BRepPrimAPI_MakeBox(100, 50, 20).Shape(), 0.015)
    assert len(result.mesh.cells) > 0
    if change == "reverse":
        assert len(result.correspondence.face_ids) == 6
        assert result.correspondence.reason is None
    else:
        assert result.correspondence.face_ids == ()
        assert 0 < len(result.correspondence.reason.encode()) <= 500


def test_ambiguous_source_faces_refuse_the_entire_correspondence_without_mesher_export(monkeypatch):
    face = entities(BRepPrimAPI_MakeBox(100, 50, 20).Shape(), "box", "face")[0]
    ambiguous = replace(face, ambiguous=True)

    def forbidden(*_):
        pytest.fail("An ambiguous source must be rejected before accessing Gmsh.")

    monkeypatch.setattr(gmsh, "write", forbidden)
    result = correspondence.verify_cad_correspondence((ambiguous,), None, (1,))
    assert not result.face_ids
    assert "ambiguous" in result.reason


@pytest.mark.parametrize("limit", ["bytes", "export"])
def test_correspondence_resource_or_export_failure_preserves_mesh_without_claiming_source_faces(
    monkeypatch, limit
):
    if limit == "bytes":
        monkeypatch.setattr(correspondence, "MAX_BUFFER_BYTES", 1)
    else:

        def failed_export(_):
            raise Exception("XAO unavailable in this mesher build")

        monkeypatch.setattr(gmsh, "write", failed_export)
    result = generate_cad_mesh(BRepPrimAPI_MakeBox(100, 50, 20).Shape(), 0.015)
    assert len(result.mesh.cells) > 0
    assert result.correspondence.face_ids == ()
    assert 0 < len(result.correspondence.reason.encode()) <= 500


def test_sphere_mapping_covers_the_independent_analytic_boundary():
    radius = 0.01
    result = generate_cad_mesh(BRepPrimAPI_MakeSphere(radius * 1000).Shape(), 0.004)
    assert len(result.correspondence.face_ids) == 1
    assert result.correspondence.reason is None
    points = result.mesh.positions[np.unique(result.mesh.surface)]
    np.testing.assert_allclose(np.linalg.norm(points, axis=1), radius, rtol=0, atol=1e-14)
    assert result.exact_surface_area == pytest.approx(4 * math.pi * radius**2, rel=1e-12)
