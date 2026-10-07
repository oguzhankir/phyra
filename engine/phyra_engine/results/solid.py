"""Versioned binary field transport and strict cached-result validation."""

import hashlib
import json
import math
import platform
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import gmsh  # type: ignore[import-untyped]
import numpy as np
import scipy  # type: ignore[import-untyped]

from phyra_engine import __version__
from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import (
    MAX_BUFFER_BYTES,
    MAX_CELLS,
    MAX_NODES,
    MAX_TRIANGLES,
)
from phyra_engine.geometry.regions import SOLID_REGIONS
from phyra_engine.meshing.solid import mesh_id, quality, validate_mesh
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.physics.elasticity.solid import integrate_surface_loads
from phyra_engine.results import validate_cached
from phyra_engine.results.fields import STRESS_COMPONENTS
from phyra_engine.studies.project import (
    _finite_tree,
    fingerprint,
    numerical_view,
    validate_numerical_project,
)

LAYOUT: dict[str, tuple[str, str, str, int | None]] = {
    "positions": ("float64", "node", "m", 3),
    "cells": ("uint32", "cell", "1", 4),
    "surface": ("uint32", "surface", "1", 3),
    "surfaceRegions": ("uint32", "surface", "1", None),
    "surfaceCells": ("uint32", "surface", "1", None),
    "displacement": ("float64", "node", "m", 3),
    "stress": ("float64", "cell", "Pa", 6),
    "vonMises": ("float64", "cell", "Pa", None),
    "reactions": ("float64", "node", "N", 3),
}
MESH_FIELDS = {"positions", "cells", "surface", "surfaceRegions", "surfaceCells"}
RESULT_FIELDS = {"displacement", "stress", "vonMises", "reactions"}


def region_metadata(mesh: Mesh) -> list[dict[str, Any]]:
    points = mesh.positions[mesh.surface]
    areas = (
        np.linalg.norm(np.cross(points[:, 1] - points[:, 0], points[:, 2] - points[:, 0]), axis=1)
        / 2
    )
    return [
        {
            "id": region,
            "name": region,
            "triangleCount": int(np.count_nonzero(mesh.surface_regions == index)),
            "area": float(areas[mesh.surface_regions == index].sum()),
        }
        for index, region in enumerate(mesh.regions)
    ]


def write_output(
    output: Path,
    project: dict[str, Any],
    job_id: str,
    operation: str,
    mesh: Mesh,
    result: dict[str, Any] | None = None,
    *,
    started_at: str | None = None,
    duration_seconds: float | None = None,
    expected_mesh: Mesh | None = None,
) -> dict[str, Any]:
    values = {
        "positions": mesh.positions,
        "cells": mesh.cells,
        "surface": mesh.surface,
        "surfaceRegions": mesh.surface_regions,
        "surfaceCells": mesh.surface_cells,
    }
    if result:
        values.update({name: result[name] for name in RESULT_FIELDS})
    blob = bytearray()
    descriptors = {}
    for name, value in values.items():
        dtype, association, units, _ = LAYOUT[name]
        array = np.asarray(value, dtype="<f8" if dtype == "float64" else "<u4")
        blob.extend(b"\0" * (-len(blob) % 8))
        offset = len(blob)
        payload = array.tobytes(order="C")
        blob.extend(payload)
        descriptors[name] = {
            "offset": offset,
            "byteLength": len(payload),
            "dtype": dtype,
            "shape": list(array.shape),
            "association": association,
            "units": units,
        }
    if len(blob) > MAX_BUFFER_BYTES:
        raise EngineError("resource-limit", "Result binary exceeds the buffer size limit.")
    min_quality = float(quality(mesh).min())
    notices = []
    if min_quality < 0.05:
        notices.append(
            "Low tetrahedral mean-ratio quality; "
            "refine or adjust geometry before interpreting results."
        )
    boundary_records = region_metadata(mesh)
    domain = project["study"].get("domain")
    if domain:
        labels = {boundary["id"]: boundary["name"] for boundary in domain["boundaries"]}
        for boundary in boundary_records:
            boundary["name"] = labels.get(boundary["id"], boundary["id"])
    if result:
        notices.append("First-order tetrahedra can be stiff in bending. Check mesh convergence.")
        notices.append(
            "Cell stresses are unsmoothed. Idealized restraints and re-entrant corners "
            "can create singular stress extrema."
        )
    manifest: dict[str, Any] = {
        "protocolVersion": 1,
        "projectId": project["id"],
        "studyId": project["study"]["id"],
        "revision": project["revision"],
        "fingerprint": fingerprint(project),
        "jobId": job_id,
        "meshId": mesh_id(mesh),
        "operation": operation,
        "status": "succeeded",
        "byteLength": len(blob),
        "bufferHash": hashlib.sha256(blob).hexdigest(),
        "coordinateFrame": "cartesian-global-SI",
        "stressComponents": STRESS_COMPONENTS,
        "dimension": "3d",
        "formulation": "solid",
        "cellType": "tetra4",
        "solver": "fem",
        "device": "cpu",
        "startedAt": started_at or datetime.now(timezone.utc).isoformat(),
        "regions": boundary_records,
        "statistics": {
            "nodes": len(mesh.positions),
            "cells": len(mesh.cells),
            "surfaceTriangles": len(mesh.surface),
            "minQuality": min_quality,
            "qualityMetric": (
                "tetrahedral mean ratio: 12(3V)^(2/3)/sum(edge length squared); "
                "regular tetrahedron = 1"
            ),
        },
        "arrays": descriptors,
        "warnings": notices,
        "versions": {
            "engine": __version__,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "gmsh": gmsh.__version__,
        },
    }
    if result:
        manifest["summary"] = result["summary"]
    if duration_seconds is not None:
        manifest["durationSeconds"] = duration_seconds
    validate_cached(project, manifest, bytes(blob), expected_mesh=expected_mesh)
    output.mkdir(parents=True, exist_ok=True)
    binary_temp = output / "buffer.bin.tmp"
    manifest_temp = output / "manifest.json.tmp"
    binary_temp.write_bytes(blob)
    manifest_temp.write_text(
        json.dumps(manifest, separators=(",", ":"), allow_nan=False), encoding="utf-8"
    )
    binary_temp.replace(output / "buffer.bin")
    manifest_temp.replace(output / "manifest.json")
    return manifest


def _validate_cached(
    project: dict[str, Any],
    manifest: Any,
    blob: bytes,
    *,
    expected_mesh: Mesh | Mesh2D | None = None,
) -> dict[str, Any]:
    """Validate provenance, resource bounds, descriptors, finite fields and topology.

    No pickle or executable serialization is used. Hashes detect accidental
    corruption; they are integrity checks, not a scientific authenticity claim.
    """
    validate_numerical_project(project)
    source_project = project
    project = numerical_view(project)
    _finite_tree(manifest)
    if not isinstance(manifest, dict):
        raise EngineError("invalid-cache", "Result manifest must be an object.")
    for key, expected_value in {
        "dimension": "3d",
        "formulation": "solid",
        "cellType": "tetra4",
        "solver": "fem",
        "device": "cpu",
    }.items():
        if key in manifest and manifest[key] != expected_value:
            raise EngineError("invalid-cache", "Invalid classical run provenance.")
    if "startedAt" in manifest:
        started = manifest["startedAt"]
        if not isinstance(started, str) or not 1 <= len(started) <= 64:
            raise EngineError("invalid-cache", "Run start time must be an ISO timestamp.")
        try:
            if datetime.fromisoformat(started).tzinfo is None:
                raise ValueError("Missing timestamp timezone")
        except ValueError as error:
            raise EngineError(
                "invalid-cache", "Run start time must have a valid timezone."
            ) from error
    if "durationSeconds" in manifest and (
        type(manifest["durationSeconds"]) not in (int, float)
        or not math.isfinite(manifest["durationSeconds"])
        or manifest["durationSeconds"] < 0
    ):
        raise EngineError("invalid-cache", "Run duration must be finite and nonnegative.")
    if (
        type(manifest.get("protocolVersion")) is not int
        or type(manifest.get("revision")) is not int
        or manifest["revision"] < 0
        or not isinstance(manifest.get("jobId"), str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", manifest["jobId"])
    ):
        raise EngineError("invalid-cache", "Result version and execution identities are invalid.")
    versions = manifest.get("versions")
    if not isinstance(versions, dict) or any(
        not isinstance(versions.get(key), str) or len(versions[key]) > 100
        for key in ("engine", "python", "numpy", "scipy", "gmsh")
    ):
        raise EngineError("invalid-cache", "Result backend provenance is missing or invalid.")
    expected = {
        "protocolVersion": 1,
        "projectId": project["id"],
        "studyId": project["study"]["id"],
        "fingerprint": fingerprint(source_project),
        "status": "succeeded",
        "coordinateFrame": "cartesian-global-SI",
        "stressComponents": STRESS_COMPONENTS,
    }
    if any(manifest.get(key) != value for key, value in expected.items()):
        raise EngineError(
            "stale-cache",
            "Cached result version, coordinate frame or physical input does not match the project.",
        )
    if (
        type(manifest.get("byteLength")) is not int
        or manifest["byteLength"] != len(blob)
        or not 0 < len(blob) <= MAX_BUFFER_BYTES
    ):
        raise EngineError(
            "invalid-cache", "Binary length is invalid or exceeds the resource limit."
        )
    if manifest.get("bufferHash") != hashlib.sha256(blob).hexdigest():
        raise EngineError("corrupt-cache", "Binary data integrity hash does not match.")
    operation = manifest.get("operation")
    fields = MESH_FIELDS | (RESULT_FIELDS if operation == "solve" else set())
    if (
        operation not in ("mesh", "solve")
        or not isinstance(manifest.get("arrays"), dict)
        or set(manifest.get("arrays", {})) != fields
    ):
        raise EngineError("invalid-cache", "Cached field set does not match the operation.")
    regions = manifest.get("regions")
    domain = project["study"].get("domain")
    expected_regions = (
        [boundary["id"] for boundary in domain["boundaries"]]
        if domain
        else list(SOLID_REGIONS[project["geometry"]["kind"]])
    )
    if (
        not isinstance(regions, list)
        or any(not isinstance(item, dict) for item in regions)
        or [item.get("id") for item in regions] != expected_regions
    ):
        raise EngineError("invalid-cache", "Cached boundary regions do not match the solid.")
    statistics = manifest.get("statistics")
    if not isinstance(statistics, dict):
        raise EngineError("invalid-cache", "Cached mesh statistics are missing.")
    counts = {
        "node": statistics.get("nodes"),
        "cell": statistics.get("cells"),
        "surface": statistics.get("surfaceTriangles"),
    }
    limits = {"node": MAX_NODES, "cell": MAX_CELLS, "surface": MAX_TRIANGLES}
    if any(
        type(count) is not int or not 1 <= count <= limits[key] for key, count in counts.items()
    ):
        raise EngineError("invalid-cache", "Mesh counts exceed resource limits or are invalid.")
    counts_valid = cast(dict[str, int], counts)
    arrays, ranges = {}, []
    for name, descriptor in manifest["arrays"].items():
        dtype, association, units, width = LAYOUT[name]
        shape: list[int] = [counts_valid[association]] + ([] if width is None else [width])
        if not isinstance(descriptor, dict):
            raise EngineError("invalid-cache", "Binary descriptor must be an object.")
        dimensions = descriptor.get("shape")
        if not isinstance(dimensions, list) or any(type(size) is not int for size in dimensions):
            raise EngineError("invalid-cache", "Binary field dimensions must be integer values.")
        if any(
            descriptor.get(key) != value
            for key, value in {
                "dtype": dtype,
                "association": association,
                "units": units,
                "shape": shape,
            }.items()
        ):
            raise EngineError(
                "invalid-cache", f"Field {name} has invalid dimensions, type or units."
            )
        offset, length = descriptor.get("offset"), descriptor.get("byteLength")
        expected_length = math.prod(shape) * (8 if dtype == "float64" else 4)
        if (
            type(offset) is not int
            or type(length) is not int
            or offset < 0
            or offset % 8
            or length != expected_length
            or offset + length > len(blob)
        ):
            raise EngineError(
                "invalid-cache", "A binary field range is out of bounds or unaligned."
            )
        array = np.frombuffer(
            blob,
            dtype="<f8" if dtype == "float64" else "<u4",
            count=math.prod(shape),
            offset=offset,
        ).reshape(shape)
        if dtype == "float64" and not np.isfinite(array).all():
            raise EngineError("invalid-cache", f"Field {name} contains nonfinite values.")
        arrays[name] = array
        ranges.append((offset, offset + length))
    cursor = 0
    for start, end in sorted(ranges):
        if start < cursor or start - cursor >= 8 or any(blob[cursor:start]):
            raise EngineError(
                "invalid-cache", "Binary fields overlap or contain unexpected padding."
            )
        cursor = end
    if cursor != len(blob):
        raise EngineError("invalid-cache", "Binary data contains trailing unowned bytes.")
    mesh = Mesh(
        arrays["positions"],
        arrays["cells"],
        arrays["surface"],
        arrays["surfaceRegions"],
        arrays["surfaceCells"],
        tuple(item["id"] for item in regions),
    )
    validate_mesh(mesh)
    if domain:
        # The execution layer rebuilt the exact current solid, required complete
        # face correspondence and remeshed it. Integrity hashes alone cannot
        # prove that an archived boundary label still belongs to this CAD face.
        # Fail closed on changed kernel/mesher ordering rather than guessing.
        if (
            not isinstance(expected_mesh, Mesh)
            or mesh.regions != expected_mesh.regions
            or any(
                not np.array_equal(getattr(mesh, field), getattr(expected_mesh, field))
                for field in ("positions", "cells", "surface", "surface_regions", "surface_cells")
            )
        ):
            raise EngineError(
                "cad-cache-mismatch",
                "Cached CAD mesh does not match independently prepared source geometry and faces.",
            )
    if manifest.get("meshId") != mesh_id(mesh):
        raise EngineError("corrupt-cache", "Mesh identity does not match node/cell data.")
    actual_regions = region_metadata(mesh)
    for stored, actual in zip(regions, actual_regions, strict=True):
        if stored.get("triangleCount") != actual["triangleCount"] or not np.isclose(
            stored.get("area", -1), actual["area"], rtol=1e-12, atol=0
        ):
            raise EngineError("invalid-cache", "Boundary statistics do not match triangle data.")
    if not np.isclose(statistics.get("minQuality", -1), quality(mesh).min(), rtol=1e-12, atol=0):
        raise EngineError("invalid-cache", "Mesh quality metadata does not match the mesh.")
    if operation == "solve":
        summary = manifest.get("summary")
        if not isinstance(summary, dict):
            raise EngineError("invalid-cache", "Solve summary is missing.")
        scalar_keys = (
            "maxDisplacement",
            "maxVonMises",
            "strainEnergy",
            "relativeResidual",
            "relativeForceBalance",
            "relativeMomentBalance",
            "elapsedSeconds",
        )
        vector_keys = ("totalForce", "totalReaction", "forceBalance", "momentBalance")
        for key in scalar_keys:
            if type(summary.get(key)) not in (int, float) or not math.isfinite(summary[key]):
                raise EngineError("invalid-cache", "Solve summary contains invalid scalar values.")
        for key in vector_keys:
            vector = summary.get(key)
            if (
                not isinstance(vector, list)
                or len(vector) != 3
                or any(
                    type(value) not in (int, float) or not math.isfinite(value) for value in vector
                )
            ):
                raise EngineError("invalid-cache", "Solve summary contains invalid vectors.")
        for key in ("relativeResidual", "relativeForceBalance", "relativeMomentBalance"):
            if not 0 <= summary[key] <= 1e-8:
                raise EngineError(
                    "invalid-cache", "Successful cached solve has invalid equilibrium diagnostics."
                )
        force = integrate_surface_loads(mesh, project["study"]["loads"])
        reactions = arrays["reactions"]
        centered = mesh.positions - mesh.positions.mean(axis=0)
        force_scale = max(
            np.linalg.norm(force, axis=1).sum(),
            np.linalg.norm(reactions, axis=1).sum(),
            np.finfo(float).tiny,
        )
        length = np.linalg.norm(np.ptp(mesh.positions, axis=0))
        checks = {
            "totalForce": force.sum(axis=0),
            "totalReaction": reactions.sum(axis=0),
            "forceBalance": (force + reactions).sum(axis=0),
            "momentBalance": np.cross(centered, force + reactions).sum(axis=0),
        }
        for key, actual in checks.items():
            scale = force_scale * (length if key == "momentBalance" else 1)
            if not np.allclose(summary[key], actual, rtol=1e-12, atol=scale * 1e-12):
                raise EngineError("invalid-cache", "Solve summary disagrees with physical fields.")
        if np.any(arrays["vonMises"] < 0):
            raise EngineError("invalid-cache", "Equivalent stress cannot be negative.")
        for key, value in {
            "maxDisplacement": np.linalg.norm(arrays["displacement"], axis=1).max(),
            "maxVonMises": arrays["vonMises"].max(),
        }.items():
            if not isinstance(summary.get(key), (int, float)) or not np.isclose(
                summary[key], value, rtol=1e-12, atol=0
            ):
                raise EngineError("invalid-cache", "Result extrema do not match their field data.")
    return manifest
