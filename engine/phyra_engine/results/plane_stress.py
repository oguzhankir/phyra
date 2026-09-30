"""Safe 2D fields and same-location FEM/PINN comparison transport.

Comparison L2 is the unweighted Euclidean norm across all identical evaluation
locations: ||prediction-reference||2 / ||reference||2. A zero reference makes
that relative metric undefined (JSON null). Displacements are nodal; stresses
are evaluated at each FEM cell centroid. No interpolation or stress smoothing.
"""

import hashlib
import json
import math
import platform
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

import numpy as np
import scipy  # type: ignore[import-untyped]

from phyra_engine import __version__
from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_CELLS, MAX_NODES
from phyra_engine.geometry.regions import PLANAR_REGIONS
from phyra_engine.meshing.plane_stress import (
    cell_areas,
    edge_geometry,
    mesh_id,
    quality,
    validate_mesh,
)
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.results.comparison import MAPPING, comparison, comparison_metric
from phyra_engine.results.fields import STRESS_COMPONENTS
from phyra_engine.results.plane_stress_validation import (
    number,
    text,
    validate_result,
    validate_training,
)
from phyra_engine.studies.project import _finite_tree, fingerprint, validate_project

QUALITY = "triangle mean ratio: 4 sqrt(3) A / sum(edge length squared)"


BASE = {
    "positions": ("float64", "node", "m", 3),
    "cells": ("uint32", "cell", "1", 3),
    "surface": ("uint32", "surface", "1", 3),
    "surfaceRegions": ("uint32", "surface", "1", None),
    "surfaceCells": ("uint32", "surface", "1", None),
    "boundaryEdges": ("uint32", "edge", "1", 2),
    "edgeRegions": ("uint32", "edge", "1", None),
}
RESULT = {
    "displacement": ("float64", "node", "m", 3),
    "stress": ("float64", "cell", "Pa", 6),
    "vonMises": ("float64", "cell", "Pa", None),
    "reactions": ("float64", "node", "N", 3),
}


def layout(operation: str) -> dict[str, tuple[str, str, str, int | None]]:
    fields = dict(BASE)
    if operation != "mesh":
        fields.update(RESULT)
    if operation == "compare":
        fields.update({f"pinn{k[0].upper()}{k[1:]}": v for k, v in RESULT.items()})
    return fields


def region_metadata(mesh: Mesh2D) -> list[dict[str, Any]]:
    lengths, _ = edge_geometry(mesh)
    return [
        {
            "id": region,
            "name": region,
            "triangleCount": 0,
            "edgeCount": int(np.count_nonzero(mesh.edge_regions == i)),
            "area": float(lengths[mesh.edge_regions == i].sum() * mesh.thickness),
        }
        for i, region in enumerate(mesh.regions)
    ]


def write_output(
    output: Path,
    project: dict[str, Any],
    job_id: str,
    operation: str,
    mesh: Mesh2D,
    result: dict[str, Any] | None,
    pinn: dict[str, Any] | None = None,
    started_at: str | None = None,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    values = {
        "positions": mesh.positions,
        "cells": mesh.cells,
        "surface": mesh.cells,
        "surfaceRegions": np.zeros(len(mesh.cells), dtype=np.uint32),
        "surfaceCells": np.arange(len(mesh.cells), dtype=np.uint32),
        "boundaryEdges": mesh.edges,
        "edgeRegions": mesh.edge_regions,
    }
    if result:
        values.update({key: result[key] for key in RESULT})
    if pinn:
        values.update({f"pinn{k[0].upper()}{k[1:]}": pinn[k] for k in RESULT})
    blob, descriptors = bytearray(), {}
    fields = layout(operation)
    for key, value in values.items():
        dtype, association, units, _ = fields[key]
        array = np.asarray(value, dtype="<f8" if dtype == "float64" else "<u4")
        blob.extend(b"\0" * (-len(blob) % 8))
        offset = len(blob)
        payload = array.tobytes(order="C")
        blob.extend(payload)
        descriptors[key] = {
            "offset": offset,
            "byteLength": len(payload),
            "dtype": dtype,
            "shape": list(array.shape),
            "association": association,
            "units": units,
        }
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
        "dimension": "2d",
        "formulation": "plane-stress",
        "cellType": "triangle3",
        "thickness": mesh.thickness,
        "solver": "comparison" if pinn else "pinn" if operation == "train" else "fem",
        "device": (pinn or result or {}).get("training", {}).get("device", "cpu"),
        "startedAt": started_at or datetime.now(timezone.utc).isoformat(),
        "regions": region_metadata(mesh),
        "statistics": {
            "nodes": len(mesh.positions),
            "cells": len(mesh.cells),
            "surfaceTriangles": len(mesh.cells),
            "boundaryEdges": len(mesh.edges),
            "minQuality": float(quality(mesh).min()),
            "qualityMetric": QUALITY,
        },
        "arrays": descriptors,
        "warnings": [
            "Plane stress: homogeneous isotropic small-strain elasticity; "
            "constant physical thickness."
        ]
        + (
            [
                "Stresses are evaluated at element centroids; "
                "check mesh convergence and boundary singularities."
            ]
            if result
            else []
        ),
        "versions": {
            "engine": __version__,
            "python": platform.python_version(),
            "numpy": np.__version__,
            "scipy": scipy.__version__,
            "gmsh": "unused-2d",
        },
    }
    if result:
        manifest["summary"] = result["summary"]
    if duration_seconds is not None:
        manifest["durationSeconds"] = duration_seconds
    trained = pinn or (result if operation == "train" else None)
    if trained:
        manifest["training"] = trained["training"]
        manifest["versions"]["torch"] = trained["training"]["frameworkVersion"]
        manifest["warnings"].extend(trained.get("warnings", []))
        manifest["warnings"].append(
            "Experimental PINN: loss reduction is not an accuracy guarantee; "
            "inspect FEM differences and measured equilibrium."
        )
    if pinn and result:
        manifest["comparison"] = comparison(result, pinn)
        manifest["pinnSummary"] = pinn["summary"]
    validate_cached(project, manifest, bytes(blob))
    output.mkdir(parents=True, exist_ok=True)
    for name, content in (
        ("buffer.bin", bytes(blob)),
        ("manifest.json", json.dumps(manifest, separators=(",", ":"), allow_nan=False).encode()),
    ):
        temp = output / (name + ".tmp")
        temp.write_bytes(content)
        temp.replace(output / name)
    return manifest


def validate_cached(project: dict[str, Any], manifest: Any, blob: bytes) -> dict[str, Any]:
    validate_project(project)
    _finite_tree(manifest)
    expected = {
        "protocolVersion": 1,
        "projectId": project["id"],
        "studyId": project["study"]["id"],
        "fingerprint": fingerprint(project),
        "status": "succeeded",
        "coordinateFrame": "cartesian-global-SI",
        "stressComponents": STRESS_COMPONENTS,
        "dimension": "2d",
        "formulation": "plane-stress",
        "cellType": "triangle3",
        "thickness": project["study"]["thickness"],
    }
    if not isinstance(manifest, dict) or any(manifest.get(k) != v for k, v in expected.items()):
        raise EngineError("stale-cache", "2D cache provenance does not match the study.")
    if (
        type(manifest.get("protocolVersion")) is not int
        or type(manifest.get("revision")) is not int
        or manifest["revision"] < 0
        or not isinstance(manifest.get("jobId"), str)
        or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", manifest["jobId"])
    ):
        raise EngineError("invalid-cache", "Invalid run identity.")
    if (
        type(manifest.get("byteLength")) is not int
        or manifest["byteLength"] != len(blob)
        or not 0 < len(blob) <= MAX_BUFFER_BYTES
    ):
        raise EngineError("invalid-cache", "2D buffer size is invalid.")
    if manifest.get("bufferHash") != hashlib.sha256(blob).hexdigest():
        raise EngineError("corrupt-cache", "2D buffer hash mismatch.")
    operation = manifest.get("operation")
    if operation not in ("mesh", "solve", "train", "compare"):
        raise EngineError("invalid-cache", "Unknown 2D operation.")
    expected_keys = {
        "protocolVersion",
        "projectId",
        "studyId",
        "revision",
        "fingerprint",
        "jobId",
        "meshId",
        "operation",
        "status",
        "byteLength",
        "bufferHash",
        "coordinateFrame",
        "stressComponents",
        "dimension",
        "formulation",
        "cellType",
        "thickness",
        "solver",
        "device",
        "startedAt",
        "regions",
        "statistics",
        "arrays",
        "warnings",
        "versions",
    }
    if operation != "mesh":
        expected_keys.add("summary")
    if operation in ("train", "compare"):
        expected_keys.add("training")
    if operation == "compare":
        expected_keys.add("comparison")
        expected_keys.add("pinnSummary")
    if "durationSeconds" in manifest:
        expected_keys.add("durationSeconds")
        if not number(manifest["durationSeconds"]):
            raise EngineError("invalid-cache", "Run duration must be finite and nonnegative.")
    if set(manifest) != expected_keys:
        raise EngineError("invalid-cache", "Unexpected 2D result metadata.")
    if (
        manifest["solver"]
        != {"mesh": "fem", "solve": "fem", "train": "pinn", "compare": "comparison"}[operation]
    ):
        raise EngineError("invalid-cache", "Solver provenance does not match the operation.")
    started = manifest["startedAt"]
    if not isinstance(started, str) or not 1 <= len(started) <= 64:
        raise EngineError("invalid-cache", "Run start time must be an ISO timestamp.")
    try:
        if datetime.fromisoformat(started).tzinfo is None:
            raise ValueError("Missing timestamp timezone")
    except ValueError as error:
        raise EngineError("invalid-cache", "Run start time must have a valid timezone.") from error
    warnings = manifest["warnings"]
    if (
        not isinstance(warnings, list)
        or len(warnings) > 100
        or any(not isinstance(item, str) or len(item) > 2000 for item in warnings)
    ):
        raise EngineError("invalid-cache", "Invalid result warnings.")
    fields = layout(operation)
    if not isinstance(manifest.get("arrays"), dict) or set(manifest["arrays"]) != set(fields):
        raise EngineError("invalid-cache", "Unexpected 2D field set.")
    stats = manifest.get("statistics", {})
    if (
        not isinstance(stats, dict)
        or set(stats)
        != {"nodes", "cells", "surfaceTriangles", "boundaryEdges", "minQuality", "qualityMetric"}
        or not number(stats.get("minQuality"))
        or stats["qualityMetric"] != QUALITY
    ):
        raise EngineError("invalid-cache", "Invalid 2D mesh statistics.")
    counts = {
        "node": stats.get("nodes"),
        "cell": stats.get("cells"),
        "surface": stats.get("surfaceTriangles"),
        "edge": stats.get("boundaryEdges"),
    }
    limits = {"node": MAX_NODES, "cell": MAX_CELLS, "surface": MAX_CELLS, "edge": 2 * MAX_NODES}
    if (
        any(type(v) is not int or not 1 <= v <= limits[k] for k, v in counts.items())
        or counts["surface"] != counts["cell"]
    ):
        raise EngineError("invalid-cache", "2D mesh counts are invalid.")
    entity_counts = cast(dict[str, int], counts)
    arrays, ranges = {}, []
    for key, (dtype, association, units, width) in fields.items():
        descriptor = manifest["arrays"][key]
        shape = [entity_counts[association]] + ([] if width is None else [width])
        if (
            not isinstance(descriptor, dict)
            or set(descriptor) != {"offset", "byteLength", "dtype", "shape", "association", "units"}
            or not isinstance(descriptor.get("shape"), list)
            or any(
                descriptor.get(k) != v
                for k, v in {
                    "dtype": dtype,
                    "association": association,
                    "units": units,
                    "shape": shape,
                }.items()
            )
            or any(type(v) is not int for v in descriptor["shape"])
        ):
            raise EngineError("invalid-cache", "Invalid 2D array descriptor.")
        offset, length = descriptor.get("offset"), descriptor.get("byteLength")
        if (
            type(offset) is not int
            or type(length) is not int
            or offset < 0
            or offset % 8
            or length != math.prod(shape) * (8 if dtype == "float64" else 4)
            or offset + length > len(blob)
        ):
            raise EngineError("invalid-cache", "Invalid 2D array bounds.")
        arrays[key] = np.frombuffer(
            blob,
            dtype="<f8" if dtype == "float64" else "<u4",
            count=math.prod(shape),
            offset=offset,
        ).reshape(shape)
        if dtype == "float64" and not np.isfinite(arrays[key]).all():
            raise EngineError("invalid-cache", "Nonfinite 2D field.")
        ranges.append((offset, offset + length))
    cursor = 0
    for start, end in sorted(ranges):
        if start < cursor or start - cursor >= 8 or any(blob[cursor:start]):
            raise EngineError("invalid-cache", "Overlapping 2D arrays or invalid padding.")
        cursor = end
    if cursor != len(blob):
        raise EngineError("invalid-cache", "Unowned 2D buffer bytes.")
    mesh = Mesh2D(
        arrays["positions"],
        arrays["cells"],
        arrays["boundaryEdges"],
        arrays["edgeRegions"],
        PLANAR_REGIONS,
        project["study"]["thickness"],
    )
    validate_mesh(mesh)
    oriented: dict[tuple[int, int], list[int]] = {}
    for cell in mesh.cells:
        for first, second in ((0, 1), (1, 2), (2, 0)):
            a, b = int(cell[first]), int(cell[second])
            oriented.setdefault((min(a, b), max(a, b)), []).append(1 if a < b else -1)
    if any(len(signs) == 2 and sum(signs) != 0 for signs in oriented.values()) or not np.isclose(
        cell_areas(mesh).sum(),
        project["geometry"]["length"] * project["geometry"]["width"],
        rtol=1e-12,
        atol=0,
    ):
        raise EngineError(
            "invalid-cache", "Triangle orientation or filled rectangle area is invalid."
        )
    if (
        manifest.get("meshId") != mesh_id(mesh)
        or not np.array_equal(arrays["surface"], mesh.cells)
        or not np.array_equal(arrays["surfaceCells"], np.arange(len(mesh.cells)))
        or np.any(arrays["surfaceRegions"])
    ):
        raise EngineError("invalid-cache", "2D mesh identity or display mapping is invalid.")
    for axis, extent in ((0, project["geometry"]["length"]), (1, project["geometry"]["width"])):
        if not np.isclose(mesh.positions[:, axis].min(), 0, atol=0) or not np.isclose(
            mesh.positions[:, axis].max(), extent, rtol=1e-12, atol=0
        ):
            raise EngineError("invalid-cache", "2D mesh domain does not match geometry.")
    # Region indices must correspond to physical edge positions, not arbitrary labels.
    for index, region in enumerate(PLANAR_REGIONS):
        axis = 0 if region[0] == "x" else 1
        coordinate = (
            0 if region[1] == "0" else project["geometry"]["length" if axis == 0 else "width"]
        )
        selected = mesh.edges[mesh.edge_regions == index]
        if not len(selected) or not np.allclose(
            mesh.positions[selected, axis], coordinate, rtol=1e-12, atol=0
        ):
            raise EngineError("invalid-cache", "2D boundary labels do not match edge positions.")
        edge_length = np.linalg.norm(
            np.diff(mesh.positions[selected, :2], axis=1)[:, 0], axis=1
        ).sum()
        expected_length = project["geometry"]["width" if axis == 0 else "length"]
        if not np.isclose(edge_length, expected_length, rtol=1e-12, atol=0):
            raise EngineError("invalid-cache", "Boundary edges do not cover the rectangular sides.")
    regions = manifest["regions"]
    if (
        not isinstance(regions, list)
        or any(
            not isinstance(region, dict)
            or set(region) != {"id", "name", "triangleCount", "edgeCount", "area"}
            or type(region.get("triangleCount")) is not int
            or type(region.get("edgeCount")) is not int
            or not number(region.get("area"))
            for region in regions
        )
        or regions != region_metadata(mesh)
        or not np.isclose(stats.get("minQuality", -1), quality(mesh).min(), rtol=1e-12, atol=0)
    ):
        raise EngineError("invalid-cache", "2D boundary or quality metadata mismatch.")
    versions = manifest.get("versions")
    version_keys = {"engine", "python", "numpy", "scipy", "gmsh"} | (
        {"torch"} if operation in ("train", "compare") else set()
    )
    if (
        not isinstance(versions, dict)
        or set(versions) != version_keys
        or any(
            not text(versions.get(k), 100) for k in ("engine", "python", "numpy", "scipy", "gmsh")
        )
    ):
        raise EngineError("invalid-cache", "2D backend provenance is invalid.")
    training = (
        validate_training(project, mesh, manifest) if operation in ("train", "compare") else None
    )
    if operation not in ("train", "compare") and manifest["device"] != "cpu":
        raise EngineError("invalid-cache", "Classical results must identify the CPU backend.")
    if operation != "mesh":
        validate_result(
            mesh,
            project["study"],
            arrays,
            manifest["summary"],
            training if operation == "train" else None,
        )
    if operation == "compare":
        if training is None:
            raise EngineError("invalid-cache", "Missing comparison training measurements.")
        predicted = {key: arrays[f"pinn{key[0].upper()}{key[1:]}"] for key in RESULT}
        validate_result(mesh, project["study"], predicted, manifest["pinnSummary"], training)
        measured = manifest["comparison"]
        expected_comparison = {
            "mapping": MAPPING,
            **{
                key: comparison_metric(arrays[key], predicted[key])
                for key in ("displacement", "stress", "vonMises")
            },
            "femSeconds": manifest["summary"]["elapsedSeconds"],
            **training["timings"],
            "device": training["device"],
        }
        if (
            not isinstance(measured, dict)
            or set(measured) != set(expected_comparison)
            or measured != expected_comparison
        ):
            raise EngineError(
                "invalid-cache", "Comparison measurements or provenance disagree with the runs."
            )
        for key in ("displacement", "stress", "vonMises"):
            metric = measured[key]
            if (
                not isinstance(metric, dict)
                or set(metric) != {"relativeL2", "maxAbsolute", "referenceNorm"}
                or any(not number(metric[k]) for k in ("maxAbsolute", "referenceNorm"))
                or metric["relativeL2"] is not None
                and not number(metric["relativeL2"])
            ):
                raise EngineError("invalid-cache", "Comparison metrics have invalid scalar types.")
    if "durationSeconds" in manifest:
        minimum = manifest.get("summary", {}).get("elapsedSeconds", 0)
        if operation == "compare":
            if training is None:
                raise EngineError("invalid-cache", "Missing comparison phase timings.")
            minimum += sum(training["timings"].values())
        if manifest["durationSeconds"] + 1e-9 < minimum:
            raise EngineError(
                "invalid-cache", "Run duration is shorter than measured solver phases."
            )
    return manifest
