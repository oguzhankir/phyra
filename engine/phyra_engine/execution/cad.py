"""One isolated CAD job, native-managed assets, bounded binary display publication."""

import argparse
import hashlib
import io
import json
import sys
from copy import deepcopy
from importlib.metadata import version
from pathlib import Path
from typing import Any, cast

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_REQUEST_BYTES
from phyra_engine.geometry.cad.native_output import cad_log_to_stderr, kernel_log_to_stderr
from phyra_engine.protocol.cad import CadRequest, read_cad_request
from phyra_engine.protocol.cad_assets import read_cad_assets
from phyra_engine.protocol.stdio import emit


def _read_assets(request: CadRequest) -> dict[str, bytes]:
    return read_cad_assets(request.geometry_definition(), request.asset_root)


def _pack(arrays: dict[str, np.ndarray]) -> tuple[bytes, dict[str, Any]]:
    layouts = {
        "positions": ("float64", "node", "m"),
        "triangles": ("uint32", "triangle", "1"),
        "triangleFaces": ("uint32", "triangle", "1"),
        "edgePositions": ("float64", "edge-node", "m"),
        "edgeSegments": ("uint32", "edge-segment", "1"),
        "segmentEdges": ("uint32", "edge-segment", "1"),
    }
    buffer = bytearray()
    descriptors = {}
    for name, source in arrays.items():
        dtype, association, units = layouts[name]
        array = np.asarray(source, dtype="<f8" if dtype == "float64" else "<u4")
        buffer.extend(b"\0" * (-len(buffer) % 8))
        offset = len(buffer)
        payload = array.tobytes()
        if len(buffer) + len(payload) > MAX_BUFFER_BYTES:
            raise EngineError("cad-resource-limit", "CAD display buffers exceed 64 MiB.")
        buffer.extend(payload)
        descriptors[name] = {
            "offset": offset,
            "byteLength": len(payload),
            "dtype": dtype,
            "shape": list(array.shape),
            "association": association,
            "units": units,
        }
    return bytes(buffer), descriptors


def execute(request: CadRequest, output: Path) -> dict[str, Any]:
    if request.operation == "solve-sketch":
        return execute_sketch(request)
    if request.operation == "mesh-cad":
        return execute_mesh(request, output)
    geometry = request.geometry_definition()
    assets = _read_assets(request)
    with cad_log_to_stderr():
        # Align both CRT and process handles before loading native shape DLLs.
        from phyra_engine.geometry.cad.compatibility import eligibility
        from phyra_engine.geometry.cad.kernel import build, export_brep, export_step
        from phyra_engine.geometry.cad.tessellation import tessellate
        from phyra_engine.geometry.cad.topology import bounds, properties

        result = build(geometry, assets)
        brep = export_brep(result.shape)
        step = export_step(result.shape)
        step_mm = export_step(result.shape, "mm")
        display = tessellate(result.shape, result.output_feature_id, result.body_instances)
        analysis_compatibility = eligibility(
            geometry,
            [entity.metadata() for entity in display.faces],
            [entity.metadata() for entity in display.edges],
        )
    buffer, descriptors = _pack(display.arrays)
    if any(not 0 < len(payload) <= MAX_BUFFER_BYTES for payload in (brep, step, step_mm)):
        raise EngineError("cad-resource-limit", "An exact CAD artifact exceeds 64 MiB.")
    if sum(map(len, (buffer, brep, step, step_mm))) > 128 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "CAD publication exceeds 128 MiB.")
    diagnostics: list[dict[str, Any]] = [
        {
            "code": "definition-only",
            "severity": "info",
            "message": (
                "CAD geometry is saved independently; "
                "each study needs its own solver eligibility check."
            ),
        },
        {
            "code": "content-references",
            "severity": "info",
            "message": (
                "Entity references identify unchanged geometry. "
                "Changed or ambiguous selections require repair."
            ),
        },
    ]
    ambiguous = [e.reference for e in display.faces + display.edges + display.bodies if e.ambiguous]
    if any(member.component_path for member in result.body_instances):
        diagnostics.append(
            {
                "code": "independent-components",
                "severity": "info",
                "message": (
                    "Assembly components are independent solids without inferred "
                    "bonds or contacts. "
                    "Displayed volume sums component volumes, including overlapping regions."
                ),
            }
        )
    inactive = len(geometry["features"]) - len(result.feature_metadata)
    if inactive:
        diagnostics.append(
            {
                "code": "inactive-history",
                "severity": "info",
                "message": f"{inactive} authored feature(s) are outside the selected output's "
                "dependency closure and were not evaluated.",
            }
        )
    if ambiguous:
        diagnostics.append(
            {
                "code": "ambiguous-topology",
                "severity": "warning",
                "message": (
                    "Some coincident entity references are ambiguous and cannot be assigned."
                ),
                "entityIds": ambiguous,
            }
        )
    solid_volume = sum(entity.metadata()["volume"] for entity in display.bodies)
    area, _ = properties(result.shape, "face")
    manifest = {
        "protocolVersion": 1,
        "status": "succeeded",
        "operation": "cad",
        "projectId": request.project_id,
        "revision": request.revision,
        "jobId": request.job_id,
        "geometryFingerprint": hashlib.sha256(request._geometry_json).hexdigest(),
        "outputFeatureId": result.output_feature_id,
        "kernel": {
            "name": "OpenCASCADE",
            "version": "8.0.1",
            "binding": "cadquery-ocp-novtk",
            "bindingVersion": version("cadquery-ocp-novtk"),
        },
        "coordinateFrame": "cartesian-global-SI",
        "byteLength": len(buffer),
        "bufferHash": hashlib.sha256(buffer).hexdigest(),
        "arrays": descriptors,
        "faces": [entity.metadata() for entity in display.faces],
        "edges": [entity.metadata() for entity in display.edges],
        "bodies": [entity.metadata() for entity in display.bodies],
        "features": list(result.feature_metadata),
        "analysisCompatibility": analysis_compatibility,
        "diagnostics": diagnostics,
        "statistics": {
            "bounds": bounds(result.shape),
            "surfaceArea": area,
            "volume": solid_volume,
            "faceCount": len(display.faces),
            "edgeCount": len(display.edges),
            "bodyCount": len(display.bodies),
            "nodes": len(display.arrays["positions"]),
            "triangles": len(display.arrays["triangles"]),
            "displayDeflection": display.deflection,
        },
        "assets": {
            "brep": {
                "filename": "output.brep",
                "byteLength": len(brep),
                "sha256": hashlib.sha256(brep).hexdigest(),
                "units": "m",
            },
            "step": {
                "filename": "output.step",
                "byteLength": len(step),
                "sha256": hashlib.sha256(step).hexdigest(),
                "units": "m",
            },
            "stepMm": {
                "filename": "output-mm.step",
                "byteLength": len(step_mm),
                "sha256": hashlib.sha256(step_mm).hexdigest(),
                "units": "mm",
            },
        },
    }
    receipt = json.dumps(manifest, separators=(",", ":"), allow_nan=False).encode("utf-8")
    if len(receipt) > MAX_REQUEST_BYTES:
        raise EngineError("cad-resource-limit", "CAD receipt exceeds 1 MiB.")
    if sum(map(len, (receipt, buffer, brep, step, step_mm))) > 128 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "CAD publication exceeds 128 MiB.")
    output.mkdir(parents=True, exist_ok=True)
    for name, payload in (
        ("buffer.bin", buffer),
        ("output.brep", brep),
        ("output.step", step),
        ("output-mm.step", step_mm),
        ("receipt.json", receipt),
    ):
        temporary = output / (name + ".tmp")
        temporary.write_bytes(payload)
        temporary.replace(output / name)
    return manifest


def execute_mesh(request: CadRequest, output: Path) -> dict[str, Any]:
    """Inspect one exact solid without creating a study, shape receipt or physical fields."""
    assets = _read_assets(request)
    with cad_log_to_stderr():
        from phyra_engine.geometry.cad.kernel import build, export_step
        from phyra_engine.meshing.cad import generate_cad_mesh
        from phyra_engine.results.cad_mesh import write_cad_mesh

        result = build(request.geometry_definition(), assets)
        if any(instance.component_path for instance in result.body_instances):
            raise EngineError(
                "unsupported-cad-mesh",
                "Assembly component meshes require explicit connectivity and are not supported.",
            )
        if request.target_size is None:
            raise EngineError("invalid-cad-mesh", "A mesh inspection target size is required.")
        # Exact CAD receipts identify topology after the bounded STEP transfer,
        # which can clear OCCT's Checked cache flags. Preserve those existing
        # content references by performing the same preparation here. The bytes
        # are not published and confer no exact-export ownership on this job.
        export_step(result.shape)
        inspected = generate_cad_mesh(
            result.shape, request.target_size, owner_id=result.output_feature_id
        )
        return write_cad_mesh(
            output,
            inspected,
            project_id=request.project_id,
            revision=request.revision,
            job_id=request.job_id,
            geometry_fingerprint=hashlib.sha256(request._geometry_json).hexdigest(),
            output_feature_id=result.output_feature_id,
        )


def execute_sketch(request: CadRequest) -> dict[str, Any]:
    """Solve an authoring graph without requiring a closed profile or creating files."""
    from phyra_engine.geometry.sketch_constraints import decode_sketch, solve_sketch

    feature = next(
        item
        for item in request.geometry_definition()["features"]
        if item["id"] == request.feature_id
    )
    authored = feature["sketch"]
    with kernel_log_to_stderr():
        result = solve_sketch(authored)
    solved = deepcopy(authored)
    if result.status in ("solved", "redundant"):
        positions = {point.id: list(point.position) for point in result.points}
        radii = {entity.id: entity.radius for entity in result.entities if entity.kind == "circle"}
        for point in solved["points"]:
            point["position"] = positions[point["id"]]
        for entity in solved["entities"]:
            if entity["kind"] == "circle":
                entity["radius"] = radii[entity["id"]]
    # Revalidate finite coordinates, radii, graph bounds and exact references
    # before transport. Conflicting/nonconverged results retain authored values.
    decode_sketch(solved)
    manifest = {
        "protocolVersion": 1,
        "status": "succeeded",
        "operation": "solve-sketch",
        "projectId": request.project_id,
        "revision": request.revision,
        "jobId": request.job_id,
        "featureId": request.feature_id,
        "geometryFingerprint": hashlib.sha256(request._geometry_json).hexdigest(),
        "sketch": solved,
        "report": {
            "kernel": result.kernel,
            "sourceCommit": result.source_commit,
            "status": result.status,
            "degreesOfFreedom": result.degrees_of_freedom,
            "failedConstraintIds": list(result.failed_constraint_ids),
        },
    }
    if (
        len(json.dumps(manifest, separators=(",", ":"), allow_nan=False).encode("utf-8"))
        > MAX_REQUEST_BYTES
    ):
        raise EngineError("cad-resource-limit", "Sketch solve response exceeds 1 MiB.")
    return manifest


def main() -> int:
    cast(io.TextIOWrapper, sys.stdout).reconfigure(encoding="utf-8", errors="strict")
    cast(io.TextIOWrapper, sys.stderr).reconfigure(encoding="utf-8", errors="backslashreplace")
    parser = argparse.ArgumentParser()
    parser.add_argument("--cad", action="store_true")
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    job_id = "unknown"
    try:
        request = read_cad_request(sys.stdin.buffer)
        job_id = request.job_id
        manifest = execute(request, args.output)
        emit({"type": "complete", "manifest": manifest})
        return 0
    except EngineError as error:
        emit({"type": "error", "jobId": job_id, "code": error.code, "message": str(error)})
        return 2
    except (json.JSONDecodeError, UnicodeDecodeError, OSError, ValueError, RecursionError) as error:
        emit({"type": "error", "jobId": job_id, "code": "invalid-request", "message": str(error)})
        return 2
    except Exception as error:
        print(f"Unexpected CAD worker failure: {type(error).__name__}: {error}", file=sys.stderr)
        emit(
            {
                "type": "error",
                "jobId": job_id,
                "code": "cad-worker-failed",
                "message": "The isolated CAD worker failed. Review its local log.",
            }
        )
        return 1
