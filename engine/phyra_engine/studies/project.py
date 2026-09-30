"""Versioned project validation; the shared JSON Schema is authoritative."""

import hashlib
import json
import math
import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_CELLS, MAX_NODES, MAX_TRIANGLES
from phyra_engine.geometry.regions import SOLID_REGIONS

SELECTION_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


@lru_cache(maxsize=3)
def project_validator(version: int = 3) -> Draft7Validator:
    frozen = getattr(sys, "_MEIPASS", None)
    root = Path(frozen) if frozen else Path(__file__).resolve().parents[3]
    filename = f"project-v{version}.schema.json" if version in (1, 2) else "project.schema.json"
    schema = json.loads((root / "contracts" / filename).read_text(encoding="utf-8"))
    Draft7Validator.check_schema(schema)
    return Draft7Validator(schema)


def _finite_tree(value: Any) -> None:
    # JSON size is bounded at the transport boundary; depth and scalar counts
    # independently bound validation work and avoid recursive stack exhaustion.
    pending, count = [(value, 0)], 0
    while pending:
        child, depth = pending.pop()
        count += 1
        if depth > 64 or count > 100_000:
            raise EngineError("resource-limit", "Metadata nesting or size exceeds its limit.")
        if isinstance(child, dict):
            pending.extend((item, depth + 1) for item in child.values())
        elif isinstance(child, list):
            pending.extend((item, depth + 1) for item in child)
        elif isinstance(child, float) and not math.isfinite(child):
            raise EngineError("nonfinite-input", "Every physical input must be finite.")


def validate_project(project: Any) -> dict[str, Any]:
    _finite_tree(project)
    version = project.get("schemaVersion") if isinstance(project, dict) else None
    if type(version) is not int or version not in (1, 2, 3):
        raise EngineError("unsupported-version", "Supported project versions are 1, 2 and 3.")
    errors = sorted(project_validator(version).iter_errors(project), key=lambda e: str(e.path))
    if errors:
        error = errors[0]
        path = ".".join(map(str, error.absolute_path)) or "project"
        raise EngineError("invalid-project", f"{path}: {error.message}")
    if type(project["revision"]) is not int:
        raise EngineError("invalid-project", "Project revision must be an integer.")
    if version >= 2 and any(
        type(project["study"]["solver"]["pinn"][key]) is not int
        for key in ("layers", "width", "steps", "interiorPoints", "boundaryPoints", "seed")
    ):
        raise EngineError("invalid-project", "PINN counts and seed must be integers.")
    geometry = project["geometry"]
    if geometry["kind"] == "bracket" and geometry["thickness"] >= min(
        geometry["length"], geometry["width"]
    ):
        raise EngineError("invalid-geometry", "Bracket thickness must be below length and width.")
    study = project["study"]
    plane = study.get("dimension") == "2d"
    if version >= 2:
        if plane and (geometry["kind"] != "box" or study["formulation"] != "plane-stress"):
            raise EngineError(
                "unsupported-study", "2D currently supports rectangular plane stress."
            )
        if not plane and (study["formulation"] != "solid" or study["solver"]["kind"] != "fem"):
            raise EngineError(
                "unsupported-study", "3D currently supports solid elasticity with FEM."
            )
    if version == 3:
        selection_ids: set[str] = set()
        selection_names: set[str] = set()
        for selection in project["namedSelections"]:
            # Sets are copied preparation metadata. Validate their stamped
            # topology even when it differs from the current geometry; an
            # orphan cannot assign loads but must survive save/reopen.
            name = (
                selection["name"]
                .strip(SELECTION_WHITESPACE)
                .translate(
                    str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")
                )
            )
            if not selection["id"].strip(SELECTION_WHITESPACE) or not name:
                raise EngineError(
                    "invalid-selection", "Boundary set identifiers and names must not be blank."
                )
            if selection["id"] in selection_ids or name in selection_names:
                raise EngineError(
                    "invalid-selection", "Boundary set identifiers and names must be unique."
                )
            selection_ids.add(selection["id"])
            selection_names.add(name)
            if selection["dimension"] == "2d" and selection["geometryKind"] != "box":
                raise EngineError(
                    "invalid-selection", "2D boundary sets require rectangular geometry."
                )
            selection_regions = (
                ("x0", "x1", "y0", "y1")
                if selection["dimension"] == "2d"
                else SOLID_REGIONS[selection["geometryKind"]]
            )
            if not set(selection["regions"]).issubset(selection_regions):
                raise EngineError(
                    "invalid-selection", "A boundary set refers to an unavailable stamped boundary."
                )
    ids = [item["id"] for item in study["constraints"] + study["loads"]]
    if len(ids) != len(set(ids)):
        raise EngineError("invalid-assignment", "Support and load identifiers must be unique.")
    allowed = set(("x0", "x1", "y0", "y1") if plane else SOLID_REGIONS[geometry["kind"]])
    for item in study["constraints"] + study["loads"]:
        if not set(item["regions"]).issubset(allowed):
            raise EngineError("invalid-region", "An assignment refers to an unavailable boundary.")
    for constraint in study["constraints"]:
        if plane and constraint["components"][2] is not None:
            raise EngineError(
                "invalid-assignment", "Plane stress has only X and Y displacement DOFs."
            )
        if all(component is None for component in constraint["components"]):
            raise EngineError(
                "empty-constraint", "A support must prescribe at least one component."
            )
    if plane:
        if any(load["vector"][2] != 0 for load in study["loads"]):
            raise EngineError("invalid-assignment", "Plane stress supports in-plane loads only.")
        length, width, size = geometry["length"], geometry["width"], study["mesh"]["size"]
        if (
            min(length, width, study["thickness"]) / max(length, width) < 1e-6
            or max(length, width) < 1e-90
        ):
            raise EngineError(
                "unsupported-geometry", "Plane geometry is too thin or small for float64 geometry."
            )
        if size < max(length, width) / MAX_NODES:
            raise EngineError("resource-limit", "Requested 2D mesh exceeds resource limits.")
        nx, ny = math.ceil(length / size), math.ceil(width / size)
        if (nx + 1) * (ny + 1) > MAX_NODES or 2 * nx * ny > MAX_CELLS:
            raise EngineError("resource-limit", "Requested 2D mesh exceeds resource limits.")
        return project
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


def migrate_project(project: Any) -> dict[str, Any]:
    """Validate legacy inputs before explicitly upgrading their study contract."""
    validate_project(project)
    if project["schemaVersion"] == 3:
        return project
    upgraded = deepcopy(project)
    upgraded["schemaVersion"] = 3
    upgraded["namedSelections"] = []
    if project["schemaVersion"] == 1:
        upgraded["study"].update(
            dimension="3d",
            formulation="solid",
            thickness=project["geometry"]["height"],
            solver={
                "kind": "fem",
                "pinn": {
                    "layers": 3,
                    "width": 32,
                    "activation": "tanh",
                    "optimizer": "adam",
                    "learningRate": 0.001,
                    "steps": 1000,
                    "interiorPoints": 128,
                    "boundaryPoints": 32,
                    "seed": 42,
                    "device": "auto",
                },
            },
        )
    return validate_project(upgraded)


def fingerprint(project: dict[str, Any]) -> str:
    """Display metadata never changes the canonical physical input digest."""
    canonical = {
        key: value
        for key, value in project.items()
        if key not in {"name", "revision", "displayUnits", "namedSelections"}
    }
    # v3 only adds nonphysical copied boundary sets. Preserve the v2 digest
    # format so its validated fields remain reusable after explicit migration.
    if canonical.get("schemaVersion") == 3:
        canonical["schemaVersion"] = 2
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
