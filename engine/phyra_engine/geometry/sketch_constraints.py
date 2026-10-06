"""Bounded authored sketches solved by the pinned, local SolveSpace C ABI.

This module is called on the main thread of the owned CAD worker. libslvs uses
process-global state, so it must not run in native UI threads or parallel threads.
The worker owns process isolation/cancellation; definitions are immutable snapshots.
Primary API: https://github.com/solvespace/solvespace/blob/v3.2/include/slvs.h
"""

from __future__ import annotations

import ctypes as ct
import hashlib
import math
import platform
import sys
import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any, Literal, cast

from phyra_engine.errors import EngineError
from phyra_engine.geometry.profile import validate_profile

SOURCE_COMMIT = "27b6a080c8b669421bd4d444650c3b8eddec5687"
MAX_POINTS = 256
MAX_ENTITIES = 256
MAX_CONSTRAINTS = 512
MAX_LOOPS = 64
SketchStatus = Literal["solved", "redundant", "conflicting", "nonConverged", "tooManyUnknowns"]


@dataclass(frozen=True)
class SketchPoint:
    id: str
    position: tuple[float, float]


@dataclass(frozen=True)
class SketchEntity:
    id: str
    name: str
    kind: Literal["line", "circle", "arc"]
    point_ids: tuple[str, ...]
    radius: float | None = None
    clockwise: bool = False


@dataclass(frozen=True)
class SketchConstraint:
    id: str
    kind: str
    references: tuple[str, ...]
    value: float | None = None


@dataclass(frozen=True)
class SketchLoop:
    id: str
    role: Literal["outer", "hole"]
    entity_ids: tuple[str, ...]


@dataclass(frozen=True)
class SketchDefinition:
    points: tuple[SketchPoint, ...]
    entities: tuple[SketchEntity, ...]
    constraints: tuple[SketchConstraint, ...]
    loops: tuple[SketchLoop, ...]


@dataclass(frozen=True)
class SketchSolveResult:
    status: SketchStatus
    degrees_of_freedom: int | None
    failed_constraint_ids: tuple[str, ...]
    points: tuple[SketchPoint, ...]
    entities: tuple[SketchEntity, ...]
    kernel: str = "SolveSpace 3.2"
    source_commit: str = SOURCE_COMMIT


def _error(message: str) -> EngineError:
    return EngineError("invalid-sketch", message)


def _record(value: Any, fields: set[str], label: str) -> dict[str, Any]:
    if not isinstance(value, dict) or set(value) != fields:
        raise _error(f"{label} must contain exactly {', '.join(sorted(fields))}.")
    return value


def _identifier(value: Any) -> str:
    if not isinstance(value, str) or not 1 <= len(value) <= 64 or any(ord(c) < 32 for c in value):
        raise _error("Sketch identifiers must contain 1–64 printable characters.")
    return value


def _number(value: Any, positive: bool = False) -> float:
    if type(value) not in (int, float) or abs(value) > 1000 or not math.isfinite(value):
        raise _error("Sketch lengths and coordinates must be finite SI values within ±1000 m.")
    if positive and value <= 0:
        raise _error("Sketch radii, distances and diameters must be positive.")
    return float(value)


def _array(value: Any, maximum: int, label: str) -> list[Any]:
    if not isinstance(value, list) or len(value) > maximum:
        raise _error(f"{label} must be an array containing at most {maximum} entries.")
    return value


def _unique(records: tuple[Any, ...], label: str) -> dict[str, Any]:
    indexed = {item.id: item for item in records}
    if len(indexed) != len(records):
        raise _error(f"{label} identifiers must be unique.")
    return indexed


def decode_sketch(value: Any) -> SketchDefinition:
    """Decode a bounded graph before it can reach the native C API."""
    source = _record(value, {"points", "entities", "constraints", "loops"}, "Sketch")
    points = []
    for item in _array(source["points"], MAX_POINTS, "Sketch points"):
        item = _record(item, {"id", "position"}, "Sketch point")
        position = item["position"]
        if not isinstance(position, list) or len(position) != 2:
            raise _error("Sketch points need exactly two SI coordinates.")
        points.append(
            SketchPoint(_identifier(item["id"]), (_number(position[0]), _number(position[1])))
        )
    point_map = _unique(tuple(points), "Point")
    entities = []
    for item in _array(source["entities"], MAX_ENTITIES, "Sketch entities"):
        if not isinstance(item, dict):
            raise _error("Sketch entities must be objects.")
        kind = item.get("kind")
        if kind not in ("line", "circle", "arc"):
            raise _error("Sketch entities must be lines, circles or arcs.")
        kind = cast(Literal["line", "circle", "arc"], kind)
        point_fields = {
            "line": ("startId", "endId"),
            "circle": ("centerId",),
            "arc": ("centerId", "startId", "endId"),
        }.get(kind)
        if point_fields is None:
            raise _error("Sketch entities must be lines, circles or arcs.")
        fields = {"id", "name", "kind", *point_fields}
        fields |= {"radius"} if kind == "circle" else {"clockwise"} if kind == "arc" else set()
        item = _record(item, fields, "Sketch entity")
        references = tuple(_identifier(item[field]) for field in point_fields)
        if any(reference not in point_map for reference in references):
            raise _error("Every entity point must reference an existing sketch point.")
        if kind != "circle" and len(set(references)) != len(references):
            raise _error("Line and arc defining points must have distinct identifiers.")
        name = item["name"]
        if not isinstance(name, str) or not 1 <= len(name) <= 100:
            raise _error("Sketch entity names must contain 1–100 characters.")
        if kind == "arc" and type(item["clockwise"]) is not bool:
            raise _error("Arc direction must be a Boolean.")
        entities.append(
            SketchEntity(
                _identifier(item["id"]),
                name,
                kind,
                references,
                _number(item["radius"], True) if kind == "circle" else None,
                item.get("clockwise", False),
            )
        )
    entity_map = _unique(tuple(entities), "Entity")
    signatures = {
        "fixedPoint": ("pointId",),
        "coincident": ("firstPointId", "secondPointId"),
        "distance": ("firstPointId", "secondPointId"),
        "horizontal": ("lineId",),
        "vertical": ("lineId",),
        "diameter": ("curveId",),
        "equalLength": ("firstLineId", "secondLineId"),
        "parallel": ("firstLineId", "secondLineId"),
        "perpendicular": ("firstLineId", "secondLineId"),
        "equalRadius": ("firstCurveId", "secondCurveId"),
    }
    constraints = []
    for item in _array(source["constraints"], MAX_CONSTRAINTS, "Sketch constraints"):
        if not isinstance(item, dict) or item.get("kind") not in signatures:
            raise _error("Sketch constraint kind is not implemented.")
        kind = item["kind"]
        reference_fields = signatures[kind]
        fields = {"id", "kind", *reference_fields}
        dimensioned = kind in ("distance", "diameter")
        if dimensioned:
            fields.add("value")
        _record(item, fields, "Sketch constraint")
        references = tuple(_identifier(item[field]) for field in reference_fields)
        if len(set(references)) != len(references):
            raise _error("Constraint references must be distinct.")
        for field, reference in zip(reference_fields, references, strict=True):
            if "Point" in field or field == "pointId":
                if reference not in point_map:
                    raise _error("Constraint point does not exist.")
            else:
                entity = entity_map.get(reference)
                wanted = ("line",) if "Line" in field or field == "lineId" else ("circle", "arc")
                if entity is None or entity.kind not in wanted:
                    raise _error("Constraint entity is absent or has an incompatible type.")
        constraints.append(
            SketchConstraint(
                _identifier(item["id"]),
                kind,
                references,
                _number(item["value"], True) if dimensioned else None,
            )
        )
    _unique(tuple(constraints), "Constraint")
    loops = []
    used_entities: set[str] = set()
    for item in _array(source["loops"], MAX_LOOPS, "Sketch loops"):
        item = _record(item, {"id", "role", "entityIds"}, "Sketch loop")
        if item["role"] not in ("outer", "hole"):
            raise _error("Sketch loop role must be outer or hole.")
        references = tuple(
            _identifier(n) for n in _array(item["entityIds"], MAX_ENTITIES, "Loop entities")
        )
        if not references or len(set(references)) != len(references):
            raise _error("A sketch loop needs a nonempty list of distinct entities.")
        if any(n not in entity_map for n in references) or used_entities.intersection(references):
            raise _error("Loop entities must exist and belong to only one loop.")
        used_entities.update(references)
        loops.append(SketchLoop(_identifier(item["id"]), item["role"], references))
    _unique(tuple(loops), "Loop")
    return SketchDefinition(tuple(points), tuple(entities), tuple(constraints), tuple(loops))


_U = ct.c_uint32
_I = ct.c_int


class _Param(ct.Structure):
    _fields_ = [("h", _U), ("group", _U), ("val", ct.c_double)]


class _Entity(ct.Structure):
    _fields_ = [
        ("h", _U),
        ("group", _U),
        ("type", _I),
        ("wrkpl", _U),
        ("point", _U * 4),
        ("normal", _U),
        ("distance", _U),
        ("param", _U * 4),
    ]


class _Constraint(ct.Structure):
    _fields_ = [
        ("h", _U),
        ("group", _U),
        ("type", _I),
        ("wrkpl", _U),
        ("valA", ct.c_double),
        ("ptA", _U),
        ("ptB", _U),
        ("entityA", _U),
        ("entityB", _U),
        ("entityC", _U),
        ("entityD", _U),
        ("other", _I),
        ("other2", _I),
    ]


class _System(ct.Structure):
    _fields_ = [
        ("param", ct.POINTER(_Param)),
        ("params", _I),
        ("entity", ct.POINTER(_Entity)),
        ("entities", _I),
        ("constraint", ct.POINTER(_Constraint)),
        ("constraints", _I),
        ("dragged", ct.POINTER(_U)),
        ("ndragged", _I),
        ("calculateFaileds", _I),
        ("failed", ct.POINTER(_U)),
        ("faileds", _I),
        ("dof", _I),
        ("result", _I),
    ]


def managed_library_path() -> Path:
    """Application-selected locations only; a request cannot choose a library."""
    filename = {"darwin": "libslvs.3.2.dylib", "win32": "slvs.dll", "linux": "libslvs.so.3.2"}.get(
        sys.platform
    )
    if filename is None:
        raise EngineError(
            "sketch-solver-unavailable", "Sketch solving is unavailable on this platform."
        )
    if getattr(sys, "frozen", False):
        bundle_root = getattr(sys, "_MEIPASS", None)
        if not isinstance(bundle_root, str):
            raise EngineError("sketch-solver-unavailable", "The packaged engine root is missing.")
        return Path(bundle_root) / "sketch_solver" / filename
    architecture = {"aarch64": "arm64", "AMD64": "x64", "x86_64": "x64"}.get(
        platform.machine(), platform.machine()
    )
    return (
        Path(__file__).resolve().parents[3]
        / "artifacts"
        / "sketch-solver"
        / f"{sys.platform}-{architecture}"
        / filename
    )


def _load_library() -> ct.CDLL:
    if ct.sizeof(ct.c_void_p) != 8 or tuple(
        ct.sizeof(n) for n in (_Param, _Entity, _Constraint, _System)
    ) != (16, 56, 56, 88):
        raise EngineError(
            "sketch-solver-unavailable", "Sketch solver requires its supported 64-bit C ABI."
        )
    selected = managed_library_path()
    if not selected.is_file():
        raise EngineError(
            "sketch-solver-unavailable",
            "The managed sketch solver is missing. Run npm run setup again.",
        )
    try:
        library = ct.CDLL(str(selected))
        library.Slvs_Solve.argtypes = [ct.POINTER(_System), _U]
        library.Slvs_Solve.restype = None
        return library
    except (OSError, AttributeError) as error:
        raise EngineError(
            "sketch-solver-unavailable", "The bundled sketch solver could not be loaded."
        ) from error


def solve_sketch(value: Any) -> SketchSolveResult:
    """Solve one immutable snapshot on the isolated CAD worker's main thread."""
    if threading.current_thread() is not threading.main_thread():
        raise EngineError(
            "invalid-execution", "Sketch solves must run serially in the owned CAD worker."
        )
    sketch = decode_sketch(value)
    library = _load_library()
    parameters = [_Param(i + 1, 1, v) for i, v in enumerate((0, 0, 0, 1, 0, 0, 0))]

    def entity(
        h: int,
        kind: int,
        points: tuple[int, ...] = (),
        normal: int = 0,
        distance: int = 0,
        params: tuple[int, ...] = (),
        group: int = 2,
        plane: int = 3,
    ) -> _Entity:
        return _Entity(
            h, group, kind, plane, (_U * 4)(*points), normal, distance, (_U * 4)(*params)
        )

    entities = [
        entity(1, 50000, params=(1, 2, 3), group=1, plane=0),
        entity(2, 60000, params=(4, 5, 6, 7), group=1, plane=0),
        entity(3, 80000, points=(1,), normal=2, group=1, plane=0),
    ]
    point_handles = {}
    point_parameters = {}
    for point in sketch.points:
        h, p = len(entities) + 1, len(parameters) + 1
        parameters.extend((_Param(p, 2, point.position[0]), _Param(p + 1, 2, point.position[1])))
        entities.append(entity(h, 50001, params=(p, p + 1)))
        point_handles[point.id], point_parameters[point.id] = h, (p, p + 1)
    entity_handles = {}
    radius_parameters = {}
    for item in sketch.entities:
        h = len(entities) + 1
        handles = tuple(point_handles[n] for n in item.point_ids)
        if item.kind == "line":
            entities.append(entity(h, 80001, points=handles))
        elif item.kind == "arc":
            if item.clockwise:
                handles = (handles[0], handles[2], handles[1])
            entities.append(entity(h, 80004, points=handles, normal=2))
        else:
            p = len(parameters) + 1
            parameters.append(_Param(p, 2, item.radius))
            distance = h
            entities.append(entity(distance, 70000, params=(p,)))
            h += 1
            entities.append(entity(h, 80003, points=handles, normal=2, distance=distance))
            radius_parameters[item.id] = p
        entity_handles[item.id] = h
    native_constraints = []
    kinds = {
        "fixedPoint": 100031,
        "coincident": 100000,
        "distance": 100001,
        "horizontal": 100019,
        "vertical": 100020,
        "diameter": 100021,
        "equalLength": 100008,
        "parallel": 100025,
        "perpendicular": 100026,
        "equalRadius": 100029,
    }
    for index, condition in enumerate(sketch.constraints, 1):
        point_based = condition.kind in ("fixedPoint", "coincident", "distance")
        condition_handles = [
            point_handles[n] if point_based else entity_handles[n] for n in condition.references
        ]
        condition_handles += [0] * (2 - len(condition_handles))
        pa, pb = condition_handles if point_based else (0, 0)
        ea, eb = (0, 0) if point_based else condition_handles
        native_constraints.append(
            _Constraint(
                index,
                2,
                kinds[condition.kind],
                3,
                condition.value or 0.0,
                pa,
                pb,
                ea,
                eb,
                0,
                0,
                0,
                0,
            )
        )
    params = (_Param * len(parameters))(*parameters)
    ents = (_Entity * len(entities))(*entities)
    cons = (_Constraint * len(native_constraints))(*native_constraints)
    failed = (_U * max(1, len(cons)))()
    system = _System(
        params,
        len(params),
        ents,
        len(ents),
        cons,
        len(cons),
        None,
        0,
        1,
        failed,
        len(failed),
        -1,
        -1,
    )
    library.Slvs_Solve(ct.byref(system), 2)
    statuses: dict[int, SketchStatus] = {
        0: "solved",
        1: "conflicting",
        2: "nonConverged",
        3: "tooManyUnknowns",
        4: "redundant",
    }
    if system.result not in statuses or not 0 <= system.faileds <= len(cons):
        raise EngineError(
            "invalid-sketch-result", "Sketch solver returned an invalid diagnostic result."
        )
    failed_ids = []
    for handle in list(failed)[: system.faileds]:
        if not 1 <= handle <= len(sketch.constraints):
            raise EngineError(
                "invalid-sketch-result", "Sketch solver returned an unknown constraint identifier."
            )
        failed_ids.append(sketch.constraints[handle - 1].id)
    solved = system.result in (0, 4)
    if solved and not 0 <= system.dof <= len(parameters) - 7:
        raise EngineError(
            "invalid-sketch-result", "Sketch solver returned an invalid degrees-of-freedom count."
        )
    points, output_entities = sketch.points, sketch.entities
    if solved:
        values = {int(p.h): _number(p.val) for p in params}
        points = tuple(
            replace(
                point,
                position=(
                    values[point_parameters[point.id][0]],
                    values[point_parameters[point.id][1]],
                ),
            )
            for point in points
        )
        output_entities = tuple(
            replace(item, radius=_number(values[radius_parameters[item.id]], True))
            if item.kind == "circle"
            else item
            for item in output_entities
        )
    return SketchSolveResult(
        statuses[system.result],
        system.dof if solved else None,
        tuple(failed_ids),
        points,
        output_entities,
    )


def build_profile(value: Any) -> tuple[dict[str, Any], dict[str, Any]]:
    """Derive a currently supported exact profile; never persist a second source."""
    sketch = decode_sketch(value)
    result = solve_sketch(value)
    metadata: dict[str, Any] = {
        "kernel": result.kernel,
        "sourceCommit": result.source_commit,
        "status": result.status,
        "degreesOfFreedom": result.degrees_of_freedom,
        "failedConstraintIds": list(result.failed_constraint_ids),
    }
    if result.status not in ("solved", "redundant"):
        raise EngineError(
            "sketch-constraints-failed",
            f"Sketch constraints {result.status}: {', '.join(result.failed_constraint_ids)}.",
        )
    outers = [loop for loop in sketch.loops if loop.role == "outer"]
    if len(outers) != 1:
        raise EngineError(
            "unsupported-sketch-profile",
            "Select exactly one closed outer loop for this profile feature.",
        )
    points = {point.id: point.position for point in result.points}
    entities = {item.id: item for item in result.entities}
    profile: dict[str, Any] = {"outer": [], "holes": []}
    boundary_entities: dict[str, str] = {}

    def boundary_id(item: SketchEntity, suffix: str = "") -> str:
        identifier = "cad-" + hashlib.sha256(item.id.encode("utf-8")).hexdigest()[:32] + suffix
        boundary_entities[identifier] = item.id
        return identifier

    for loop in sketch.loops:
        items = [entities[n] for n in loop.entity_ids]
        if loop.role == "hole":
            if len(items) != 1 or items[0].kind != "circle":
                raise EngineError(
                    "unsupported-sketch-profile",
                    "This profile feature supports circular hole loops.",
                )
            circle = items[0]
            profile["holes"].append(
                {
                    "id": boundary_id(circle),
                    "name": circle.name,
                    "center": list(points[circle.point_ids[0]]),
                    "radius": circle.radius,
                }
            )
            continue
        if len(items) == 1 and items[0].kind == "circle":
            circle = items[0]
            cx, cy = points[circle.point_ids[0]]
            radius = circle.radius
            assert radius is not None
            a, b = [cx + radius, cy], [cx - radius, cy]
            for suffix, circle_start, circle_end in (("a", a, b), ("b", b, a)):
                profile["outer"].append(
                    {
                        "id": boundary_id(circle, f"-{suffix}"),
                        "name": circle.name,
                        "kind": "arc",
                        "start": circle_start,
                        "end": circle_end,
                        "center": [cx, cy],
                        "clockwise": False,
                    }
                )
            continue
        if any(item.kind == "circle" for item in items):
            raise EngineError(
                "unsupported-sketch-profile", "A circle must form its own closed loop."
            )
        first = items[0].point_ids[-2]
        current = first
        for item in items:
            start, end = item.point_ids[-2:]
            reverse = False
            if start != current:
                if end != current:
                    raise EngineError(
                        "open-profile",
                        "Loop curves must share point identifiers in their specified order.",
                    )
                start, end, reverse = end, start, True
            segment: dict[str, Any] = {
                "id": boundary_id(item),
                "name": item.name,
                "kind": item.kind,
                "start": list(points[start]),
                "end": list(points[end]),
            }
            if item.kind == "arc":
                segment.update(
                    center=list(points[item.point_ids[0]]), clockwise=item.clockwise != reverse
                )
            profile["outer"].append(segment)
            current = end
        if current != first:
            raise EngineError(
                "open-profile", "The outer loop is not closed by shared point identifiers."
            )
    validate_profile(profile)
    metadata["boundaryEntities"] = boundary_entities
    return profile, metadata
