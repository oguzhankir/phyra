"""Exact planar CAD faces derived from the single authored constraint graph.

CAD wires are independent of the smaller numerical Profile contract. OCCT's
exact face checks enforce closed, nonintersecting and correctly nested wires:
https://occt3d.com/dev/doc/refman/html/class_b_rep_check___analyzer.html
"""

import math
from dataclasses import dataclass
from typing import Any

from OCP.BRepBuilderAPI import (  # type: ignore[import-untyped]
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
)
from OCP.BRepCheck import BRepCheck_Analyzer  # type: ignore[import-untyped]
from OCP.GC import GC_MakeArcOfCircle  # type: ignore[import-untyped]
from OCP.gp import gp_Ax2, gp_Circ, gp_Dir, gp_Pnt  # type: ignore[import-untyped]
from OCP.TopoDS import TopoDS  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.topology import KERNEL_PER_METRE
from phyra_engine.geometry.sketch_constraints import (
    SketchEntity,
    SketchLoop,
    decode_sketch,
    solve_sketch,
)

MODELING_TOLERANCE_SI = 1e-10  # OCCT Precision::Confusion = 1e-7 working millimetres.


@dataclass(frozen=True)
class _LoopWire:
    shape: Any
    signed_area: float


def _point(position: tuple[float, float] | list[float], plane: str) -> Any:
    u, v = position
    xyz = {"xy": (u, v, 0), "xz": (u, 0, v), "yz": (0, u, v)}[plane]
    return gp_Pnt(*(value * KERNEL_PER_METRE for value in xyz))


def _wire(
    loop: SketchLoop,
    points: dict[str, tuple[float, float]],
    entities: dict[str, SketchEntity],
    plane: str,
) -> _LoopWire:
    items = [entities[identifier] for identifier in loop.entity_ids]
    maker = BRepBuilderAPI_MakeWire()
    if len(items) == 1 and items[0].kind == "circle":
        circle = items[0]
        center, radius = points[circle.point_ids[0]], circle.radius
        assert radius is not None
        if radius <= MODELING_TOLERANCE_SI:
            raise EngineError("invalid-cad-sketch", "A circle is below the CAD modeling tolerance.")
        if loop.role == "outer":
            # Exact semicircles retain the existing two-region numerical disk
            # bindings. This does not approximate the authored full circle.
            cx, cy = center
            for sign in (1, -1):
                first, middle, last = (
                    [cx + sign * radius, cy],
                    [cx, cy + sign * radius],
                    [cx - sign * radius, cy],
                )
                maker.Add(
                    BRepBuilderAPI_MakeEdge(
                        GC_MakeArcOfCircle(
                            _point(first, plane), _point(middle, plane), _point(last, plane)
                        ).Value()
                    ).Edge()
                )
        else:
            normal = {"xy": (0, 0, 1), "xz": (0, -1, 0), "yz": (1, 0, 0)}[plane]
            maker.Add(
                BRepBuilderAPI_MakeEdge(
                    gp_Circ(
                        gp_Ax2(_point(center, plane), gp_Dir(*normal)),
                        radius * KERNEL_PER_METRE,
                    )
                ).Edge()
            )
        area = math.pi * radius**2
    else:
        if any(item.kind == "circle" for item in items):
            raise EngineError("invalid-cad-sketch", "A circle must form its own closed loop.")
        first_id = items[0].point_ids[-2]
        current_id = first_id
        origin = points[first_id]
        area = 0.0
        for item in items:
            start_id, end_id = item.point_ids[-2:]
            reverse = start_id != current_id
            if reverse:
                start_id, end_id = end_id, start_id
            if start_id != current_id:
                raise EngineError(
                    "open-cad-sketch", "Loop curves must share point identities in their order."
                )
            start, end = points[start_id], points[end_id]
            if math.dist(start, end) <= MODELING_TOLERANCE_SI:
                raise EngineError(
                    "invalid-cad-sketch", "A loop curve is below the CAD modeling tolerance."
                )
            if item.kind == "line":
                edge = BRepBuilderAPI_MakeEdge(_point(start, plane), _point(end, plane)).Edge()
                area += (
                    (start[0] - origin[0]) * (end[1] - origin[1])
                    - (end[0] - origin[0]) * (start[1] - origin[1])
                ) / 2
            else:
                center = points[item.point_ids[0]]
                radius = math.dist(start, center)
                if radius <= MODELING_TOLERANCE_SI or not math.isclose(
                    radius,
                    math.dist(end, center),
                    rel_tol=1e-9,
                    abs_tol=MODELING_TOLERANCE_SI,
                ):
                    raise EngineError("invalid-cad-sketch", "Arc endpoints need the same radius.")
                angle = math.atan2(start[1] - center[1], start[0] - center[0])
                final = math.atan2(end[1] - center[1], end[0] - center[0])
                clockwise = item.clockwise != reverse
                sweep = -((angle - final) % math.tau) if clockwise else (final - angle) % math.tau
                midpoint = [
                    center[0] + radius * math.cos(angle + sweep / 2),
                    center[1] + radius * math.sin(angle + sweep / 2),
                ]
                edge = BRepBuilderAPI_MakeEdge(
                    GC_MakeArcOfCircle(
                        _point(start, plane), _point(midpoint, plane), _point(end, plane)
                    ).Value()
                ).Edge()
                # Exact Green integral; area is used only to orient derived
                # wires, never as a sampled approximation or solver domain.
                area += (
                    (center[0] - origin[0]) * radius * (math.sin(angle + sweep) - math.sin(angle))
                    - (center[1] - origin[1]) * radius * (math.cos(angle + sweep) - math.cos(angle))
                    + radius**2 * sweep
                ) / 2
            maker.Add(edge)
            current_id = end_id
        if current_id != first_id:
            raise EngineError("open-cad-sketch", "A face requires a topologically closed loop.")
    if not maker.IsDone() or abs(area) <= MODELING_TOLERANCE_SI**2:
        raise EngineError("invalid-cad-sketch", "The loop has no valid enclosed CAD area.")
    return _LoopWire(maker.Wire(), area)


def sketch_face(value: Any, plane: str) -> tuple[Any, dict[str, Any]]:
    """Create an exact face from one closed outer and nonintersecting hole loops."""
    sketch = decode_sketch(value)
    result = solve_sketch(value)
    if result.status not in ("solved", "redundant"):
        raise EngineError(
            "sketch-constraints-failed",
            f"Sketch constraints {result.status}: {', '.join(result.failed_constraint_ids)}.",
        )
    outers = [loop for loop in sketch.loops if loop.role == "outer"]
    if len(outers) != 1:
        raise EngineError("open-cad-sketch", "A face requires exactly one closed outer loop.")
    points = {point.id: point.position for point in result.points}
    entities = {item.id: item for item in result.entities}
    outer = _wire(outers[0], points, entities, plane)
    wire = outer.shape if outer.signed_area > 0 else TopoDS.Wire(outer.shape.Reversed())
    builder = BRepBuilderAPI_MakeFace(wire, True)
    for loop in sketch.loops:
        if loop.role == "hole":
            hole = _wire(loop, points, entities, plane)
            builder.Add(hole.shape if hole.signed_area < 0 else TopoDS.Wire(hole.shape.Reversed()))
    if not builder.IsDone() or not BRepCheck_Analyzer(builder.Face(), True, False, True).IsValid():
        raise EngineError(
            "invalid-cad-sketch",
            "Sketch loops must be closed, nonintersecting and inside the outer boundary.",
        )
    return builder.Face(), {
        "kernel": result.kernel,
        "sourceCommit": result.source_commit,
        "status": result.status,
        "degreesOfFreedom": result.degrees_of_freedom,
        "failedConstraintIds": list(result.failed_constraint_ids),
    }
