"""Independent exact geometry and failure references for the real native sketch solver."""

import re
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from dataclasses import FrozenInstanceError
from math import pi

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.geometry.profile import profile_area
from phyra_engine.geometry.sketch_constraints import build_profile, decode_sketch, solve_sketch
from phyra_engine.studies.project import validate_cad_geometry


def line_sketch():
    return {
        "points": [{"id": "p0", "position": [0, 0]}, {"id": "p1", "position": [0.12, 0.01]}],
        "entities": [
            {"id": "line", "name": "Line", "kind": "line", "startId": "p0", "endId": "p1"}
        ],
        "constraints": [],
        "loops": [],
    }


def rectangle():
    return {
        "points": [
            {"id": name, "position": position}
            for name, position in (
                ("p0", [0, 0]),
                ("p1", [0.12, 0.01]),
                ("p2", [0.11, 0.07]),
                ("p3", [-0.01, 0.06]),
            )
        ],
        "entities": [
            {"id": name, "name": name, "kind": "line", "startId": a, "endId": b}
            for name, a, b in (
                ("bottom", "p0", "p1"),
                ("right", "p1", "p2"),
                ("top", "p2", "p3"),
                ("left", "p3", "p0"),
            )
        ],
        "constraints": [
            {"id": "origin", "kind": "fixedPoint", "pointId": "p0"},
            {"id": "h-bottom", "kind": "horizontal", "lineId": "bottom"},
            {"id": "h-top", "kind": "horizontal", "lineId": "top"},
            {"id": "v-right", "kind": "vertical", "lineId": "right"},
            {"id": "v-left", "kind": "vertical", "lineId": "left"},
            {
                "id": "width",
                "kind": "distance",
                "firstPointId": "p0",
                "secondPointId": "p1",
                "value": 0.1,
            },
            {
                "id": "height",
                "kind": "distance",
                "firstPointId": "p0",
                "secondPointId": "p3",
                "value": 0.05,
            },
        ],
        "loops": [
            {"id": "outer", "role": "outer", "entityIds": ["bottom", "right", "top", "left"]}
        ],
    }


@pytest.mark.parametrize("kind, degrees_of_freedom", [("line", 4), ("circle", 3), ("arc", 5)])
def test_canonical_unicode_entity_names_survive_native_solving(kind, degrees_of_freedom):
    name = "界" * 200
    sketch = {
        "points": [{"id": "center", "position": [0, 0]}],
        "entities": [{"id": "entity", "name": name, "kind": kind}],
        "constraints": [],
        "loops": [],
    }
    entity = sketch["entities"][0]
    if kind == "circle":
        entity.update(centerId="center", radius=0.1)
    else:
        sketch["points"].append({"id": "start", "position": [0.1, 0]})
        entity.update(startId="center", endId="start")
        if kind == "arc":
            sketch["points"].append({"id": "end", "position": [0, 0.1]})
            entity.update(centerId="center", startId="start", endId="end", clockwise=False)
    original = deepcopy(sketch)
    geometry = {
        "kind": "cad",
        "dimension": "2d",
        "features": [
            {"id": "sketch", "name": "Sketch", "kind": "sketch", "plane": "xy", "sketch": sketch}
        ],
        "outputFeatureId": "sketch",
        "assets": [],
    }
    assert validate_cad_geometry(geometry) == geometry
    solved = solve_sketch(sketch)
    assert solved.status == "solved"
    assert solved.degrees_of_freedom == degrees_of_freedom
    assert solved.entities[0].name == name
    assert sketch == original


@pytest.mark.parametrize("name", ["", "界" * 201])
def test_entity_names_outside_canonical_bounds_fail_before_native_loading(name):
    sketch = line_sketch()
    sketch["entities"][0]["name"] = name
    with pytest.raises(EngineError, match="1–200 characters") as error:
        decode_sketch(sketch)
    assert error.value.code == "invalid-sketch"


def test_native_degrees_of_freedom_without_hidden_anchor():
    sketch = line_sketch()
    assert solve_sketch(sketch).degrees_of_freedom == 4
    sketch["constraints"].append({"id": "origin", "kind": "fixedPoint", "pointId": "p0"})
    assert solve_sketch(sketch).degrees_of_freedom == 2
    sketch["constraints"].append({"id": "horizontal", "kind": "horizontal", "lineId": "line"})
    assert solve_sketch(sketch).degrees_of_freedom == 1
    sketch["constraints"].append(
        {
            "id": "length",
            "kind": "distance",
            "firstPointId": "p0",
            "secondPointId": "p1",
            "value": 0.1,
        }
    )
    solved = solve_sketch(sketch)
    assert solved.status == "solved" and solved.degrees_of_freedom == 0
    np.testing.assert_allclose(
        [point.position for point in solved.points], [[0, 0], [0.1, 0]], atol=1e-12
    )


def test_rectangle_matches_independent_si_dimensions_and_preserves_input():
    sketch = rectangle()
    original = deepcopy(sketch)
    result = solve_sketch(sketch)
    assert result.status == "solved" and result.degrees_of_freedom == 0
    np.testing.assert_allclose(
        [point.position for point in result.points],
        [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]],
        atol=1e-12,
    )
    profile, metadata = build_profile(sketch)
    assert metadata["degreesOfFreedom"] == 0
    assert profile_area(profile) == pytest.approx(0.005, rel=1e-13)
    assert sketch == original
    with pytest.raises(FrozenInstanceError):
        result.points[0].id = "changed"


def test_compiled_boundaries_encode_opaque_ids_and_preserve_source_mapping():
    sketch = rectangle()
    renamed = {item["id"]: f"7:{item['id']} β" for item in sketch["entities"]}
    for entity in sketch["entities"]:
        entity["id"] = renamed[entity["id"]]
    for constraint in sketch["constraints"]:
        if "lineId" in constraint:
            constraint["lineId"] = renamed[constraint["lineId"]]
    sketch["loops"][0]["entityIds"] = list(renamed.values())
    profile, metadata = build_profile(sketch)
    identifiers = [item["id"] for item in profile["outer"]]
    assert len(set(identifiers)) == 4
    assert all(re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,99}", n) for n in identifiers)
    assert set(metadata["boundaryEntities"].values()) == set(renamed.values())
    assert build_profile(sketch)[0] == profile


def test_conflict_identifies_dimensions_and_does_not_publish_failed_coordinates():
    sketch = rectangle()
    sketch["constraints"].append(
        {
            "id": "different-width",
            "kind": "distance",
            "firstPointId": "p0",
            "secondPointId": "p1",
            "value": 0.2,
        }
    )
    result = solve_sketch(sketch)
    assert result.status == "conflicting"
    assert result.degrees_of_freedom is None
    assert {"width", "different-width"}.issubset(result.failed_constraint_ids)
    assert [point.position for point in result.points] == [
        tuple(point["position"]) for point in sketch["points"]
    ]
    with pytest.raises(EngineError, match="conflicting"):
        build_profile(sketch)
    # A subsequent independent sketch is unaffected by the native global state.
    assert solve_sketch(rectangle()).status == "solved"


def test_redundant_constraint_is_reported_separately_from_conflict():
    sketch = rectangle()
    # A redundant equation is consistent at the independently known rectangle.
    for point, position in zip(
        sketch["points"], [[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]], strict=True
    ):
        point["position"] = position
    sketch["constraints"].append(
        {"id": "duplicate-horizontal", "kind": "horizontal", "lineId": "bottom"}
    )
    result = solve_sketch(sketch)
    assert result.status == "redundant" and result.degrees_of_freedom == 0
    assert {"h-bottom", "duplicate-horizontal"}.issubset(result.failed_constraint_ids)


@pytest.mark.parametrize("kind, expected", [("parallel", [0.1, 0]), ("perpendicular", [0, 0.1])])
def test_equal_length_and_line_relationships_match_analytic_vectors(kind, expected):
    sketch = {
        "points": [
            {"id": "origin", "position": [0, 0]},
            {"id": "reference", "position": [0.1, 0]},
            {"id": "end", "position": [0.09, 0.07]},
        ],
        "entities": [
            {"id": name, "name": name, "kind": "line", "startId": "origin", "endId": point}
            for name, point in (("first", "reference"), ("second", "end"))
        ],
        "constraints": [
            {"id": "origin-fixed", "kind": "fixedPoint", "pointId": "origin"},
            {"id": "reference-fixed", "kind": "fixedPoint", "pointId": "reference"},
            {
                "id": "equal",
                "kind": "equalLength",
                "firstLineId": "first",
                "secondLineId": "second",
            },
            {"id": "relationship", "kind": kind, "firstLineId": "first", "secondLineId": "second"},
        ],
        "loops": [],
    }
    solved = solve_sketch(sketch)
    assert solved.status == "solved" and solved.degrees_of_freedom == 0
    np.testing.assert_allclose(solved.points[2].position, expected, atol=1e-12)


def test_explicit_coincidence_and_equal_radius_are_solved_without_guessed_merges():
    sketch = {
        "points": [
            {"id": "first-center", "position": [0, 0]},
            {"id": "second-center", "position": [0.01, 0.02]},
        ],
        "entities": [
            {"id": name, "name": name, "kind": "circle", "centerId": center, "radius": radius}
            for name, center, radius in (
                ("first", "first-center", 0.05),
                ("second", "second-center", 0.07),
            )
        ],
        "constraints": [
            {"id": "fixed", "kind": "fixedPoint", "pointId": "first-center"},
            {
                "id": "same-center",
                "kind": "coincident",
                "firstPointId": "first-center",
                "secondPointId": "second-center",
            },
            {"id": "dimension", "kind": "diameter", "curveId": "first", "value": 0.1},
            {
                "id": "same-radius",
                "kind": "equalRadius",
                "firstCurveId": "first",
                "secondCurveId": "second",
            },
        ],
        "loops": [],
    }
    solved = solve_sketch(sketch)
    assert solved.status == "solved" and solved.degrees_of_freedom == 0
    np.testing.assert_allclose(
        [point.position for point in solved.points], [[0, 0], [0, 0]], atol=1e-12
    )
    np.testing.assert_allclose([item.radius for item in solved.entities], [0.05, 0.05], atol=1e-12)


def test_circle_diameter_and_exact_semicircle_profile():
    sketch = {
        "points": [{"id": "center", "position": [0, 0]}],
        "entities": [
            {"id": "circle", "name": "Disc", "kind": "circle", "centerId": "center", "radius": 0.06}
        ],
        "constraints": [
            {"id": "center-fixed", "kind": "fixedPoint", "pointId": "center"},
            {"id": "diameter", "kind": "diameter", "curveId": "circle", "value": 0.1},
        ],
        "loops": [{"id": "disc", "role": "outer", "entityIds": ["circle"]}],
    }
    result = solve_sketch(sketch)
    assert result.status == "solved" and result.degrees_of_freedom == 0
    assert result.entities[0].radius == pytest.approx(0.05, abs=1e-12)
    profile, _ = build_profile(sketch)
    assert len(profile["outer"]) == 2
    assert profile_area(profile) == pytest.approx(pi * 0.05**2, rel=1e-13)


def test_arc_intrinsic_radius_and_quarter_circle_area():
    sketch = {
        "points": [
            {"id": "center", "position": [0, 0]},
            {"id": "start", "position": [0.1, 0]},
            {"id": "end", "position": [0.01, 0.12]},
        ],
        "entities": [
            {
                "id": "bottom",
                "name": "Bottom",
                "kind": "line",
                "startId": "center",
                "endId": "start",
            },
            {
                "id": "arc",
                "name": "Arc",
                "kind": "arc",
                "centerId": "center",
                "startId": "start",
                "endId": "end",
                "clockwise": False,
            },
            {"id": "left", "name": "Left", "kind": "line", "startId": "end", "endId": "center"},
        ],
        "constraints": [
            {"id": "center-fixed", "kind": "fixedPoint", "pointId": "center"},
            {"id": "start-fixed", "kind": "fixedPoint", "pointId": "start"},
            {"id": "left-vertical", "kind": "vertical", "lineId": "left"},
        ],
        "loops": [{"id": "quarter", "role": "outer", "entityIds": ["bottom", "arc", "left"]}],
    }
    result = solve_sketch(sketch)
    assert result.status == "solved" and result.degrees_of_freedom == 0
    np.testing.assert_allclose(result.points[2].position, [0, 0.1], atol=1e-12)
    profile, _ = build_profile(sketch)
    assert profile_area(profile) == pytest.approx(pi * 0.1**2 / 4, rel=1e-12)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda s: s["points"].append(deepcopy(s["points"][0])),
        lambda s: s["points"][0].update(position=[True, 0]),
        lambda s: s["points"][0].update(position=[float("inf"), 0]),
        lambda s: s["points"][0].update(position=[10**10000, 0]),
        lambda s: s["entities"][0].update(startId="absent"),
        lambda s: s["entities"][0].update(executable="/tmp/arbitrary"),
        lambda s: s["constraints"].append(
            {"id": "wrong", "kind": "diameter", "curveId": "bottom", "value": 0.1}
        ),
        lambda s: s["constraints"].extend([s["constraints"][0]] * 513),
    ],
)
def test_malformed_graph_is_rejected_before_native_loading(mutate):
    sketch = rectangle()
    mutate(sketch)
    with pytest.raises(EngineError) as error:
        decode_sketch(sketch)
    assert error.value.code == "invalid-sketch"


def test_native_solves_are_rejected_outside_worker_main_thread():
    with ThreadPoolExecutor(max_workers=1) as executor:
        with pytest.raises(EngineError, match="owned CAD worker"):
            executor.submit(solve_sketch, rectangle()).result()


def test_open_loop_is_preserved_and_cannot_be_applied_as_profile():
    sketch = line_sketch()
    sketch["loops"] = [{"id": "outer", "role": "outer", "entityIds": ["line"]}]
    assert decode_sketch(sketch).loops[0].entity_ids == ("line",)
    with pytest.raises(EngineError, match="not closed"):
        build_profile(sketch)
