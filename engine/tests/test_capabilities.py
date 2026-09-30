"""Capabilities describe exactly the methods executed by the local worker."""

import json
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from jsonschema import Draft7Validator

from phyra_engine.errors import EngineError
from phyra_engine.execution import devices as device_runtime
from phyra_engine.execution.registry import (
    METHODS,
    capabilities,
    execute_method,
    generate_study_mesh,
    methods_for_operation,
)
from phyra_engine.geometry.regions import SOLID_REGIONS
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.methods.classical.solid import solve_mesh

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def actual_capabilities():
    return capabilities()


def validator():
    schema = json.loads(
        (ROOT / "contracts/engine-capabilities.schema.json").read_text(encoding="utf-8")
    )
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def test_capability_contract_matches_actual_registered_methods(actual_capabilities):
    validator().validate(actual_capabilities)
    assert [value["id"] for value in actual_capabilities["methods"]] == [
        method.id for method in METHODS
    ]
    assert actual_capabilities["materialModels"] == ["homogeneous-isotropic-linear-elastic"]
    assert actual_capabilities["meshing"][0]["geometryKinds"] == list(SOLID_REGIONS)
    for method in actual_capabilities["methods"]:
        if method["kind"] == "fem":
            assert [device["id"] for device in method["devices"]] == ["cpu"]
            assert method["devices"][0]["precision"] == "float64"
    neural = actual_capabilities["methods"][2]
    assert [(device["id"], device["precision"]) for device in neural["devices"]] == [
        ("cpu", "float64"),
        ("mps", "float32"),
        ("cuda", "float64"),
    ]
    assert all(
        type(device["available"]) is bool and device["reason"] for device in neural["devices"]
    )


def test_a_supplied_probe_is_reused_without_reprobing(actual_capabilities, monkeypatch):
    inventory = actual_capabilities["methods"][2]["devices"]

    def fail_if_probed():
        raise AssertionError("The existing derivative probe must be reused.")

    monkeypatch.setattr(device_runtime, "device_capabilities", fail_if_probed)
    assert capabilities(inventory)["methods"][2]["devices"] == inventory


@pytest.mark.parametrize(
    "defect", ["method", "backend", "material", "fem-device", "precision", "unknown"]
)
def test_capability_schema_rejects_unimplemented_or_misrepresented_support(
    actual_capabilities, defect
):
    wrong = deepcopy(actual_capabilities)
    if defect == "method":
        wrong["methods"][2]["id"] = "unimplemented-operator"
    elif defect == "backend":
        wrong["execution"]["backend"] = "remote"
    elif defect == "material":
        wrong["materialModels"] = ["orthotropic"]
    elif defect == "fem-device":
        wrong["methods"][0]["devices"][0]["id"] = "cuda"
    elif defect == "precision":
        wrong["methods"][2]["devices"][1]["precision"] = "float64"
    else:
        wrong["execution"]["distributed"] = True
    assert list(validator().iter_errors(wrong))


def test_classical_dispatch_reuses_the_actual_verified_method(project, cube):
    (method,) = methods_for_operation(project, "solve")
    actual = execute_method(method, cube, project["study"])
    expected = solve_mesh(cube, project["study"])
    for key in ("displacement", "stress", "vonMises", "reactions"):
        np.testing.assert_array_equal(actual[key], expected[key])
    assert isinstance(generate_study_mesh(project), Mesh)


def test_two_dimensional_dispatch_is_explicit_and_shares_mesh_locations():
    project = json.loads((ROOT / "examples/plane-stress-tension.json").read_text(encoding="utf-8"))
    project["study"]["solver"]["kind"] = "fem"
    project["study"]["solver"]["pinn"].update(
        layers=1, width=8, steps=1, interiorPoints=8, boundaryPoints=4, device="cpu"
    )
    mesh = generate_study_mesh(project)
    assert isinstance(mesh, Mesh2D)
    reference, prediction = methods_for_operation(project, "compare")
    classical = execute_method(reference, mesh, project["study"])
    neural = execute_method(prediction, mesh, project["study"])
    assert classical["displacement"].shape == neural["displacement"].shape == mesh.positions.shape
    assert classical["stress"].shape == neural["stress"].shape == (len(mesh.cells), 6)
    assert all(np.isfinite(neural[key]).all() for key in ("displacement", "stress", "reactions"))
    assert methods_for_operation(project, "solve") == (reference,)
    assert methods_for_operation(project, "train") == (prediction,)
    assert methods_for_operation(project, "mesh") == ()


def test_dispatch_rejects_a_method_that_does_not_match_the_study(project, cube):
    with pytest.raises(EngineError, match="not implemented"):
        methods_for_operation(project, "train")
    with pytest.raises(EngineError, match="dimensions disagree"):
        execute_method(METHODS[2], cube, project["study"])
    project["study"]["formulation"] = "plane-stress"
    with pytest.raises(EngineError, match="not implemented"):
        methods_for_operation(project, "solve")
