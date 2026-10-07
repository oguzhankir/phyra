"""Exact section lofts and authored-profile sweeps with explicit miter corners.

OCCT's default pipe transition may create self-intersecting transformed shells.
RightCorner intersects adjacent pieces rather than silently rounding the path.
https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___make_pipe_shell.html
https://occt3d.com/dev/doc/refman/html/class_b_rep_offset_a_p_i___thru_sections.html
"""

import math
from typing import Any

from OCP.BRep import BRep_Tool  # type: ignore[import-untyped]
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface  # type: ignore[import-untyped]
from OCP.BRepAlgoAPI import BRepAlgoAPI_Check  # type: ignore[import-untyped]
from OCP.BRepBuilderAPI import (  # type: ignore[import-untyped]
    BRepBuilderAPI_Copy,
    BRepBuilderAPI_RightCorner,
)
from OCP.BRepCheck import BRepCheck_Analyzer  # type: ignore[import-untyped]
from OCP.BRepExtrema import BRepExtrema_DistShapeShape  # type: ignore[import-untyped]
from OCP.BRepOffsetAPI import (  # type: ignore[import-untyped]
    BRepOffsetAPI_MakePipeShell,
    BRepOffsetAPI_ThruSections,
)
from OCP.BRepTools import BRepTools, BRepTools_WireExplorer  # type: ignore[import-untyped]
from OCP.GeomAbs import GeomAbs_Plane  # type: ignore[import-untyped]
from OCP.gp import gp_Pnt, gp_Vec  # type: ignore[import-untyped]
from OCP.TopAbs import (  # type: ignore[import-untyped]
    TopAbs_FACE,
    TopAbs_REVERSED,
    TopAbs_SOLID,
    TopAbs_WIRE,
)
from OCP.TopoDS import TopoDS  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.sketch import MODELING_TOLERANCE_SI
from phyra_engine.geometry.cad.topology import KERNEL_PER_METRE, properties, subshapes

KERNEL_TOLERANCE = MODELING_TOLERANCE_SI * KERNEL_PER_METRE


def section_wire(face: Any) -> Any:
    if face.ShapeType() != TopAbs_FACE or len(subshapes(face, TopAbs_WIRE)) != 1:
        raise EngineError(
            "unsupported-cad-section",
            "Loft and sweep profiles require one closed sketch without holes.",
        )
    wire = BRepTools.OuterWire_s(TopoDS.Face(face))
    if wire.IsNull() or not wire.Closed():
        raise EngineError("invalid-cad-section", "A section must have a closed outer wire.")
    return wire


def validate_result(shape: Any, solid: bool) -> None:
    """Ordinary BRep validity alone does not exclude self-intersecting generated surfaces."""
    if (
        shape.IsNull()
        or not BRepCheck_Analyzer(shape, True, False, True).IsValid()
        or not BRepAlgoAPI_Check(shape, False, True).IsValid()
    ):
        raise EngineError(
            "invalid-cad-operation", "The generated CAD geometry is invalid or self-intersecting."
        )
    bodies = subshapes(shape, TopAbs_SOLID)
    if not subshapes(shape, TopAbs_FACE) or (len(bodies) != 1 if solid else bool(bodies)):
        raise EngineError(
            "invalid-cad-operation", "The operation did not produce its requested solid or shell."
        )
    measure, _ = properties(shape, "body" if solid else "face")
    if not math.isfinite(measure) or measure <= MODELING_TOLERANCE_SI ** (3 if solid else 2):
        raise EngineError(
            "invalid-cad-operation", "The operation produced no finite positive volume or area."
        )


def loft(sections: tuple[Any, ...], solid: bool, ruled: bool) -> Any:
    if not 2 <= len(sections) <= 16:
        raise EngineError("invalid-loft", "A loft requires 2–16 distinct closed sections.")
    wires = tuple(section_wire(section) for section in sections)
    for index, section in enumerate(sections):
        for previous in sections[:index]:
            distance = BRepExtrema_DistShapeShape(previous, section)
            if not distance.IsDone() or distance.Value() <= KERNEL_TOLERANCE:
                raise EngineError(
                    "invalid-loft", "Loft sections must not coincide, touch or intersect."
                )
    operation = BRepOffsetAPI_ThruSections(solid, ruled, KERNEL_TOLERANCE)
    # CheckCompatibility may align/split derived sections. It must never mutate
    # the exact source profiles; the OCCT default is mutable input.
    operation.SetMutableInput(False)
    operation.CheckCompatibility(True)
    for wire in wires:
        operation.AddWire(wire)
    operation.Build()
    if not operation.IsDone():
        raise EngineError("loft-failed", f"The loft could not be built ({operation.GetStatus()}).")
    result = operation.Shape()
    validate_result(result, solid)
    return result


def sweep(profile: Any, spine: Any, solid: bool) -> Any:
    profile_wire = section_wire(profile)
    if spine.ShapeType() != TopAbs_WIRE or spine.Closed():
        raise EngineError("invalid-sweep-spine", "A sweep needs one connected open wire.")
    explorer = BRepTools_WireExplorer(TopoDS.Wire(spine))
    if not explorer.More():
        raise EngineError("invalid-sweep-spine", "A sweep path contains no edge.")
    first_edge = TopoDS.Edge(explorer.Current())
    start_vertex = explorer.CurrentVertex()
    curve = BRepAdaptor_Curve(first_edge)
    reversed_edge = first_edge.Orientation() == TopAbs_REVERSED
    parameter = curve.LastParameter() if reversed_edge else curve.FirstParameter()
    point, tangent = gp_Pnt(), gp_Vec()
    curve.D1(parameter, point, tangent)
    if tangent.Magnitude() <= KERNEL_TOLERANCE:
        raise EngineError("invalid-sweep-spine", "The initial sweep tangent is undefined.")
    surface = BRepAdaptor_Surface(TopoDS.Face(profile), True)
    if surface.GetType() != GeomAbs_Plane:
        raise EngineError(
            "unsupported-cad-section", "A sweep profile must be an exact planar sketch."
        )
    plane = surface.Plane()
    normal = gp_Vec(plane.Axis().Direction())
    if (
        plane.Distance(BRep_Tool.Pnt_s(start_vertex)) > KERNEL_TOLERANCE
        or abs(normal.Dot(tangent.Normalized())) < 1 - 1e-9
    ):
        raise EngineError(
            "sweep-profile-placement",
            "Place the profile plane at the path start, perpendicular to its first tangent; "
            "use its sketch plane or a move/rotate feature.",
        )
    # Isolate operation-owned topology as well as authoring coordinates.
    copied_spine = TopoDS.Wire(BRepBuilderAPI_Copy(spine, True, False).Shape())
    copied_profile = BRepBuilderAPI_Copy(profile_wire, True, False).Shape()
    copied_explorer = BRepTools_WireExplorer(copied_spine)
    operation = BRepOffsetAPI_MakePipeShell(copied_spine)
    operation.SetMode(False)  # Corrected Frenet, with the authored starting orientation.
    operation.SetTransitionMode(BRepBuilderAPI_RightCorner)
    operation.SetTolerance(KERNEL_TOLERANCE, KERNEL_TOLERANCE, 1e-9)
    operation.Add(copied_profile, copied_explorer.CurrentVertex(), False, False)
    operation.Build()
    if not operation.IsDone() or solid and not operation.MakeSolid():
        raise EngineError(
            "sweep-failed", f"The sweep could not be built ({operation.GetStatus()})."
        )
    result = operation.Shape()
    validate_result(result, solid)
    return result
