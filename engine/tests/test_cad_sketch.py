"""Independent CAD wire areas/volumes, exact major arcs and invalid nesting."""

import math
from copy import deepcopy

import pytest

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.compatibility import eligibility, lower_geometry
from phyra_engine.geometry.cad.kernel import build
from phyra_engine.geometry.cad.topology import entities, properties


def sketch():
    return {"points": [], "entities": [], "constraints": [], "loops": []}


def point(graph, identifier, position):
    graph["points"].append({"id": identifier, "position": position})
    graph["constraints"].append(
        {"id": f"fix-{identifier}", "kind": "fixedPoint", "pointId": identifier}
    )


def polygon(graph, prefix, vertices, role="outer"):
    for i, position in enumerate(vertices):
        point(graph, f"{prefix}-p{i}", list(position))
    identifiers = []
    for i in range(len(vertices)):
        identifier = f"{prefix}-edge{i}"
        identifiers.append(identifier)
        graph["entities"].append(
            {
                "id": identifier,
                "name": identifier,
                "kind": "line",
                "startId": f"{prefix}-p{i}",
                "endId": f"{prefix}-p{(i + 1) % len(vertices)}",
            }
        )
    graph["loops"].append({"id": prefix, "role": role, "entityIds": identifiers})


def definition(graph, plane="xy", extruded=False):
    source = {
        "id": "sketch",
        "name": "Exact CAD sketch",
        "kind": "sketch",
        "plane": plane,
        "sketch": graph,
    }
    features = [source]
    if extruded:
        features.append(
            {
                "id": "extrude",
                "name": "Extrusion",
                "kind": "extrude",
                "sketchId": "sketch",
                "distance": 0.02,
            }
        )
    return {
        "kind": "cad",
        "dimension": "3d" if extruded else "2d",
        "features": features,
        "outputFeatureId": features[-1]["id"],
        "assets": [],
    }


@pytest.mark.parametrize("plane", ["xy", "xz", "yz"])
def test_polygonal_and_arc_holes_exact_cad_area_extrusion_and_unsupported_numerics(plane):
    graph = sketch()
    polygon(graph, "outer", [(0, 0), (0.1, 0), (0.1, 0.05), (0, 0.05)])
    # A clockwise triangle verifies that authored orientation is independent
    # of the explicit hole role and is retained unchanged in source history.
    polygon(graph, "triangle", [(0.01, 0.01), (0.01, 0.02), (0.03, 0.01)], "hole")
    for identifier, position in (
        ("center", [0.07, 0.025]),
        ("a", [0.08, 0.025]),
        ("b", [0.06, 0.025]),
    ):
        point(graph, identifier, position)
    graph["entities"].extend(
        [
            {
                "id": "arc",
                "name": "Semicircle",
                "kind": "arc",
                "centerId": "center",
                "startId": "a",
                "endId": "b",
                "clockwise": False,
            },
            {"id": "diameter", "name": "Diameter", "kind": "line", "startId": "b", "endId": "a"},
        ]
    )
    graph["loops"].append({"id": "arc-hole", "role": "hole", "entityIds": ["arc", "diameter"]})
    source = definition(graph, plane)
    original = deepcopy(source)
    expected = 0.1 * 0.05 - 0.02 * 0.01 / 2 - math.pi * 0.01**2 / 2
    assert properties(build(source, {}).shape, "face")[0] == pytest.approx(expected, rel=1e-12)
    assert properties(build(definition(graph, plane, True), {}).shape, "body")[0] == pytest.approx(
        expected * 0.02, rel=1e-12
    )
    assert source == original
    assert eligibility(source)["state"] == "unsupported"
    with pytest.raises(EngineError):
        lower_geometry(source)


@pytest.mark.parametrize("clockwise", [False, True])
def test_directed_major_arc_encloses_analytical_circular_segment(clockwise):
    graph = sketch()
    radius = 0.02
    end_y = radius if clockwise else -radius
    for identifier, position in (("center", [0, 0]), ("start", [radius, 0]), ("end", [0, end_y])):
        point(graph, identifier, position)
    graph["entities"] = [
        {
            "id": "arc",
            "name": "270 degree arc",
            "kind": "arc",
            "centerId": "center",
            "startId": "start",
            "endId": "end",
            "clockwise": clockwise,
        },
        {
            "id": "chord",
            "name": "Closing chord",
            "kind": "line",
            "startId": "end",
            "endId": "start",
        },
    ]
    graph["loops"] = [{"id": "outer", "role": "outer", "entityIds": ["arc", "chord"]}]
    expected = radius**2 * (3 * math.pi / 2 + 1) / 2
    source = definition(graph)
    assert properties(build(source, {}).shape, "face")[0] == pytest.approx(expected, rel=1e-12)
    assert properties(build(definition(graph, extruded=True), {}).shape, "body")[
        0
    ] == pytest.approx(expected * 0.02, rel=1e-12)
    assert eligibility(source)["state"] == "unsupported"


@pytest.mark.parametrize(
    "problem",
    ["self-intersection", "outside-hole", "crossing-hole", "overlapping-holes", "open-identity"],
)
def test_invalid_wires_rejected_without_geometric_healing_or_source_changes(problem):
    graph = sketch()
    polygon(graph, "outer", [(0, 0), (0.1, 0), (0.1, 0.05), (0, 0.05)])
    if problem == "self-intersection":
        graph = sketch()
        polygon(graph, "outer", [(0, 0), (0.1, 0.05), (0, 0.04), (0.09, 0)])
    elif problem == "outside-hole":
        polygon(graph, "hole", [(0.2, 0.01), (0.22, 0.01), (0.22, 0.02), (0.2, 0.02)], "hole")
    elif problem == "crossing-hole":
        polygon(graph, "hole", [(0.09, 0.01), (0.11, 0.01), (0.11, 0.02), (0.09, 0.02)], "hole")
    elif problem == "overlapping-holes":
        polygon(graph, "hole1", [(0.01, 0.01), (0.04, 0.01), (0.04, 0.03), (0.01, 0.03)], "hole")
        polygon(graph, "hole2", [(0.03, 0.02), (0.05, 0.02), (0.05, 0.04), (0.03, 0.04)], "hole")
    else:
        point(graph, "separate-origin", [0, 0])
        graph["entities"][-1]["endId"] = "separate-origin"
    original = deepcopy(graph)
    with pytest.raises(EngineError) as error:
        build(definition(graph), {})
    assert error.value.code in ("invalid-cad-sketch", "open-cad-sketch")
    assert graph == original


def test_exact_outer_circle_keeps_unique_semicircle_numerical_region_links():
    graph = sketch()
    point(graph, "center", [0, 0])
    graph["entities"] = [
        {"id": "circle", "name": "Circle", "kind": "circle", "centerId": "center", "radius": 0.02}
    ]
    graph["loops"] = [{"id": "outer", "role": "outer", "entityIds": ["circle"]}]
    source = definition(graph)
    shape = build(source, {}).shape
    faces = [row.metadata() for row in entities(shape, "sketch", "face")]
    edges = [row.metadata() for row in entities(shape, "sketch", "edge")]
    assert properties(shape, "face")[0] == pytest.approx(math.pi * 0.02**2, rel=1e-12)
    assert len(edges) == 2
    bindings = eligibility(source, faces, edges)["regionBindings"]
    assert len(bindings) == 2 and all(row["sourceEntityId"] == "circle" for row in bindings)
    assert all(len(row["entityIds"]) == 1 for row in bindings)
    assert bindings[0]["entityIds"] != bindings[1]["entityIds"]
