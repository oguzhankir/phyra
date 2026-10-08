"""Native-owned CAD request decoding with an immutable canonical recipe snapshot."""

import json
import math
from dataclasses import dataclass
from typing import Any, BinaryIO, Literal, cast

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_REQUEST_BYTES
from phyra_engine.protocol.request import job_identity, reject_constant, validate_version
from phyra_engine.studies.project import validate_cad_geometry


@dataclass(frozen=True)
class CadRequest:
    job_id: str
    project_id: str
    revision: int
    asset_root: str
    _geometry_json: bytes
    operation: Literal["cad", "solve-sketch", "mesh-cad"] = "cad"
    feature_id: str | None = None
    target_size: float | None = None

    @classmethod
    def from_payload(cls, payload: Any) -> "CadRequest":
        base_fields = {
            "protocolVersion",
            "jobId",
            "projectId",
            "revision",
            "geometry",
            "assetRoot",
        }
        if not isinstance(payload, dict):
            raise EngineError(
                "invalid-request", "CAD request does not match its versioned contract."
            )
        operation = payload.get("operation", "cad")
        if operation == "solve-sketch":
            expected_fields = base_fields | {"operation", "featureId"}
        elif operation == "mesh-cad":
            expected_fields = base_fields | {"operation", "targetSize"}
        elif operation == "cad":
            expected_fields = base_fields | ({"operation"} if "operation" in payload else set())
        else:
            raise EngineError("invalid-request", "CAD request operation is not supported.")
        if set(payload) != expected_fields:
            raise EngineError(
                "invalid-request", "CAD request does not match its versioned contract."
            )
        validate_version(payload["protocolVersion"])
        job_id = job_identity(payload["jobId"])
        project_id, revision, asset_root = (
            payload[k] for k in ("projectId", "revision", "assetRoot")
        )
        if not isinstance(project_id, str) or not 1 <= len(project_id) <= 100:
            raise EngineError("invalid-request", "CAD project identity must be a bounded string.")
        if type(revision) is not int or not 0 <= revision <= 2**53 - 1:
            raise EngineError("invalid-request", "CAD revision must be a nonnegative safe integer.")
        if not isinstance(asset_root, str) or not 1 <= len(asset_root) <= 4096:
            raise EngineError("invalid-request", "The native CAD asset root is unavailable.")
        geometry = validate_cad_geometry(payload["geometry"])
        target_size = None
        if operation == "mesh-cad":
            target_size = payload["targetSize"]
            if (
                isinstance(target_size, bool)
                or not isinstance(target_size, (int, float))
                or not math.isfinite(target_size)
                or not 0 < target_size <= 1000
                or geometry["dimension"] != "3d"
            ):
                raise EngineError(
                    "invalid-cad-mesh",
                    "Mesh inspection requires 3D CAD and a positive target size at most 1000 m.",
                )
            target_size = float(target_size)
        feature_id = None
        if operation == "solve-sketch":
            feature_id = payload["featureId"]
            if not isinstance(feature_id, str) or not any(
                feature["id"] == feature_id and feature["kind"] == "sketch"
                for feature in geometry["features"]
            ):
                raise EngineError("invalid-request", "Select an existing sketch to solve.")
        snapshot = json.dumps(geometry, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(snapshot) > MAX_REQUEST_BYTES:
            raise EngineError("cad-resource-limit", "The CAD recipe exceeds its request limit.")
        return cls(
            job_id,
            project_id,
            revision,
            asset_root,
            snapshot,
            cast(Literal["cad", "solve-sketch", "mesh-cad"], operation),
            feature_id,
            target_size,
        )

    def geometry_definition(self) -> dict[str, Any]:
        return json.loads(self._geometry_json)


def read_cad_request(stream: BinaryIO) -> CadRequest:
    encoded = stream.read(MAX_REQUEST_BYTES + 1)
    if len(encoded) > MAX_REQUEST_BYTES:
        raise EngineError("cad-resource-limit", "The CAD request exceeds 1 MiB.")
    return CadRequest.from_payload(json.loads(encoded, parse_constant=reject_constant))
