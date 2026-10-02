"""Copied boundary metadata, explicit schema upgrades and unchanged physical caches."""

import hashlib
import json
from copy import deepcopy
from pathlib import Path

import pytest

from phyra_engine.errors import EngineError
from phyra_engine.meshing.plane_stress import generate_rectangle
from phyra_engine.meshing.solid import generate_solid
from phyra_engine.methods.classical.plane_stress import solve_mesh as solve_plane
from phyra_engine.methods.classical.solid import solve_mesh as solve_solid
from phyra_engine.results import validate_cached
from phyra_engine.results.plane_stress import write_output as write_plane
from phyra_engine.results.solid import write_output as write_solid
from phyra_engine.studies.project import fingerprint, migrate_project, validate_project

ROOT = Path(__file__).resolve().parents[2]


def example(name="cantilever"):
    return json.loads((ROOT / "examples" / f"{name}.json").read_text())


def selection():
    return {
        "id": "root",
        "name": "Root boundaries",
        "geometryKind": "box",
        "dimension": "3d",
        "regions": ["x0", "z0"],
    }


def test_unused_orphaned_boundary_sets_do_not_change_authoritative_assignments():
    project = example("cylinder")
    constraints = deepcopy(project["study"]["constraints"])
    project["namedSelections"] = [selection()]
    assert validate_project(project) == project
    assert project["study"]["constraints"] == constraints
    project["namedSelections"][0]["regions"] = ["y0"]
    assert validate_project(project) == project
    assert project["study"]["constraints"] == constraints


def test_profile_boundary_sets_accept_stable_ids_and_preserve_orphans():
    project = example("kirsch-quarter")
    project["namedSelections"] = [
        {
            "id": "saved-profile-edge",
            "name": "Earlier profile edge",
            "geometryKind": "profile",
            "dimension": "2d",
            "regions": ["edge-from-prior-profile"],
        }
    ]
    assert validate_project(project) == project


def test_version_three_upgrade_preserves_sets_and_physical_digest():
    prior = example("cantilever")
    prior["schemaVersion"] = 3
    prior["namedSelections"] = [selection()]
    expected_fingerprint = fingerprint(prior)
    upgraded = migrate_project(prior)
    assert upgraded["schemaVersion"] == 4
    assert upgraded["namedSelections"] == prior["namedSelections"]
    assert fingerprint(upgraded) == expected_fingerprint


@pytest.mark.parametrize(
    "defect",
    [
        "blank-name",
        "blank-feff",
        "blank-control",
        "blank-id",
        "duplicate-id",
        "duplicate-name",
        "duplicate-control-name",
        "empty",
        "duplicate-region",
        "wrong-region",
        "wrong-dimension",
        "unsupported-plane",
        "oversized",
        "unknown-key",
        "missing-collection",
    ],
)
def test_boundary_sets_reject_malformed_identity_topology_and_unbounded_work(defect):
    project = example()
    sets = [selection()]
    if defect == "blank-name":
        sets[0]["name"] = "   "
    elif defect == "blank-feff":
        sets[0]["name"] = "\ufeff"
    elif defect == "blank-control":
        sets[0]["name"] = "\u001c"
    elif defect == "blank-id":
        sets[0]["id"] = "   "
    elif defect == "duplicate-id":
        sets.append({**selection(), "name": "Other"})
    elif defect == "duplicate-name":
        sets.append({**selection(), "id": "other", "name": "  ROOT boundaries  "})
    elif defect == "duplicate-control-name":
        sets.append({**selection(), "id": "other", "name": "\u001cROOT boundaries\ufeff"})
    elif defect == "empty":
        sets[0]["regions"] = []
    elif defect == "duplicate-region":
        sets[0]["regions"] = ["x0", "x0"]
    elif defect == "wrong-region":
        sets[0]["regions"] = ["outer"]
    elif defect == "wrong-dimension":
        sets[0]["dimension"] = "2d"
    elif defect == "unsupported-plane":
        sets[0].update(dimension="2d", geometryKind="cylinder", regions=["x0"])
    elif defect == "oversized":
        sets = [
            {**selection(), "id": f"id-{index}", "name": f"Name {index}"} for index in range(101)
        ]
    elif defect == "unknown-key":
        sets[0]["selectionId"] = "not-a-linked-condition"
    project["namedSelections"] = sets
    if defect == "missing-collection":
        del project["namedSelections"]
    with pytest.raises(EngineError):
        validate_project(project)


def test_name_uniqueness_folds_only_ascii_and_preserves_non_ascii_identity():
    project = example()
    project["namedSelections"] = [
        {**selection(), "id": f"set-{index}", "name": name}
        for index, name in enumerate(["Straße", "STRASSE", "İ", "i"])
    ]
    assert validate_project(project) == project


def test_version_two_migration_preserves_exact_independent_canonical_digest():
    prior = example()
    prior["schemaVersion"] = 2
    del prior["namedSelections"]
    prior_copy = deepcopy(prior)
    canonical = {
        key: value
        for key, value in prior.items()
        if key not in {"name", "revision", "displayUnits"}
    }
    expected = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()
    upgraded = migrate_project(prior)
    assert prior == prior_copy
    assert upgraded["schemaVersion"] == 4
    assert upgraded["namedSelections"] == []
    assert upgraded["study"] == prior["study"]
    assert fingerprint(prior) == fingerprint(upgraded) == expected
    upgraded["namedSelections"] = [selection()]
    assert fingerprint(upgraded) == expected
    upgraded["study"]["loads"][0]["vector"][2] *= 2
    assert fingerprint(upgraded) != expected


@pytest.mark.parametrize("defect", ["extra-new-key", "invalid-pinn", "unknown-version"])
def test_version_two_is_validated_before_any_upgrade(defect):
    project = example()
    project["schemaVersion"] = 2
    del project["namedSelections"]
    if defect == "extra-new-key":
        project["namedSelections"] = []
    elif defect == "invalid-pinn":
        project["study"]["solver"]["pinn"]["steps"] = 0
    else:
        project["schemaVersion"] = 5
    with pytest.raises(EngineError):
        migrate_project(project)


@pytest.mark.parametrize("name", ["cantilever", "plane-stress-tension"])
def test_real_version_two_fields_survive_metadata_upgrade_and_corruption_still_fails(
    name, tmp_path
):
    prior = example(name)
    prior["schemaVersion"] = 2
    del prior["namedSelections"]
    geometry, study = prior["geometry"], prior["study"]
    if study["dimension"] == "3d":
        mesh = generate_solid(prior["geometry"], study["mesh"]["size"])
        result = solve_solid(mesh, study)
        manifest = write_solid(tmp_path, prior, "prior-solve", "solve", mesh, result)
    else:
        mesh = generate_rectangle(
            geometry["length"], geometry["width"], study["thickness"], study["mesh"]["size"]
        )
        result = solve_plane(mesh, study)
        manifest = write_plane(tmp_path, prior, "prior-solve", "solve", mesh, result)
    blob = (tmp_path / "buffer.bin").read_bytes()
    upgraded = migrate_project(prior)
    upgraded["namedSelections"] = [selection()]
    assert validate_cached(prior, manifest, blob) == manifest
    assert validate_cached(upgraded, manifest, blob) == manifest
    wrong = deepcopy(manifest)
    wrong["summary"]["maxDisplacement"] *= 2
    with pytest.raises(EngineError):
        validate_cached(upgraded, wrong, blob)
    upgraded["study"]["material"]["young"] *= 2
    with pytest.raises(EngineError) as error:
        validate_cached(upgraded, manifest, blob)
    assert error.value.code == "stale-cache"
