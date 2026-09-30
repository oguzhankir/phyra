"""OCC primitive creation and semantic surface classification."""

from typing import Any

import gmsh  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError


def create_solid(geometry: dict[str, Any]) -> int:
    length, width, height = (geometry[key] for key in ("length", "width", "height"))
    if geometry["kind"] == "box":
        return gmsh.model.occ.addBox(0, 0, 0, length, width, height)
    if geometry["kind"] == "cylinder":
        return gmsh.model.occ.addCylinder(0, 0, 0, length, 0, 0, geometry["radius"])
    thickness = geometry["thickness"]
    outline = [
        (0, 0),
        (length, 0),
        (length, thickness),
        (thickness, thickness),
        (thickness, width),
        (0, width),
    ]
    vertices = [gmsh.model.occ.addPoint(x, y, 0) for x, y in outline]
    lines = [gmsh.model.occ.addLine(vertices[i], vertices[(i + 1) % 6]) for i in range(6)]
    plane = gmsh.model.occ.addPlaneSurface([gmsh.model.occ.addCurveLoop(lines)])
    extruded = gmsh.model.occ.extrude([(2, plane)], 0, 0, height)
    return next(tag for dimension, tag in extruded if dimension == 3)


def classify_surface(surface_tag: int, geometry: dict[str, Any]) -> str:
    center = gmsh.model.occ.getCenterOfMass(2, surface_tag)
    if geometry["kind"] == "cylinder":
        if gmsh.model.getType(2, surface_tag) != "Plane":
            return "outer"
        return "x0" if center[0] < geometry["length"] / 2 else "x1"
    limits = [(0, "x0"), (geometry["length"], "x1")]
    for value, name in limits:
        if abs(center[0] - value) < geometry["length"] * 1e-7:
            return name
    for axis, dimension in ((1, "width"), (2, "height")):
        if abs(center[axis]) < geometry[dimension] * 1e-7:
            return f"{'yz'[axis - 1]}0"
        if abs(center[axis] - geometry[dimension]) < geometry[dimension] * 1e-7:
            return f"{'yz'[axis - 1]}1"
    if geometry["kind"] == "bracket":
        if abs(center[0] - geometry["thickness"]) < geometry["length"] * 1e-7:
            return "inner-x"
        if abs(center[1] - geometry["thickness"]) < geometry["width"] * 1e-7:
            return "inner-y"
    raise EngineError("invalid-region", "Could not identify a solid boundary reliably.")
