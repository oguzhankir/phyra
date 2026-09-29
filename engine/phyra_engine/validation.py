"""Versioned project validation; the shared JSON Schema is authoritative."""

import hashlib
import json
import math
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator  # type: ignore[import-untyped]

from .errors import EngineError

MAX_NODES = 12_000
MAX_CELLS = 50_000
MAX_TRIANGLES = 100_000
MAX_BUFFER_BYTES = 64 * 1024 * 1024
MAX_REQUEST_BYTES = 1024 * 1024
REGIONS = {
    "box": ("x0", "x1", "y0", "y1", "z0", "z1"),
    "cylinder": ("x0", "x1", "outer"),
    "bracket": ("x0", "x1", "y0", "y1", "z0", "z1", "inner-x", "inner-y"),
}


@lru_cache(maxsize=1)
def project_validator() -> Draft7Validator:
    frozen = getattr(sys, "_MEIPASS", None)
    root = Path(frozen) if frozen else Path(__file__).resolve().parents[2]
    schema = json.loads((root / "contracts" / "project.schema.json").read_text())
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def _finite_tree(value: Any) -> None:
    if isinstance(value, dict):
        for child in value.values():
            _finite_tree(child)
    elif isinstance(value, list):
        for child in value:
            _finite_tree(child)
    elif isinstance(value, float) and not math.isfinite(value):
        raise EngineError("nonfinite-input", "Every physical input must be finite.")


def validate_project(project: Any) -> dict[str, Any]:
    _finite_tree(project)
    errors = sorted(project_validator().iter_errors(project), key=lambda e: str(e.path))
    if errors:
        error = errors[0]
        path = ".".join(map(str, error.absolute_path)) or "project"
        raise EngineError("invalid-project", f"{path}: {error.message}")
    geometry = project["geometry"]
    if geometry["kind"] == "bracket" and geometry["thickness"] >= min(
        geometry["length"], geometry["width"]
    ):
        raise EngineError("invalid-geometry", "Bracket thickness must be below length and width.")
    study = project["study"]
    ids = [item["id"] for item in study["constraints"] + study["loads"]]
    if len(ids) != len(set(ids)):
        raise EngineError("invalid-assignment", "Support and load identifiers must be unique.")
    allowed = set(REGIONS[geometry["kind"]])
    for item in study["constraints"] + study["loads"]:
        if not set(item["regions"]).issubset(allowed):
            raise EngineError("invalid-region", "An assignment refers to an unavailable boundary.")
    for constraint in study["constraints"]:
        if all(component is None for component in constraint["components"]):
            raise EngineError(
                "empty-constraint", "A support must prescribe at least one component."
            )
    # Work estimates use nondimensional geometry, avoiding under/overflow from
    # untrusted tiny sizes. Cylinder curvature refinement also consumes resources.
    kind = geometry["kind"]
    active = (
        [geometry["length"], 2 * geometry["radius"]]
        if kind == "cylinder"
        else [geometry[key] for key in ("length", "width", "height")]
    )
    if kind == "bracket":
        active.extend(
            [
                geometry["thickness"],
                geometry["length"] - geometry["thickness"],
                geometry["width"] - geometry["thickness"],
            ]
        )
    scale = max(active)
    if min(active) / scale < 1e-6 or scale < 1e-90:
        raise EngineError(
            "unsupported-geometry",
            "Geometry is too thin or small for the supported float64 solid mesher.",
        )
    length = geometry["length"] / scale
    width = geometry["width"] / scale
    height = geometry["height"] / scale
    radius = geometry["radius"] / scale
    thickness = geometry["thickness"] / scale
    size = study["mesh"]["size"] / scale
    if kind == "cylinder":
        volume = math.pi * radius**2 * length
        area = 2 * math.pi * radius * (length + radius)
        size = min(size, 2 * math.pi * radius / 24)
    elif kind == "bracket":
        footprint = thickness * (length + width - thickness)
        volume = footprint * height
        area = 2 * footprint + 2 * (length + width) * height
    else:
        volume = length * width * height
        area = 2 * (length * width + width * height + height * length)
    if size < (12 * volume / MAX_CELLS) ** (1 / 3) or size < (4 * area / MAX_TRIANGLES) ** 0.5:
        raise EngineError(
            "resource-limit",
            "Requested mesh or curvature refinement exceeds resource limits. "
            "Increase target size or reduce solid aspect ratio.",
        )
    return project


def fingerprint(project: dict[str, Any]) -> str:
    """Display metadata never changes the canonical physical input digest."""
    canonical = {
        key: value
        for key, value in project.items()
        if key not in {"name", "revision", "displayUnits"}
    }
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
