"""Versioned project validation; the shared JSON Schema is authoritative."""

import hashlib
import json
import math
import re
import sys
from copy import deepcopy
from functools import lru_cache
from pathlib import Path
from typing import Any

from jsonschema import Draft7Validator  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.geometry.regions import SOLID_REGIONS
from phyra_engine.studies.validation import validate_physical_project

SELECTION_WHITESPACE = (
    "\u0009\u000a\u000b\u000c\u000d\u001c\u001d\u001e\u001f\u0020\u0085\u00a0\u1680"
    "\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a"
    "\u2028\u2029\u202f\u205f\u3000\ufeff"
)


@lru_cache(maxsize=5)
def project_validator(version: int = 5) -> Draft7Validator:
    frozen = getattr(sys, "_MEIPASS", None)
    root = Path(frozen) if frozen else Path(__file__).resolve().parents[3]
    filename = "project.schema.json" if version == 5 else f"project-v{version}.schema.json"
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


def _validate_named_selections(project: dict[str, Any]) -> None:
    selection_ids: set[str] = set()
    selection_names: set[str] = set()
    geometry = project["geometry"]
    for selection in project["namedSelections"]:
        # Sets are copied preparation metadata. Validate their stamped topology
        # even when it differs from the current geometry; orphans remain repairable.
        name = (
            selection["name"]
            .strip(SELECTION_WHITESPACE)
            .translate(str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz"))
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
        kind = selection["geometryKind"]
        if selection["dimension"] == "2d" and kind not in ("box", "profile"):
            raise EngineError(
                "invalid-selection", "2D boundary sets require rectangular or profile geometry."
            )
        if kind == "profile":
            valid_regions = selection["dimension"] == "2d" and all(
                re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,99}", region)
                for region in selection["regions"]
            )
        else:
            selection_regions = (
                ("x0", "x1", "y0", "y1") if selection["dimension"] == "2d" else SOLID_REGIONS[kind]
            )
            valid_regions = set(selection["regions"]).issubset(selection_regions)
        if not valid_regions:
            raise EngineError(
                "invalid-selection", "A boundary set refers to an unavailable stamped boundary."
            )
    # Keep this explicit reference so a malformed geometry cannot silently
    # bypass the schema's geometry-kind validation after an in-memory mutation.
    if geometry["kind"] not in ("box", "cylinder", "bracket", "profile"):
        raise EngineError("invalid-geometry", "Unsupported geometry kind.")


def validate_project(project: Any) -> dict[str, Any]:
    _finite_tree(project)
    version = project.get("schemaVersion") if isinstance(project, dict) else None
    if type(version) is not int or version not in (1, 2, 3, 4, 5):
        raise EngineError("unsupported-version", "Supported project versions are 1, 2, 3, 4 and 5.")
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
    if version >= 3:
        _validate_named_selections(project)
    validate_physical_project(project, version)
    return project


def migrate_project(project: Any) -> dict[str, Any]:
    """Validate legacy inputs before explicitly upgrading their study contract."""
    validate_project(project)
    if project["schemaVersion"] == 5:
        return project
    source_version = project["schemaVersion"]
    upgraded = deepcopy(project)
    upgraded["schemaVersion"] = 5
    if source_version < 3:
        upgraded["namedSelections"] = []
    if source_version == 1:
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
    upgraded["study"]["solver"]["pinn"]["formulation"] = "strong-form"
    return validate_project(upgraded)


def fingerprint(project: dict[str, Any]) -> str:
    """Display and copied boundary metadata never change a physical input digest."""
    canonical = {
        key: deepcopy(value)
        for key, value in project.items()
        if key not in {"name", "revision", "displayUnits", "namedSelections"}
    }
    # v3 added only copied boundary sets. A migrated v3 definition retains the
    # same physical contract and may keep its validated cache. New v4 profile or
    # traction inputs keep their own schema version in the physical fingerprint.
    if (
        canonical.get("schemaVersion") == 5
        and canonical["study"]["solver"]["pinn"].get("formulation") == "strong-form"
    ):
        del canonical["study"]["solver"]["pinn"]["formulation"]
        canonical["schemaVersion"] = 4
    if canonical.get("schemaVersion") == 3:
        canonical["schemaVersion"] = 2
    elif canonical.get("schemaVersion") == 4:
        has_new_physics = canonical["geometry"]["kind"] == "profile" or any(
            load["kind"] == "traction" for load in canonical["study"]["loads"]
        )
        if not has_new_physics:
            canonical["schemaVersion"] = 2
    encoded = json.dumps(canonical, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()
