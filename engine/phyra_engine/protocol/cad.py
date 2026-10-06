"""Native-owned CAD request decoding with an immutable canonical recipe snapshot."""

import json
from dataclasses import dataclass
from typing import Any, BinaryIO

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

    @classmethod
    def from_payload(cls, payload: Any) -> "CadRequest":
        if not isinstance(payload, dict) or set(payload) != {
            "protocolVersion",
            "jobId",
            "projectId",
            "revision",
            "geometry",
            "assetRoot",
        }:
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
        snapshot = json.dumps(geometry, separators=(",", ":"), allow_nan=False).encode("utf-8")
        if len(snapshot) > MAX_REQUEST_BYTES:
            raise EngineError("cad-resource-limit", "The CAD recipe exceeds its request limit.")
        return cls(job_id, project_id, revision, asset_root, snapshot)

    def geometry_definition(self) -> dict[str, Any]:
        return json.loads(self._geometry_json)


def read_cad_request(stream: BinaryIO) -> CadRequest:
    encoded = stream.read(MAX_REQUEST_BYTES + 1)
    if len(encoded) > MAX_REQUEST_BYTES:
        raise EngineError("cad-resource-limit", "The CAD request exceeds 1 MiB.")
    return CadRequest.from_payload(json.loads(encoded, parse_constant=reject_constant))
