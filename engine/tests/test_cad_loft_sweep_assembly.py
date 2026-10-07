"""Analytical loft/pipe measures and independent, unbonded instance ownership."""

import io
import math
from copy import deepcopy

import pytest
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform
from OCP.BRepTools import BRepTools
from OCP.gp import gp_Trsf, gp_Vec
from OCP.TopAbs import TopAbs_SOLID
from OCP.TopTools import TopTools_FormatVersion_VERSION_3

from phyra_engine.errors import EngineError
from phyra_engine.execution.cad import execute
from phyra_engine.geometry.cad.compatibility import eligibility
from phyra_engine.geometry.cad.kernel import build, export_step, import_step
from phyra_engine.geometry.cad.loft_sweep import loft, sweep
from phyra_engine.geometry.cad.sketch import sketch_face, sketch_spine
from phyra_engine.geometry.cad.topology import bounds, entities, properties, subshapes
from phyra_engine.protocol.cad import CadRequest


def graph(points, curves, loops=()):
    return {
        "points": [{"id": identifier, "position": position} for identifier, position in points],
        "entities": curves,
        "constraints": [
            {"id": f"fix-{identifier}", "kind": "fixedPoint", "pointId": identifier}
            for identifier, _ in points
        ],
        "loops": list(loops),
    }


def circle(identifier, radius, plane="xy"):
    return {
        "id": identifier,
        "name": identifier,
        "kind": "sketch",
        "plane": plane,
        "sketch": graph(
            [("center", [0, 0])],
            [
                {
                    "id": "circle",
                    "name": "Circle",
                    "kind": "circle",
                    "centerId": "center",
                    "radius": radius,
                }
            ],
            [{"id": "outer", "role": "outer", "entityIds": ["circle"]}],
        ),
    }


def path(vertices, arc=False):
    points = [(f"p{i}", list(position)) for i, position in enumerate(vertices)]
    if arc:
        points.append(("center", [0, 0.1]))
        curves = [
            {
                "id": "arc",
                "name": "Arc",
                "kind": "arc",
                "centerId": "center",
                "startId": "p0",
                "endId": "p1",
                "clockwise": False,
            }
        ]
    else:
        curves = [
            {
                "id": f"e{i}",
                "name": f"Line {i}",
                "kind": "line",
                "startId": f"p{i}",
                "endId": f"p{i + 1}",
            }
            for i in range(len(points) - 1)
        ]
    return {
        "id": "path",
        "name": "Path",
        "kind": "sketch",
        "plane": "xy",
        "purpose": "path",
        "sketch": graph(points, curves),
    }


def move(identifier, source, xyz):
    return {
        "id": identifier,
        "name": identifier,
        "kind": "transform",
        "inputId": source,
        "translation": xyz,
        "axisOrigin": [0, 0, 0],
        "axisDirection": [0, 0, 1],
        "angle": 0,
    }


def definition(features, output=None):
    return {
        "kind": "cad",
        "dimension": "3d",
        "features": features,
        "outputFeatureId": output or features[-1]["id"],
        "assets": [],
    }


@pytest.mark.parametrize("solid", [False, True])
@pytest.mark.parametrize("ruled", [False, True])
def test_circle_loft_exact_frustum_volume_and_lateral_area(solid, ruled):
    first, second = circle("first", 0.01), circle("second", 0.02)
    feature = {
        "id": "loft",
        "name": "Frustum",
        "kind": "loft",
        "sectionIds": ["first", "raised"],
        "solid": solid,
        "ruled": ruled,
    }
    source = definition([first, second, move("raised", "second", [0, 0, 0.1]), feature])
    original = deepcopy(source)
    result = build(source, {})
    assert source == original
    lateral = math.pi * (0.01 + 0.02) * math.hypot(0.1, 0.02 - 0.01)
    expected = lateral + (math.pi * (0.01**2 + 0.02**2) if solid else 0)
    assert properties(result.shape, "face")[0] == pytest.approx(expected, rel=1e-10)
    assert len(result.body_instances) == int(solid)
    if solid:
        assert properties(result.shape, "body")[0] == pytest.approx(
            math.pi * 0.1 * (0.01**2 + 0.01 * 0.02 + 0.02**2) / 3, rel=1e-10
        )
    assert eligibility(source)["state"] == "unsupported"


@pytest.mark.parametrize("solid", [False, True])
@pytest.mark.parametrize("curves", ["straight", "miter", "arc"])
def test_sweep_measures_analytical_pipe_reference(solid, curves):
    vertices = {
        "straight": [(0, 0), (0.1, 0)],
        "miter": [(0, 0), (0.1, 0), (0.1, 0.15)],
        "arc": [(0, 0), (0.1, 0.1)],
    }[curves]
    length = {"straight": 0.1, "miter": 0.25, "arc": 0.1 * math.pi / 2}[curves]
    source = definition(
        [
            circle("profile", 0.01, "yz"),
            path(vertices, curves == "arc"),
            {
                "id": "sweep",
                "name": "Pipe",
                "kind": "sweep",
                "profileId": "profile",
                "spineId": "path",
                "solid": solid,
            },
        ]
    )
    original = deepcopy(source)
    result = build(source, {})
    assert source == original
    assert len(result.body_instances) == int(solid)
    assert properties(result.shape, "face")[0] == pytest.approx(
        2 * math.pi * 0.01 * length + (2 * math.pi * 0.01**2 if solid else 0), rel=1e-9
    )
    if solid:
        assert properties(result.shape, "body")[0] == pytest.approx(
            math.pi * 0.01**2 * length, rel=1e-9
        )
    report = result.feature_metadata[1]["sketch"]
    assert report["startPointId"] == "p0" and report["endPointId"] == f"p{len(vertices) - 1}"


def test_transformed_path_and_profile_are_real_placed_sweep_inputs():
    source = definition(
        [
            circle("profile", 0.01, "yz"),
            path([(0, 0), (0.1, 0)]),
            move("placedProfile", "profile", [0, 0, 0.03]),
            move("placedPath", "path", [0, 0, 0.03]),
            {
                "id": "sweep",
                "name": "Placed pipe",
                "kind": "sweep",
                "profileId": "placedProfile",
                "spineId": "placedPath",
                "solid": True,
            },
        ]
    )
    result = build(source, {})
    assert properties(result.shape, "body")[0] == pytest.approx(math.pi * 0.01**2 * 0.1, rel=1e-10)
    assert properties(result.shape, "body")[1] == pytest.approx([0.05, 0, 0.03], abs=1e-12)


@pytest.mark.parametrize("problem", ["placement", "crossing", "branch", "oversized"])
def test_invalid_sweep_rejected_without_hidden_placement_or_self_intersection(problem):
    profile = circle(
        "profile",
        0.11 if problem == "oversized" else 0.01,
        "xy" if problem == "placement" else "yz",
    )
    spine = path(
        [(0, 0), (0.1, 0.1)] if problem == "oversized" else [(0, 0), (0.1, 0)],
        problem == "oversized",
    )
    if problem == "crossing":
        spine = path([(0, 0), (0.1, 0.1), (0, 0.1), (0.1, 0)])
    if problem == "branch":
        spine = path([(0, 0), (0.1, 0), (0.2, 0)])
        spine["sketch"]["points"].append({"id": "branch", "position": [0, 0.1]})
        spine["sketch"]["entities"].append(
            {"id": "branch", "name": "Branch", "kind": "line", "startId": "p1", "endId": "branch"}
        )
    source = definition(
        [
            profile,
            spine,
            {
                "id": "sweep",
                "name": "Invalid pipe",
                "kind": "sweep",
                "profileId": "profile",
                "spineId": "path",
                "solid": True,
            },
        ]
    )
    original = deepcopy(source)
    with pytest.raises(EngineError) as error:
        build(source, {})
    assert (
        error.value.code
        == {
            "placement": "sweep-profile-placement",
            "crossing": "invalid-sweep-spine",
            "branch": "invalid-sweep-spine",
            "oversized": "invalid-cad-operation",
        }[problem]
    )
    assert source == original


@pytest.mark.parametrize("offset", [[0, 0, 0], [0.001, 0, 0]])
def test_coincident_or_intersecting_loft_sections_are_not_zero_volume_successes(offset):
    source = definition(
        [
            circle("first", 0.01),
            circle("second", 0.02),
            move("raised", "second", offset),
            {
                "id": "loft",
                "name": "Invalid loft",
                "kind": "loft",
                "sectionIds": ["first", "raised"],
                "solid": True,
                "ruled": True,
            },
        ]
    )
    with pytest.raises(EngineError, match="coincide, touch or intersect"):
        build(source, {})


def box():
    return {
        "id": "box",
        "name": "Base",
        "kind": "box",
        "length": 0.1,
        "width": 0.05,
        "height": 0.02,
    }


def assembly(identifier, sources):
    return {
        "id": identifier,
        "name": identifier,
        "kind": "assembly",
        "components": [
            {"id": name, "name": f"Component {name}", "featureId": source}
            for name, source in sources
        ],
    }


@pytest.mark.parametrize("coincident", [False, True])
def test_separate_assembly_instances_have_exact_volume_unique_ids_and_body_relationships(
    coincident,
):
    source = definition(
        [
            box(),
            move("placed", "box", [0 if coincident else 0.2, 0, 0]),
            assembly("assembly", [("one", "box"), ("two", "placed")]),
        ]
    )
    original = deepcopy(source)
    result = build(source, {})
    solids = subshapes(result.shape, TopAbs_SOLID)
    assert len(solids) == 2 and not solids[0].IsSame(solids[1])
    assert properties(result.shape, "body")[0] == pytest.approx(0.0002, rel=1e-12)
    bodies = entities(result.shape, "assembly", "body", result.body_instances)
    assert len({body.reference for body in bodies}) == 2
    assert all(not body.ambiguous for body in bodies)
    metadata = [body.metadata() for body in bodies]
    assert {row["componentId"] for row in metadata} == {"one", "two"}
    assert {row["sourceFeatureId"] for row in metadata} == {"box", "placed"}
    for kind in ("face", "edge"):
        members = entities(result.shape, "assembly", kind, result.body_instances)
        assert all(
            member.metadata()["bodyId"] in {body.reference for body in bodies} for member in members
        )
        assert len({member.reference for member in members}) == len(members)
    for units in ("m", "mm"):
        restored, _ = import_step(export_step(result.shape, units))
        assert len(subshapes(restored, TopAbs_SOLID)) == 2
        assert properties(restored, "body")[0] == pytest.approx(0.0002, rel=1e-10)
    assert source == original


def test_nested_assembly_transform_preserves_component_paths_and_names():
    source = definition(
        [
            box(),
            assembly("inner", [("a", "box"), ("b", "box")]),
            assembly("outer", [("group", "inner"), ("single", "box")]),
            move("moved", "outer", [0.3, 0.2, 0.1]),
        ]
    )
    result = build(source, {})
    bodies = [
        body.metadata() for body in entities(result.shape, "moved", "body", result.body_instances)
    ]
    assert {tuple(body["componentPath"]) for body in bodies} == {
        ("group", "a"),
        ("group", "b"),
        ("single",),
    }
    assert {body["name"] for body in bodies} == {"Component group", "Component single"}
    assert {body["sourceFeatureId"] for body in bodies} == {"inner", "box"}
    assert properties(result.shape, "body")[0] == pytest.approx(0.0003, rel=1e-12)
    assert bounds(result.shape)[0] == pytest.approx([0.3, 0.2, 0.1], abs=1e-12)
    assert bounds(result.shape)[1] == pytest.approx([0.4, 0.25, 0.12], abs=1e-12)


def test_actual_worker_receipt_keeps_coincident_component_ids_and_unbonded_diagnostic(tmp_path):
    source = definition([box(), assembly("assembly", [("one", "box"), ("two", "box")])])
    source["features"][-1]["components"][0]["name"] = "🚀" * 200
    request = CadRequest.from_payload(
        {
            "protocolVersion": 1,
            "jobId": "job",
            "projectId": "project",
            "revision": 4,
            "geometry": source,
            "assetRoot": str(tmp_path),
        }
    )
    receipt = execute(request, tmp_path)
    bodies = receipt["bodies"]
    assert {body["componentId"] for body in bodies} == {"one", "two"}
    assert any(body["name"] == "🚀" * 200 for body in bodies)
    body_ids = {body["id"] for body in bodies}
    assert len(body_ids) == 2 and all(not body.get("ambiguous", False) for body in bodies)
    assert all(row["bodyId"] in body_ids for row in receipt["faces"] + receipt["edges"])
    assert all(len(row["id"]) <= 200 for row in receipt["faces"] + receipt["edges"] + bodies)
    assert receipt["statistics"]["volume"] == pytest.approx(0.0002, rel=1e-12)
    assert receipt["analysisCompatibility"]["state"] == "unsupported"
    assert any(row["code"] == "independent-components" for row in receipt["diagnostics"])


def test_open_path_cannot_be_selected_as_final_display_output():
    with pytest.raises(EngineError):
        build(definition([path([(0, 0), (0.1, 0)])]), {})


def exact_bytes(shape):
    stream = io.BytesIO()
    BRepTools.Write_s(shape, stream, False, False, TopTools_FormatVersion_VERSION_3)
    return stream.getvalue()


def test_loft_and_sweep_preserve_exact_source_topology_not_only_authored_graph():
    first, _ = sketch_face(circle("first", 0.01)["sketch"], "xy")
    transform = gp_Trsf()
    transform.SetTranslation(gp_Vec(0, 0, 100))
    second = BRepBuilderAPI_Transform(first, transform, True).Shape()
    before = (exact_bytes(first), exact_bytes(second))
    loft((first, second), True, False)
    assert (exact_bytes(first), exact_bytes(second)) == before
    profile, _ = sketch_face(circle("profile", 0.01, "yz")["sketch"], "yz")
    spine, report = sketch_spine(path([(0, 0), (0.1, 0), (0.1, 0.15)])["sketch"], "xy")
    before = (exact_bytes(profile), exact_bytes(spine))
    sweep(profile, spine, True)
    assert (exact_bytes(profile), exact_bytes(spine)) == before
    assert report["degreesOfFreedom"] == 0


def test_sweep_path_order_follows_authored_endpoints_not_entity_direction_or_array_order():
    spine = path([(0, 0), (0.1, 0), (0.1, 0.15)])
    for entity in spine["sketch"]["entities"]:
        entity["startId"], entity["endId"] = entity["endId"], entity["startId"]
    spine["sketch"]["entities"].reverse()
    source = definition(
        [
            circle("profile", 0.01, "yz"),
            spine,
            {
                "id": "sweep",
                "name": "Ordered",
                "kind": "sweep",
                "profileId": "profile",
                "spineId": "path",
                "solid": True,
            },
        ]
    )
    result = build(source, {})
    assert result.feature_metadata[1]["sketch"]["startPointId"] == "p0"
    assert properties(result.shape, "body")[0] == pytest.approx(math.pi * 0.01**2 * 0.25, rel=1e-10)


def test_nested_assembly_edge_budget_rejects_before_expanding_any_outer_component(monkeypatch):
    import phyra_engine.geometry.cad.kernel as kernel

    original_copy = kernel.BRepBuilderAPI_Copy
    copies = []

    def copy(shape, *args):
        copies.append(shape)
        return original_copy(shape, *args)

    monkeypatch.setattr(kernel, "BRepBuilderAPI_Copy", copy)
    source = definition(
        [
            box(),
            assembly("inner", [(f"c{i}", "box") for i in range(6)]),
            assembly("outer", [(f"g{i}", "inner") for i in range(32)]),
        ]
    )
    # 192 bodies and 1152 faces fit; 2304 independent edges cannot publish.
    with pytest.raises(EngineError) as error:
        build(source, {})
    assert error.value.code == "cad-resource-limit"
    assert len(copies) == 6


def test_surface_loft_cannot_be_an_assembly_component():
    source = definition(
        [
            circle("profile", 0.01),
            move("raised", "profile", [0, 0, 0.1]),
            {
                "id": "shell",
                "name": "Shell",
                "kind": "loft",
                "sectionIds": ["profile", "raised"],
                "solid": False,
                "ruled": True,
            },
            assembly("assembly", [("surface", "shell")]),
        ]
    )
    with pytest.raises(EngineError) as error:
        build(source, {})
    assert error.value.code == "unsupported-assembly-member"


def test_component_edge_finish_before_assembly_works_but_assembly_finish_is_explicitly_rejected():
    source = build(definition([box()]), {})
    edge_id = entities(source.shape, "box", "edge")[0].reference
    finish = {
        "id": "round",
        "name": "Round",
        "kind": "fillet",
        "inputId": "box",
        "edgeIds": [edge_id],
        "radius": 0.001,
    }
    result = build(definition([box(), finish, assembly("assembly", [("rounded", "round")])]), {})
    assert len(result.body_instances) == 1
    assembled_edge = entities(result.shape, "assembly", "edge", result.body_instances)[0].reference
    finish_assembly = {**finish, "inputId": "assembly", "edgeIds": [assembled_edge]}
    with pytest.raises(EngineError) as error:
        build(definition([box(), assembly("assembly", [("base", "box")]), finish_assembly]), {})
    assert error.value.code == "unsupported-assembly-finish"


def test_maximum_component_ids_have_bounded_distinct_display_references():
    result = build(
        definition([box(), assembly("a" * 100, [("x" * 100, "box"), ("y" * 100, "box")])]), {}
    )
    rows = [
        entity
        for kind in ("face", "edge", "body")
        for entity in entities(result.shape, "a" * 100, kind, result.body_instances)
    ]
    assert all(len(entity.reference.encode("utf-8")) <= 200 for entity in rows)
    assert len({entity.reference for entity in rows}) == len(rows)
