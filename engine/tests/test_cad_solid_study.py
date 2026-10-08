"""Real exact-CAD study execution with independent elasticity and cache evidence."""

import hashlib
import json
import math
import os
import subprocess
import sys
from copy import deepcopy
from dataclasses import FrozenInstanceError
from pathlib import Path

import numpy as np
import pytest

from phyra_engine.errors import EngineError
from phyra_engine.execution.application import RunPlan, execute
from phyra_engine.execution.cad import execute as execute_cad
from phyra_engine.geometry.cad.kernel import build, export_step
from phyra_engine.meshing import cad as cad_meshing
from phyra_engine.meshing.cad_correspondence import CadCorrespondence
from phyra_engine.meshing.solid import tetra_volumes
from phyra_engine.protocol.cad import CadRequest
from phyra_engine.protocol.request import StudyRequest
from phyra_engine.results import validate_cached
from phyra_engine.studies.cad import geometry_fingerprint
from phyra_engine.studies.mesh import generate_study_mesh
from phyra_engine.studies.project import fingerprint, migrate_project, validate_project

ROOT = Path(__file__).resolve().parents[2]


def geometry(hole=False, rotated=False):
    features = [
        {"id": "box", "kind": "box", "name": "Box", "length": 0.1, "width": 0.05, "height": 0.02}
    ]
    output = "box"
    if hole:
        features += [
            {"id": "tool", "kind": "cylinder", "name": "Tool", "length": 0.1, "radius": 0.005},
            {
                "id": "placed",
                "kind": "transform",
                "name": "Placed tool",
                "inputId": "tool",
                "translation": [0, 0.025, 0.01],
                "axisOrigin": [0, 0, 0],
                "axisDirection": [1, 0, 0],
                "angle": 0,
            },
            {
                "id": "cut",
                "kind": "boolean",
                "name": "Through hole",
                "operation": "cut",
                "leftId": "box",
                "rightId": "placed",
            },
        ]
        output = "cut"
    if rotated:
        features.append(
            {
                "id": "moved",
                "kind": "transform",
                "name": "Rotated part",
                "inputId": output,
                "translation": [-0.2, 0.3, -0.4],
                "axisOrigin": [0, 0, 0],
                "axisDirection": [0, 0, 1],
                "angle": math.pi / 2,
            }
        )
        output = "moved"
    return {
        "kind": "cad",
        "dimension": "3d",
        "features": features,
        "assets": [],
        "outputFeatureId": output,
    }


def project_for(tmp_path, shape=None):
    value = json.loads((ROOT / "examples/extension.json").read_text())
    value.update(schemaVersion=8, namedSelections=[], geometry=shape or geometry())
    # Reproduce the native serde object's sorted key ordering, not a test-only
    # inferred face map. The domain comes from a real exact CAD receipt.
    value["geometry"] = json.loads(json.dumps(value["geometry"], sort_keys=True))
    receipt = execute_cad(
        CadRequest.from_payload(
            {
                "protocolVersion": 1,
                "operation": "cad",
                "projectId": value["id"],
                "revision": value["revision"],
                "jobId": "cad-study-source",
                "geometry": value["geometry"],
                "assetRoot": str(tmp_path),
            }
        ),
        tmp_path / "cad-source",
    )
    faces = {face["id"]: face for face in receipt["faces"]}
    boundaries = [
        {
            "id": "cad-" + hashlib.sha256(face.encode()).hexdigest(),
            "faceId": face,
            "name": record["name"],
        }
        for face, record in faces.items()
    ]
    value["study"].update(
        constraints=[],
        loads=[],
        mesh={"size": 0.015},
        domain={
            "kind": "cad-solid",
            "geometryFingerprint": receipt["geometryFingerprint"],
            "outputFeatureId": value["geometry"]["outputFeatureId"],
            "boundaries": boundaries,
        },
    )
    assert receipt["geometryFingerprint"] == geometry_fingerprint(value["geometry"])
    return value, faces


def request(project, operation="solve", asset_root=None):
    return StudyRequest.from_payload(
        {
            "protocolVersion": 1,
            "jobId": "cad-solid-run",
            "operation": operation,
            "project": project,
        },
        asset_root=asset_root,
    )


def axis_face(project, faces, axis, side):
    low = np.min([record["bounds"][0] for record in faces.values()], axis=0)
    high = np.max([record["bounds"][1] for record in faces.values()], axis=0)
    coordinate = (low if side == 0 else high)[axis]
    selected = [
        boundary["id"]
        for boundary in project["study"]["domain"]["boundaries"]
        if np.allclose(
            np.asarray(faces[boundary["faceId"]]["bounds"])[:, axis], coordinate, rtol=0, atol=1e-12
        )
    ]
    assert len(selected) == 1
    return selected[0]


def rollers(project, faces):
    project["study"]["constraints"] = []
    for axis in range(3):
        components = [None, None, None]
        components[axis] = 0
        project["study"]["constraints"].append(
            {
                "id": f"roller-{axis}",
                "name": "Roller",
                "regions": [axis_face(project, faces, axis, 0)],
                "components": components,
            }
        )


def read_array(manifest, buffer, name):
    descriptor = manifest["arrays"][name]
    return np.frombuffer(
        buffer,
        dtype="<f8" if descriptor["dtype"] == "float64" else "<u4",
        offset=descriptor["offset"],
        count=np.prod(descriptor["shape"]),
    ).reshape(descriptor["shape"])


@pytest.mark.parametrize("rotated", [False, True])
def test_exact_cad_tension_matches_analytic_displacement_stress_energy_and_reactions(
    tmp_path, rotated
):
    project, faces = project_for(tmp_path, geometry(rotated=rotated))
    rollers(project, faces)
    sigma = 2e6
    loaded = axis_face(project, faces, 0, 1)
    boundary = next(b for b in project["study"]["domain"]["boundaries"] if b["id"] == loaded)
    force = sigma * faces[boundary["faceId"]]["area"]
    project["study"]["loads"] = [
        {
            "id": "tension",
            "name": "Tension",
            "regions": [loaded],
            "kind": "force",
            "vector": [force, 0, 0],
            "pressure": 0,
        }
    ]
    original = deepcopy(project)
    out = tmp_path / "run"
    manifest = execute(RunPlan.prepare(request(project)), out)
    assert project == original
    buffer = (out / "buffer.bin").read_bytes()
    points = read_array(manifest, buffer, "positions")
    displacement, stress = (
        read_array(manifest, buffer, name) for name in ("displacement", "stress")
    )
    young, poisson = (project["study"]["material"][name] for name in ("young", "poisson"))
    expected = (points - points.min(axis=0)) * [
        sigma / young,
        -poisson * sigma / young,
        -poisson * sigma / young,
    ]
    np.testing.assert_allclose(displacement, expected, rtol=1e-8, atol=1e-14)
    np.testing.assert_allclose(stress[:, 0], sigma, rtol=1e-8)
    np.testing.assert_allclose(stress[:, 1:], 0, rtol=0, atol=sigma * 1e-8)
    assert manifest["summary"]["strainEnergy"] == pytest.approx(
        sigma**2 / (2 * young) * 0.1 * 0.05 * 0.02, rel=1e-8
    )
    np.testing.assert_allclose(
        manifest["summary"]["totalReaction"], [-force, 0, 0], atol=force * 1e-8
    )
    assert manifest["summary"]["relativeForceBalance"] < 1e-8
    assert manifest["summary"]["relativeMomentBalance"] < 1e-8
    assert manifest["fingerprint"] == fingerprint(project)
    assert [r["id"] for r in manifest["regions"]] == [
        b["id"] for b in project["study"]["domain"]["boundaries"]
    ]


def test_curved_cavity_pressure_and_remesh_keep_exact_face_assignments(tmp_path):
    project, faces = project_for(tmp_path, geometry(hole=True))
    rollers(project, faces)
    pressure = 2e6
    project["study"]["loads"] = [
        {
            "id": "pressure",
            "name": "Hydrostatic pressure",
            "regions": [b["id"] for b in project["study"]["domain"]["boundaries"]],
            "kind": "pressure",
            "vector": [0, 0, 0],
            "pressure": pressure,
        }
    ]
    counts = []
    for index, size in enumerate((0.015, 0.008)):
        project["study"]["mesh"]["size"] = size
        manifest = execute(RunPlan.prepare(request(project)), tmp_path / f"run-{index}")
        blob = (tmp_path / f"run-{index}" / "buffer.bin").read_bytes()
        points, cells, displacement, stress = (
            read_array(manifest, blob, name)
            for name in ("positions", "cells", "displacement", "stress")
        )
        young, poisson = (project["study"]["material"][name] for name in ("young", "poisson"))
        strain = -pressure * (1 - 2 * poisson) / young
        np.testing.assert_allclose(displacement, strain * points, rtol=1e-8, atol=1e-14)
        np.testing.assert_allclose(stress[:, :3], -pressure, rtol=1e-8)
        np.testing.assert_allclose(stress[:, 3:], 0, atol=pressure * 1e-8)
        volume = tetra_volumes(points, cells).sum()
        assert manifest["summary"]["strainEnergy"] == pytest.approx(
            3 * pressure**2 * (1 - 2 * poisson) / (2 * young) * volume, rel=1e-8
        )
        counts.append(len(cells))
    assert counts[1] > counts[0]


@pytest.mark.parametrize("defect", ["stamp", "output", "missing", "extra", "face", "alias"])
def test_stale_or_invalid_face_catalog_cannot_start_fem(tmp_path, defect):
    project, _ = project_for(tmp_path)
    domain = project["study"]["domain"]
    if defect == "stamp":
        domain["geometryFingerprint"] = "0" * 64
    elif defect == "output":
        domain["outputFeatureId"] = "other"
        for b in domain["boundaries"]:
            b["faceId"] = b["faceId"].replace("box/", "other/")
    elif defect == "missing":
        domain["boundaries"].pop()
    elif defect == "extra":
        domain["boundaries"].append(
            {"id": "extra", "faceId": "box/face/" + "f" * 24, "name": "Extra"}
        )
    elif defect == "face":
        domain["boundaries"][0]["faceId"] = "box/face/" + "f" * 24
    else:
        domain["boundaries"][0]["id"] = domain["boundaries"][1]["id"]
    if defect in ("stamp", "output"):
        assert validate_project(project) == project  # Retain repairable definitions.
    with pytest.raises(EngineError):
        execute(RunPlan.prepare(request(project, "mesh")), tmp_path / "rejected")
    assert not (tmp_path / "rejected" / "manifest.json").exists()


def test_cad_cache_requires_independent_exact_mesh_and_rejects_retaged_or_shifted_data(tmp_path):
    project, _ = project_for(tmp_path)
    out = tmp_path / "run"
    manifest = execute(RunPlan.prepare(request(project, "mesh")), out)
    blob = (out / "buffer.bin").read_bytes()
    with pytest.raises(EngineError, match="independently") as error:
        validate_cached(project, manifest, blob)
    assert error.value.code == "cad-cache-mismatch"
    expected = generate_study_mesh(project)
    assert validate_cached(project, manifest, blob, expected_mesh=expected) == manifest
    assert execute(RunPlan.prepare(request(project, "validate")), out) == manifest
    for field in ("positions", "surfaceRegions"):
        changed = bytearray(blob)
        value = read_array(manifest, changed, field)
        if field == "positions":
            value[:] += [0.01, 0, 0]
        else:
            value[:] = (value + 1) % len(expected.regions)
        edited = deepcopy(manifest)
        edited["bufferHash"] = hashlib.sha256(changed).hexdigest()
        with pytest.raises(EngineError) as error:
            validate_cached(project, edited, bytes(changed), expected_mesh=expected)
        assert error.value.code == "cad-cache-mismatch"


def test_imported_step_sources_are_verified_snapshots_and_protocol_stdout_remains_json(tmp_path):
    payload = export_step(build(geometry(hole=True), {}).shape)
    digest = hashlib.sha256(payload).hexdigest()
    source = tmp_path / f"{digest}.step"
    source.write_bytes(payload)
    imported = {
        "kind": "cad",
        "dimension": "3d",
        "outputFeatureId": "import",
        "features": [
            {
                "id": "import",
                "name": "Imported",
                "kind": "import-step",
                "assetId": "source",
                "scaleFactor": 1,
            }
        ],
        "assets": [
            {
                "id": "source",
                "kind": "step-source",
                "originalName": "part.step",
                "sha256": digest,
                "byteLength": len(payload),
            }
        ],
    }
    project, faces = project_for(tmp_path, imported)
    rollers(project, faces)
    project["study"]["loads"] = [
        {
            "id": "pressure",
            "name": "Pressure",
            "kind": "pressure",
            "pressure": 2e6,
            "vector": [0, 0, 0],
            "regions": [boundary["id"] for boundary in project["study"]["domain"]["boundaries"]],
        }
    ]
    with pytest.raises(EngineError, match="sources are required"):
        request(project, "mesh")
    snapshot = request(project, "solve", str(tmp_path))
    source.write_bytes(b"x" * len(payload))
    copied = snapshot.asset_sources()
    copied["source"] = b"tampered caller dictionary"
    with pytest.raises(FrozenInstanceError):
        snapshot._asset_sources = ()
    manifest = execute(RunPlan.prepare(snapshot), tmp_path / "snapshot-mesh")
    assert manifest["status"] == "succeeded"
    with pytest.raises(EngineError, match="integrity"):
        request(project, "mesh", str(tmp_path))
    source.write_bytes(payload)
    envelope = {
        "protocolVersion": 1,
        "jobId": "stdio-cad-solid",
        "operation": "solve",
        "project": project,
    }
    environment = {**os.environ, "PYTHONPATH": str(ROOT / "engine")}
    process = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine/entry.py"),
            "--output",
            str(tmp_path / "worker"),
            "--asset-root",
            str(tmp_path),
        ],
        input=json.dumps(envelope),
        text=True,
        capture_output=True,
        timeout=60,
        cwd=ROOT,
        env=environment,
    )
    assert process.returncode == 0, process.stderr + process.stdout
    events = [json.loads(line) for line in process.stdout.splitlines()]
    assert events[-1]["type"] == "complete" and events[-1]["manifest"]["operation"] == "solve"
    envelope["operation"] = "validate"
    cached = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine/entry.py"),
            "--output",
            str(tmp_path / "worker"),
            "--asset-root",
            str(tmp_path),
        ],
        input=json.dumps(envelope),
        text=True,
        capture_output=True,
        timeout=60,
        cwd=ROOT,
        env=environment,
    )
    assert cached.returncode == 0, cached.stderr + cached.stdout
    assert json.loads(cached.stdout.splitlines()[-1])["manifest"] == events[-1]["manifest"]
    # Keep schema-valid repairable definitions editable when their old cached
    # assignments become unavailable; refuse fields with the precise error code.
    envelope["project"]["study"]["loads"][0]["regions"] = ["absent-face"]
    invalid = subprocess.run(
        [
            sys.executable,
            str(ROOT / "engine/entry.py"),
            "--output",
            str(tmp_path / "worker"),
            "--asset-root",
            str(tmp_path),
        ],
        input=json.dumps(envelope),
        text=True,
        capture_output=True,
        timeout=60,
        cwd=ROOT,
        env=environment,
    )
    assert invalid.returncode == 2
    failure = json.loads(invalid.stdout.splitlines()[-1])
    assert failure["type"] == "error" and failure["code"] == "invalid-region"


@pytest.mark.parametrize(
    "metadata",
    [b"{", b'{"name":"\xff"}', b'{"durationSeconds":1e400}'],
    ids=["syntax", "utf8", "overflow"],
)
def test_cad_cache_worker_classifies_malformed_manifest_without_changing_source(tmp_path, metadata):
    project, _ = project_for(tmp_path)
    original = deepcopy(project)
    output = tmp_path / "cad-cache"
    execute(RunPlan.prepare(request(project, "mesh")), output)
    original_buffer = (output / "buffer.bin").read_bytes()
    (output / "manifest.json").write_bytes(metadata)
    envelope = {
        "protocolVersion": 1,
        "jobId": "cad-cache-validate",
        "operation": "validate",
        "project": project,
    }
    process = subprocess.run(
        [sys.executable, str(ROOT / "engine/entry.py"), "--output", str(output)],
        input=json.dumps(envelope),
        text=True,
        capture_output=True,
        timeout=60,
        cwd=ROOT,
        env={**os.environ, "PYTHONPATH": str(ROOT / "engine")},
    )
    assert process.returncode == 2, process.stderr + process.stdout
    events = [json.loads(line) for line in process.stdout.splitlines()]
    assert events[-1]["type"] == "error" and events[-1]["code"] == "invalid-cache"
    assert project == original
    assert (output / "manifest.json").read_bytes() == metadata
    assert (output / "buffer.bin").read_bytes() == original_buffer


def test_v7_migration_preserves_existing_primitive_and_adapted_cad_fingerprints(tmp_path):
    primitive = json.loads((ROOT / "examples/extension.json").read_text())
    primitive["schemaVersion"] = 7
    cad, _ = project_for(tmp_path)
    del cad["study"]["domain"]
    cad["schemaVersion"] = 7
    for prior in (primitive, cad):
        original = deepcopy(prior)
        upgraded = migrate_project(prior)
        assert prior == original and upgraded["schemaVersion"] == 8
        assert fingerprint(upgraded) == fingerprint(prior)


@pytest.mark.parametrize("defect", ["assembly", "multisolid", "shell"])
def test_independent_components_multiple_solids_and_surface_domains_are_not_implicitly_solved(
    tmp_path, defect
):
    shape = geometry()
    if defect == "assembly":
        shape["features"].append(
            {
                "id": "assembly",
                "name": "Assembly",
                "kind": "assembly",
                "components": [{"id": "component", "name": "Component", "featureId": "box"}],
            }
        )
        shape["outputFeatureId"] = "assembly"
    elif defect == "multisolid":
        shape["features"] += [
            {
                "id": "moved",
                "kind": "transform",
                "name": "Separated box",
                "inputId": "box",
                "translation": [0.2, 0, 0],
                "axisOrigin": [0, 0, 0],
                "axisDirection": [0, 0, 1],
                "angle": 0,
            },
            {
                "id": "union",
                "kind": "boolean",
                "name": "Disconnected solid",
                "operation": "union",
                "leftId": "box",
                "rightId": "moved",
            },
        ]
        shape["outputFeatureId"] = "union"
    else:
        from OCP.BRepBuilderAPI import BRepBuilderAPI_MakeFace
        from OCP.gp import gp_Dir, gp_Pln, gp_Pnt

        face = BRepBuilderAPI_MakeFace(gp_Pln(gp_Pnt(), gp_Dir(0, 0, 1)), 0, 100, 0, 50).Shape()
        payload = export_step(face)
        digest = hashlib.sha256(payload).hexdigest()
        (tmp_path / f"{digest}.step").write_bytes(payload)
        shape = {
            "kind": "cad",
            "dimension": "3d",
            "outputFeatureId": "surface",
            "features": [
                {
                    "id": "surface",
                    "name": "Surface",
                    "kind": "import-step",
                    "assetId": "source",
                    "scaleFactor": 1,
                }
            ],
            "assets": [
                {
                    "id": "source",
                    "kind": "step-source",
                    "originalName": "surface.step",
                    "sha256": digest,
                    "byteLength": len(payload),
                }
            ],
        }
    project, _ = project_for(tmp_path, shape)
    with pytest.raises(EngineError) as error:
        execute(RunPlan.prepare(request(project, "mesh", str(tmp_path))), tmp_path / "rejected")
    assert error.value.code in ("cad-domain-unavailable", "invalid-cad-domain")
    assert not (tmp_path / "rejected" / "manifest.json").exists()


def test_missing_correspondence_and_under_restraint_cannot_publish_fields(tmp_path, monkeypatch):
    project, _ = project_for(tmp_path)
    with pytest.raises(EngineError) as error:
        execute(RunPlan.prepare(request(project)), tmp_path / "unrestrained")
    assert error.value.code == "under-constrained"
    with monkeypatch.context() as scoped:
        scoped.setattr(
            cad_meshing,
            "verify_cad_correspondence",
            lambda *_: CadCorrespondence(reason="Exact faces changed."),
        )
        with pytest.raises(EngineError) as error:
            execute(RunPlan.prepare(request(project, "mesh")), tmp_path / "unmapped")
        assert error.value.code == "cad-domain-unavailable"
    assert not (tmp_path / "unrestrained" / "manifest.json").exists()
    assert not (tmp_path / "unmapped" / "manifest.json").exists()


def test_cad_named_sets_remain_saveable_after_geometry_change_but_cannot_bypass_source_stamp(
    tmp_path,
):
    project, _ = project_for(tmp_path)
    project["namedSelections"] = [
        {
            "id": "support-set",
            "name": "Support set",
            "dimension": "3d",
            "geometryKind": "cad",
            "geometryFingerprint": project["study"]["domain"]["geometryFingerprint"],
            "regions": [project["study"]["domain"]["boundaries"][0]["id"]],
        }
    ]
    physical_digest = fingerprint(project)
    project["namedSelections"][0]["name"] = "Renamed set"
    assert fingerprint(project) == physical_digest
    project["geometry"]["features"][0]["length"] *= 2
    assert validate_project(project) == project
    with pytest.raises(EngineError) as error:
        request(project, "mesh")
    assert error.value.code == "stale-cad-domain"


@pytest.mark.parametrize(
    "defect", ["boundary-refinement", "blank-name", "blank-output", "newline-alias"]
)
def test_unimplemented_mesh_controls_and_blank_catalog_metadata_are_explicitly_rejected(
    tmp_path, defect
):
    project, _ = project_for(tmp_path)
    if defect == "boundary-refinement":
        project["study"]["mesh"]["boundarySize"] = 0.001
    elif defect == "blank-name":
        project["study"]["domain"]["boundaries"][0]["name"] = "\ufeff\u001c"
    elif defect == "newline-alias":
        project["study"]["domain"]["boundaries"][0]["id"] += "\n"
    else:
        project["study"]["domain"]["outputFeatureId"] = "\ufeff\u001c"
    with pytest.raises(EngineError) as error:
        request(project, "mesh")
    assert error.value.code in ("unsupported-study", "invalid-cad-domain")
