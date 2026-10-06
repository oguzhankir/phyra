"""Exact authored CAD-to-results loops, independent mechanics and stale provenance."""

import hashlib
import json
import math
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.execution.application import RunPlan
from phyra_engine.execution.application import execute as execute_study
from phyra_engine.execution.cad import execute as execute_cad
from phyra_engine.geometry.cad.compatibility import eligibility, lower_geometry
from phyra_engine.geometry.cad.kernel import build
from phyra_engine.geometry.cad.topology import properties
from phyra_engine.protocol.cad import CadRequest
from phyra_engine.protocol.request import StudyRequest
from phyra_engine.results import validate_cached
from phyra_engine.studies.project import fingerprint, numerical_view, validate_project

ROOT = Path(__file__).resolve().parents[2]


def rectangle_sketch():
    return {
        "id": "sketch",
        "name": "Rectangle sketch",
        "kind": "sketch",
        "plane": "xy",
        "sketch": {
            "points": [
                {"id": f"p{i}", "position": point}
                for i, point in enumerate([[0, 0], [0.1, 0], [0.1, 0.05], [0, 0.05]])
            ],
            "entities": [
                {
                    "id": name,
                    "name": name,
                    "kind": "line",
                    "startId": f"p{i}",
                    "endId": f"p{(i + 1) % 4}",
                }
                for i, name in enumerate(["bottom", "right", "top", "left"])
            ],
            "constraints": [],
            "loops": [
                {"id": "outer", "role": "outer", "entityIds": ["bottom", "right", "top", "left"]}
            ],
        },
    }


def geometry(features, dimension="3d"):
    return {
        "kind": "cad",
        "dimension": dimension,
        "features": features,
        "outputFeatureId": features[-1]["id"],
        "assets": [],
    }


def project(definition):
    plane = definition["dimension"] == "2d"
    value = json.loads(
        (
            ROOT / "examples" / ("plane-stress-tension.json" if plane else "cantilever.json")
        ).read_text()
    )
    value["geometry"] = definition
    value["namedSelections"] = []
    value["study"]["mesh"]["size"] = 0.025 if plane else 0.015
    if plane:
        for assignment in value["study"]["constraints"] + value["study"]["loads"]:
            name = {"x0": "left", "y0": "bottom", "x1": "right"}[assignment["regions"][0]]
            assignment["regions"] = ["cad-" + hashlib.sha256(name.encode()).hexdigest()[:32]]
    return value


def study_request(value, operation="solve"):
    return StudyRequest.from_payload(
        {"protocolVersion": 1, "jobId": "cad-analysis", "operation": operation, "project": value}
    )


def preview(tmp_path, definition):
    return execute_cad(
        CadRequest.from_payload(
            {
                "protocolVersion": 1,
                "jobId": "cad-preview",
                "projectId": "cad-project",
                "revision": 0,
                "geometry": definition,
                "assetRoot": str(tmp_path),
            }
        ),
        tmp_path / "preview",
    )


def test_actual_authored_sketch_and_extrusion_with_exact_source_bindings(tmp_path):
    sketch = rectangle_sketch()
    definition = geometry([sketch], "2d")
    original = deepcopy(definition)
    receipt = preview(tmp_path, definition)
    assert definition == original
    assert receipt["features"][0]["sketch"]["degreesOfFreedom"] == 8
    assert receipt["statistics"]["surfaceArea"] == pytest.approx(0.005, rel=1e-12)
    compatibility = receipt["analysisCompatibility"]
    assert compatibility["state"] == "supported"
    assert compatibility["methodIds"] == ["fem-plane-stress-tri3", "pinn-plane-stress-energy"]
    assert {row["sourceEntityId"] for row in compatibility["regionBindings"]} == {
        "bottom",
        "right",
        "top",
        "left",
    }
    assert all(len(row["entityIds"]) == 1 for row in compatibility["regionBindings"])
    extrusion = {
        "id": "extrude",
        "name": "Extrusion",
        "kind": "extrude",
        "sketchId": "sketch",
        "distance": 0.02,
    }
    solid = geometry([sketch, extrusion])
    assert properties(build(solid, {}).shape, "body")[0] == pytest.approx(0.0001, rel=1e-12)
    assert lower_geometry(solid)["kind"] == "box"
    bindings = preview(tmp_path, solid)["analysisCompatibility"]["regionBindings"]
    assert {row["regionId"] for row in bindings} == {"x0", "x1", "y0", "y1", "z0", "z1"}
    assert all(len(row["entityIds"]) == 1 for row in bindings)


@pytest.mark.parametrize("kind", ["box", "cylinder", "extrude"])
def test_real_solid_cad_fem_and_cache_preserve_authored_fingerprint(tmp_path, kind):
    if kind == "box":
        features = [
            {
                "id": "box",
                "name": "Box",
                "kind": "box",
                "length": 0.1,
                "width": 0.05,
                "height": 0.02,
            }
        ]
    elif kind == "cylinder":
        features = [
            {
                "id": "cylinder",
                "name": "Cylinder",
                "kind": "cylinder",
                "length": 0.05,
                "radius": 0.01,
            }
        ]
    else:
        features = [
            rectangle_sketch(),
            {
                "id": "extrude",
                "name": "Extrusion",
                "kind": "extrude",
                "sketchId": "sketch",
                "distance": 0.02,
            },
        ]
    source = project(geometry(features))
    original = deepcopy(source)
    manifest = execute_study(RunPlan.prepare(study_request(source)), tmp_path)
    assert source == original and source["geometry"]["kind"] == "cad"
    assert manifest["fingerprint"] == fingerprint(source)
    assert fingerprint(numerical_view(source)) != fingerprint(source)
    assert manifest["summary"]["relativeResidual"] < 1e-8
    assert manifest["summary"]["totalReaction"] == pytest.approx([0, 0, 100], abs=1e-7)
    blob = (tmp_path / "buffer.bin").read_bytes()
    assert validate_cached(source, manifest, blob) == manifest
    assert execute_study(RunPlan.prepare(study_request(source, "validate")), tmp_path) == manifest
    source["geometry"]["features"][-1]["name"] = "Revised source identity"
    with pytest.raises(EngineError) as error:
        validate_cached(source, manifest, blob)
    assert error.value.code == "stale-cache"


def test_real_xy_sketch_plane_stress_matches_independent_uniform_tension(tmp_path):
    source = project(geometry([rectangle_sketch()], "2d"))
    manifest = execute_study(RunPlan.prepare(study_request(source)), tmp_path)
    payload = (tmp_path / "buffer.bin").read_bytes()
    arrays = {
        key: np.frombuffer(
            payload, dtype="<f8", count=math.prod(descriptor["shape"]), offset=descriptor["offset"]
        ).reshape(descriptor["shape"])
        for key, descriptor in manifest["arrays"].items()
        if descriptor["dtype"] == "float64"
    }
    stress = 100 / (0.002 * 0.05)
    strain = stress / source["study"]["material"]["young"]
    positions = arrays["positions"]
    expected = np.column_stack(
        (strain * positions[:, 0], -0.3 * strain * positions[:, 1], np.zeros(len(positions)))
    )
    np.testing.assert_allclose(arrays["displacement"], expected, rtol=1e-10, atol=1e-18)
    np.testing.assert_allclose(
        arrays["stress"],
        np.tile([stress, 0, 0, 0, 0, 0], (len(arrays["stress"]), 1)),
        rtol=1e-10,
        atol=1e-6,
    )
    assert manifest["fingerprint"] == fingerprint(source)
    assert validate_cached(source, manifest, payload) == manifest
    with pytest.raises(EngineError, match="rectangular"):
        RunPlan.prepare(study_request(source, "train"))
    source["study"]["solver"]["pinn"]["formulation"] = "potential-energy"
    assert (
        RunPlan.prepare(study_request(source, "compare")).methods[-1].id
        == "pinn-plane-stress-energy"
    )


def test_general_cad_remains_saveable_but_cannot_enter_numerical_execution():
    features = [
        {"id": "box", "name": "Box", "kind": "box", "length": 0.1, "width": 0.05, "height": 0.02},
        {
            "id": "other",
            "name": "Other",
            "kind": "box",
            "length": 0.05,
            "width": 0.1,
            "height": 0.03,
        },
        {
            "id": "cut",
            "name": "Cut",
            "kind": "boolean",
            "operation": "cut",
            "leftId": "box",
            "rightId": "other",
        },
    ]
    source = project(geometry(features))
    assert validate_project(source) == source
    assert eligibility(source["geometry"])["state"] == "unsupported"
    with pytest.raises(EngineError) as error:
        study_request(source)
    assert error.value.code == "unsupported-cad-study"

    shifted = geometry(
        [
            rectangle_sketch(),
            {
                "id": "extrude",
                "name": "Extrusion",
                "kind": "extrude",
                "sketchId": "sketch",
                "distance": -0.02,
            },
        ]
    )
    assert eligibility(shifted)["state"] == "unsupported"


def test_actual_cad_energy_comparison_keeps_source_and_validated_trace(tmp_path):
    source = project(geometry([rectangle_sketch()], "2d"))
    source["study"]["solver"]["pinn"].update(
        formulation="potential-energy",
        device="cpu",
        layers=1,
        width=8,
        steps=1,
        interiorPoints=8,
        boundaryPoints=4,
    )
    original = deepcopy(source)
    manifest = execute_study(RunPlan.prepare(study_request(source, "compare")), tmp_path)
    assert source == original
    assert manifest["fingerprint"] == fingerprint(source)
    assert manifest["training"]["configuration"]["formulation"] == "potential-energy"
    assert manifest["training"]["history"][0]["jobId"] == "cad-analysis"
    assert math.isfinite(manifest["pinnSummary"]["maxDisplacement"])
    assert validate_cached(source, manifest, (tmp_path / "buffer.bin").read_bytes()) == manifest


def test_forged_primitive_cache_cannot_be_used_for_authored_cad(tmp_path):
    source = project(
        geometry(
            [
                {
                    "id": "box",
                    "name": "Box",
                    "kind": "box",
                    "length": 0.1,
                    "width": 0.05,
                    "height": 0.02,
                }
            ]
        )
    )
    primitive = numerical_view(source)
    manifest = execute_study(RunPlan.prepare(study_request(primitive)), tmp_path)
    with pytest.raises(EngineError) as error:
        validate_cached(source, manifest, (tmp_path / "buffer.bin").read_bytes())
    assert error.value.code == "stale-cache"


def test_rollback_uses_only_output_closure_and_headless_cad_validity(tmp_path):
    box = {"id": "box", "name": "Box", "kind": "box", "length": 0.1, "width": 0.05, "height": 0.02}
    broken = {
        "id": "finish",
        "name": "Broken finish",
        "kind": "fillet",
        "inputId": "box",
        "edgeIds": ["box/edge/unavailable"],
        "radius": 0.1,
    }
    source = project(geometry([box, broken]))
    source["geometry"]["outputFeatureId"] = "box"
    original = deepcopy(source)
    assert lower_geometry(source["geometry"])["kind"] == "box"
    receipt = preview(tmp_path, source["geometry"])
    assert [feature["id"] for feature in receipt["features"]] == ["box"]
    assert any(row["code"] == "inactive-history" for row in receipt["diagnostics"])
    assert source == original
    manifest = execute_study(RunPlan.prepare(study_request(source)), tmp_path / "study")
    assert manifest["fingerprint"] == fingerprint(source)
    source["geometry"]["outputFeatureId"] = "finish"
    with pytest.raises(EngineError) as error:
        build(source["geometry"], {})
    assert error.value.code == "cad-selection-repair"
    assert eligibility(source["geometry"])["state"] == "unsupported"
    with pytest.raises(EngineError) as error:
        study_request(source)
    assert error.value.code == "unsupported-cad-study"

    source["geometry"] = geometry([{**box, "length": 1e-50, "width": 1e-50, "height": 1e-50}])
    assert validate_project(source) == source
    with pytest.raises(EngineError):
        study_request(source)


@pytest.mark.parametrize("translation,angle", [([0, 0, 0], 0), ([0.1, 0.2, 0.3], 0.5)])
def test_rigid_placement_never_falls_back_to_unplaced_numerical_primitive(translation, angle):
    source = project(
        geometry(
            [
                {
                    "id": "box",
                    "name": "Box",
                    "kind": "box",
                    "length": 0.1,
                    "width": 0.05,
                    "height": 0.02,
                },
                {
                    "id": "placed",
                    "name": "Placed box",
                    "kind": "transform",
                    "inputId": "box",
                    "translation": translation,
                    "axisOrigin": [0, 0, 0],
                    "axisDirection": [0, 0, 1],
                    "angle": angle,
                },
            ]
        )
    )
    assert validate_project(source) == source
    assert properties(build(source["geometry"], {}).shape, "body")[0] == pytest.approx(0.0001)
    assert eligibility(source["geometry"])["state"] == "unsupported"
    with pytest.raises(EngineError, match="rigidly placed"):
        study_request(source)


def test_inactive_step_needs_no_source_bytes_for_exact_numerical_output():
    box = {"id": "box", "name": "Box", "kind": "box", "length": 0.1, "width": 0.05, "height": 0.02}
    imported = {
        "id": "import",
        "name": "Inactive import",
        "kind": "import-step",
        "assetId": "asset",
        "scaleFactor": 1,
    }
    definition = geometry([box, imported])
    definition["outputFeatureId"] = "box"
    definition["assets"] = [
        {
            "id": "asset",
            "kind": "step-source",
            "originalName": "inactive.step",
            "sha256": "0" * 64,
            "byteLength": 1,
        }
    ]
    source = project(definition)
    assert study_request(source).project_definition()["geometry"] == definition
    assert properties(build(definition, {}).shape, "body")[0] == pytest.approx(0.0001)
