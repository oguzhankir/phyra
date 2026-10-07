"""Frozen v6 intent, explicit v7 upgrades and bounded ordered CAD dependencies."""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest

from phyra_engine.errors import EngineError
from phyra_engine.studies.project import fingerprint, migrate_project, validate_project

ROOT = Path(__file__).resolve().parents[2]


def document(features=None):
    value = json.loads((ROOT / "examples/cantilever.json").read_text())
    value["schemaVersion"] = 7
    value["study"] = None
    value["namedSelections"] = []
    features = features or [
        {"id": "box", "name": "Box", "kind": "box", "length": 0.1, "width": 0.05, "height": 0.02}
    ]
    value["geometry"] = {
        "kind": "cad",
        "dimension": "3d",
        "assets": [],
        "features": features,
        "outputFeatureId": features[-1]["id"],
    }
    return value


def construction(kind):
    sections = [
        {
            "id": name,
            "name": name,
            "kind": "sketch",
            "plane": plane,
            "sketch": {"points": [], "entities": [], "constraints": [], "loops": []},
        }
        for name, plane in [("first", "xy"), ("second", "xz")]
    ]
    feature = {"id": "operation", "name": "Operation", "kind": kind}
    if kind == "loft":
        feature.update(sectionIds=["first", "second"], solid=True, ruled=False)
    elif kind == "sweep":
        feature.update(profileId="first", spineId="second", solid=True)
    else:
        feature["components"] = [
            {"id": "component-1", "name": "First", "featureId": "first"},
            {"id": "component-2", "name": "Second", "featureId": "second"},
        ]
    return document([*sections, feature])


@pytest.mark.parametrize("kind", ["numerical", "cad", "empty"])
def test_version_six_upgrade_changes_only_version_and_preserves_original(kind):
    prior = document()
    prior["schemaVersion"] = 6
    if kind == "numerical":
        prior = json.loads((ROOT / "examples/cantilever.json").read_text())
        prior["schemaVersion"] = 6
    elif kind == "empty":
        prior["geometry"] = {"kind": "empty", "dimension": "3d"}
    original = deepcopy(prior)
    upgraded = migrate_project(prior)
    assert prior == original
    original["schemaVersion"] = 7
    assert upgraded == original
    assert validate_project(upgraded) == upgraded
    if kind != "empty":
        assert fingerprint(upgraded) == fingerprint(prior)


def test_version_six_cad_fingerprint_matches_independent_original_canonical_digest():
    prior = document()
    prior["schemaVersion"] = 6
    canonical = {
        key: value
        for key, value in prior.items()
        if key not in {"name", "revision", "displayUnits", "namedSelections"}
    }
    expected = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    assert fingerprint(prior) == fingerprint(migrate_project(prior)) == expected
    upgraded = migrate_project(prior)
    upgraded["geometry"]["features"][0]["length"] *= 2
    assert fingerprint(upgraded) != expected


@pytest.mark.parametrize("kind", ["loft", "sweep", "assembly"])
def test_new_operations_require_v7_and_preserve_distinct_physical_digest(kind):
    current = construction(kind)
    assert validate_project(current) == current
    original = deepcopy(current)
    assert migrate_project(current) == current and current == original
    canonical = {
        key: value
        for key, value in current.items()
        if key not in {"name", "revision", "displayUnits", "namedSelections"}
    }
    expected = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    assert fingerprint(current) == expected
    previous = deepcopy(current)
    previous["schemaVersion"] = 6
    original = deepcopy(previous)
    with pytest.raises(EngineError):
        migrate_project(previous)
    assert previous == original


@pytest.mark.parametrize("kind", ["loft", "sweep", "assembly"])
@pytest.mark.parametrize("reference", ["absent", "operation"])
def test_new_operation_dependencies_must_precede_the_feature(kind, reference):
    value = construction(kind)
    feature = value["geometry"]["features"][-1]
    if kind == "loft":
        feature["sectionIds"][1] = reference
    elif kind == "sweep":
        feature["spineId"] = reference
    else:
        feature["components"][1]["featureId"] = reference
    with pytest.raises(EngineError, match="earlier feature"):
        validate_project(value)


@pytest.mark.parametrize("defect", ["duplicate-id", "blank-name", "blank-control-name", "too-many"])
def test_assembly_component_identity_names_and_counts_are_bounded(defect):
    value = construction("assembly")
    components = value["geometry"]["features"][-1]["components"]
    if defect == "duplicate-id":
        components[1]["id"] = components[0]["id"]
    elif defect == "blank-name":
        components[0]["name"] = "   "
    elif defect == "blank-control-name":
        components[0]["name"] = "\u001c\ufeff"
    else:
        components[:] = [
            {"id": f"instance-{index}", "name": "Instance", "featureId": "first"}
            for index in range(33)
        ]
    with pytest.raises(EngineError):
        validate_project(value)


@pytest.mark.parametrize("defect", ["duplicate", "too-few", "too-many", "nonboolean"])
def test_loft_sections_and_options_are_bounded(defect):
    value = construction("loft")
    feature = value["geometry"]["features"][-1]
    if defect == "duplicate":
        feature["sectionIds"] = ["first", "first"]
    elif defect == "too-few":
        feature["sectionIds"] = ["first"]
    elif defect == "too-many":
        feature["sectionIds"] = [f"section-{index}" for index in range(17)]
    else:
        feature["solid"] = 1
    with pytest.raises(EngineError):
        validate_project(value)


def test_unknown_version_and_invalid_v6_input_are_not_repaired_by_migration():
    for version in [6, 8]:
        value = document()
        value["schemaVersion"] = version
        value["geometry"]["features"][0]["length"] = -1
        original = deepcopy(value)
        with pytest.raises(EngineError):
            migrate_project(value)
        assert value == original


def test_explicit_sketch_purpose_is_preserved_as_distinct_version_seven_intent():
    value = construction("loft")
    value["geometry"]["features"] = value["geometry"]["features"][:1]
    value["geometry"]["outputFeatureId"] = "first"
    original_digest = fingerprint(value)
    value["geometry"]["features"][0]["purpose"] = "path"
    assert validate_project(value) == value
    assert fingerprint(value) != original_digest
    assert migrate_project(value) == value
    previous = deepcopy(value)
    previous["schemaVersion"] = 6
    original = deepcopy(previous)
    with pytest.raises(EngineError):
        migrate_project(previous)
    assert previous == original
