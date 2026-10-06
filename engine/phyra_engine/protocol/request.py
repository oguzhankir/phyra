"""Bounded request decoding and versioned operation/identity checks."""

import json
import re
from dataclasses import dataclass
from typing import Any, BinaryIO, Literal, cast

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_REQUEST_BYTES
from phyra_engine.studies.project import validate_numerical_project

PROTOCOL_VERSION = 1
Operation = Literal["mesh", "solve", "validate", "train", "compare", "devices"]
OPERATIONS = frozenset(("mesh", "solve", "validate", "train", "compare", "devices"))


@dataclass(frozen=True)
class StudyRequest:
    """Validated identity and an immutable physical input snapshot.

    Store JSON bytes rather than a frozen record containing mutable dictionaries.
    Each application execution receives an isolated definition; neither callers
    nor numerical adapters can change the request's authoritative input snapshot.
    The shared JSON schema remains the only project-format definition.
    """

    job_id: str
    operation: Operation
    _project_json: bytes

    @classmethod
    def from_payload(cls, payload: dict[str, Any]) -> "StudyRequest":
        validate_envelope(payload)
        job_id = job_identity(payload["jobId"])
        validate_version(payload["protocolVersion"])
        operation = validate_operation(payload["operation"])
        project = validate_numerical_project(payload["project"])
        snapshot = json.dumps(project, separators=(",", ":"), allow_nan=False).encode("utf-8")
        return cls(job_id, operation, snapshot)

    def project_definition(self) -> dict[str, Any]:
        return cast(dict[str, Any], json.loads(self._project_json))


def reject_constant(value: str) -> None:
    raise EngineError("nonfinite-input", f"JSON does not allow {value}.")


def validate_envelope(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != {
        "protocolVersion",
        "operation",
        "jobId",
        "project",
    }:
        raise EngineError(
            "invalid-request", "Request does not match the versioned command contract."
        )
    return value


def read_request(stream: BinaryIO) -> dict[str, Any]:
    payload = stream.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise EngineError("resource-limit", "Request exceeds the 1 MiB limit.")
    return validate_envelope(json.loads(payload, parse_constant=reject_constant))


def job_identity(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise EngineError("invalid-request", "Job identity must be a safe opaque identifier.")
    return value


def validate_version(value: Any) -> None:
    if type(value) is not int or value != PROTOCOL_VERSION:
        raise EngineError("unsupported-version", "Unsupported engine protocol version.")


def validate_operation(value: Any) -> Operation:
    if not isinstance(value, str) or value not in OPERATIONS:
        raise EngineError("unsupported-operation", "Unsupported engine operation.")
    return cast(Operation, value)
