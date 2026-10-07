"""Bounded immutable STEP source decoding shared by CAD and numerical requests."""

import hashlib
import os
import re
import stat
from pathlib import Path
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES


def read_cad_assets(geometry: dict[str, Any], asset_root: str | None) -> dict[str, bytes]:
    """Snapshot native-owned files; no caller path or lazy reads escape decoding."""
    if asset_root is None:
        if geometry["assets"]:
            raise EngineError("invalid-cad-assets", "Native-owned STEP sources are required.")
        return {}
    if not isinstance(asset_root, str) or not 1 <= len(asset_root) <= 4096:
        raise EngineError("invalid-cad-assets", "The native CAD asset root is invalid.")
    root = Path(asset_root)
    if not root.is_absolute() or root.is_symlink() or not root.is_dir():
        raise EngineError("invalid-cad-assets", "The native CAD asset root is invalid.")
    assets: dict[str, bytes] = {}
    total = 0
    for metadata in geometry["assets"]:
        digest = metadata["sha256"]
        if not re.fullmatch(r"[a-f0-9]{64}", digest):
            raise EngineError("invalid-cad-assets", "CAD source identity is invalid.")
        source = root / f"{digest}.step"
        if source.is_symlink() or not source.is_file():
            raise EngineError("invalid-cad-assets", "A native-owned STEP source is missing.")
        # Prevent a swapped symlink or FIFO from escaping the finite file read.
        descriptor = os.open(
            source, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_NONBLOCK", 0)
        )
        with os.fdopen(descriptor, "rb") as stream:
            opened_status = os.fstat(stream.fileno())
            if not stat.S_ISREG(opened_status.st_mode):
                raise EngineError("invalid-cad-assets", "A CAD source is not a regular file.")
            expected = metadata["byteLength"]
            if opened_status.st_size != expected or total + expected > MAX_BUFFER_BYTES:
                raise EngineError(
                    "cad-resource-limit", "STEP source sizes exceed the CAD asset budget."
                )
            payload = stream.read(expected + 1)
        if len(payload) != expected or hashlib.sha256(payload).hexdigest() != digest:
            raise EngineError(
                "invalid-cad-assets", "A STEP source failed its size or integrity check."
            )
        assets[metadata["id"]] = payload
        total += len(payload)
    return assets
