"""Bounded request decoding and versioned operation/identity checks."""

import json
import re
from typing import Any, BinaryIO

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_REQUEST_BYTES

PROTOCOL_VERSION = 1
OPERATIONS = frozenset(("mesh", "solve", "validate", "train", "compare", "devices"))


def reject_constant(value: str) -> None:
    raise EngineError("nonfinite-input", f"JSON does not allow {value}.")


def read_request(stream: BinaryIO) -> dict[str, Any]:
    payload = stream.read(MAX_REQUEST_BYTES + 1)
    if len(payload) > MAX_REQUEST_BYTES:
        raise EngineError("resource-limit", "Request exceeds the 1 MiB limit.")
    request = json.loads(payload, parse_constant=reject_constant)
    if not isinstance(request, dict) or set(request) != {
        "protocolVersion",
        "operation",
        "jobId",
        "project",
    }:
        raise EngineError(
            "invalid-request", "Request does not match the versioned command contract."
        )
    return request


def job_identity(value: Any) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[A-Za-z0-9_-]{1,100}", value):
        raise EngineError("invalid-request", "Job identity must be a safe opaque identifier.")
    return value


def validate_version(value: Any) -> None:
    if type(value) is not int or value != PROTOCOL_VERSION:
        raise EngineError("unsupported-version", "Unsupported engine protocol version.")


def validate_operation(value: Any) -> str:
    if not isinstance(value, str) or value not in OPERATIONS:
        raise EngineError("unsupported-operation", "Unsupported engine operation.")
    return value
