"""Bounded mesh-inspection artifacts, separate from physical result publication."""

import hashlib
import json
from pathlib import Path
from typing import Any

import gmsh  # type: ignore[import-untyped]
import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES
from phyra_engine.meshing.cad import CadMesh
from phyra_engine.meshing.solid import mesh_id, quality, tetra_volumes, validate_mesh


def write_cad_mesh(
    output: Path,
    result: CadMesh,
    *,
    project_id: str,
    revision: int,
    job_id: str,
    geometry_fingerprint: str,
    output_feature_id: str,
) -> dict[str, Any]:
    mesh = result.mesh
    validate_mesh(mesh)
    qualities = quality(mesh)
    if not np.isfinite(qualities).all() or np.any(qualities <= 0):
        raise EngineError("invalid-cad-mesh", "Mesh quality must be positive and finite.")
    values = {
        "positions": (mesh.positions, "float64", "node", "m"),
        "cells": (mesh.cells, "uint32", "cell", "1"),
        "surface": (mesh.surface, "uint32", "triangle", "1"),
        "surfaceRegions": (mesh.surface_regions, "uint32", "triangle", "1"),
        "surfaceCells": (mesh.surface_cells, "uint32", "triangle", "1"),
        "quality": (qualities, "float64", "cell", "1"),
    }
    buffer = bytearray()
    descriptors = {}
    for name, (source, dtype, association, units) in values.items():
        array = np.asarray(source, dtype="<f8" if dtype == "float64" else "<u4")
        buffer.extend(b"\0" * (-len(buffer) % 8))
        offset, payload = len(buffer), array.tobytes()
        if offset + len(payload) > MAX_BUFFER_BYTES:
            raise EngineError("cad-resource-limit", "Mesh inspection buffers exceed 64 MiB.")
        buffer.extend(payload)
        descriptors[name] = {
            "offset": offset,
            "byteLength": len(payload),
            "dtype": dtype,
            "shape": list(array.shape),
            "association": association,
            "units": units,
        }
    triangles = mesh.positions[mesh.surface]
    areas = (
        np.linalg.norm(
            np.cross(triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]), axis=1
        )
        / 2
    )
    regions: list[dict[str, Any]] = [
        {
            "id": region,
            "name": f"Surface {index + 1}",
            "identity": "mesh-scoped",
            "triangleCount": int(np.count_nonzero(mesh.surface_regions == index)),
            "area": float(areas[mesh.surface_regions == index].sum()),
        }
        for index, region in enumerate(mesh.regions)
    ]
    if any(region["triangleCount"] == 0 or region["area"] <= 0 for region in regions):
        raise EngineError("invalid-cad-mesh", "Every mesh boundary region must contain triangles.")
    if result.correspondence.face_ids:
        if result.correspondence.reason or len(result.correspondence.face_ids) != len(regions):
            raise EngineError("invalid-cad-mesh", "Exact face correspondence is incomplete.")
        for region, face_id in zip(regions, result.correspondence.face_ids, strict=True):
            region["cadFaceId"] = face_id
    elif not result.correspondence.reason:
        raise EngineError(
            "invalid-cad-mesh", "Exact face correspondence has no verified source faces."
        )
    volume = float(tetra_volumes(mesh.positions, mesh.cells).sum())
    manifest = {
        "protocolVersion": 1,
        "status": "succeeded",
        "operation": "mesh-cad",
        "purpose": "inspection-only",
        "projectId": project_id,
        "revision": revision,
        "jobId": job_id,
        "geometryFingerprint": geometry_fingerprint,
        "outputFeatureId": output_feature_id,
        "targetSize": result.target_size,
        "coordinateFrame": "cartesian-global-SI",
        "meshId": mesh_id(mesh),
        "mesher": {"name": "Gmsh", "version": gmsh.__version__, "element": "tetra4"},
        "byteLength": len(buffer),
        "bufferHash": hashlib.sha256(buffer).hexdigest(),
        "arrays": descriptors,
        "regions": regions,
        "correspondence": result.correspondence.metadata(),
        "statistics": {
            "bounds": [mesh.positions.min(axis=0).tolist(), mesh.positions.max(axis=0).tolist()],
            "nodes": len(mesh.positions),
            "cells": len(mesh.cells),
            "surfaceTriangles": len(mesh.surface),
            "boundaryRegions": len(mesh.regions),
            "exactVolume": result.exact_volume,
            "meshVolume": volume,
            "relativeVolumeError": abs(volume - result.exact_volume) / result.exact_volume,
            "exactSurfaceArea": result.exact_surface_area,
            "meshSurfaceArea": float(areas.sum()),
            "minQuality": float(qualities.min()),
            "maxQuality": float(qualities.max()),
            "meanQuality": float(qualities.mean()),
        },
    }
    receipt = json.dumps(manifest, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(receipt) > MAX_REQUEST_BYTES:
        raise EngineError("cad-resource-limit", "Mesh inspection receipt exceeds 1 MiB.")
    output.mkdir(parents=True, exist_ok=True)
    for name, artifact in (("buffer.bin", buffer), ("receipt.json", receipt)):
        temporary = output / (name + ".tmp")
        temporary.write_bytes(artifact)
        temporary.replace(output / name)
    return manifest
