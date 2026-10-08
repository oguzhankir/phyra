"""Physical admissibility and resource gates after canonical schema validation.

These rules describe the supported engineering problem, independently of the
algorithm selected to solve it. They do not decode JSON or migrate archives.
"""

import math
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_CELLS, MAX_NODES, MAX_TRIANGLES
from phyra_engine.geometry.regions import SOLID_REGIONS


def validate_physical_project(project: dict[str, Any], version: int) -> None:
    geometry = project["geometry"]
    if geometry["kind"] == "bracket" and geometry["thickness"] >= min(
        geometry["length"], geometry["width"]
    ):
        raise EngineError("invalid-geometry", "Bracket thickness must be below length and width.")
    study = project["study"]
    plane = study.get("dimension") == "2d"
    energy = study.get("solver", {}).get("pinn", {}).get("formulation") == "potential-energy"
    if version >= 2:
        if plane and (
            geometry["kind"] not in (("box", "profile") if version >= 4 else ("box",))
            or study["formulation"] != "plane-stress"
        ):
            raise EngineError(
                "unsupported-study", "2D supports rectangular or exact-profile plane stress."
            )
        if not plane and (study["formulation"] != "solid" or study["solver"]["kind"] != "fem"):
            raise EngineError(
                "unsupported-study", "3D currently supports solid elasticity with FEM."
            )
    ids = [item["id"] for item in study["constraints"] + study["loads"]]
    if len(ids) != len(set(ids)):
        raise EngineError("invalid-assignment", "Support and load identifiers must be unique.")
    profile = geometry.get("profile") if geometry["kind"] == "profile" else None
    cad_domain = study.get("domain")
    if profile is not None:
        from phyra_engine.geometry.profile import validate_profile

        validate_profile(profile)
        if not plane or study["solver"]["kind"] != "fem" and not energy:
            raise EngineError(
                "unsupported-study",
                "Exact profiles support 2D FEM or potential-energy PINN plane stress.",
            )
    allowed = (
        set(item["id"] for item in cad_domain["boundaries"])
        if cad_domain
        else set(item["id"] for item in profile["outer"] + profile["holes"])
        if profile
        else set(("x0", "x1", "y0", "y1") if plane else SOLID_REGIONS[geometry["kind"]])
    )
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
        from phyra_engine.physics.elasticity.plane_stress import validate_traction

        for load in study["loads"]:
            if load["kind"] == "traction":
                validate_traction(load.get("traction"))
                if study["solver"]["kind"] != "fem" and not energy:
                    raise EngineError(
                        "unsupported-study", "Spatial stress tractions support FEM only."
                    )
        if any(load["vector"][2] != 0 for load in study["loads"]):
            raise EngineError("invalid-assignment", "Plane stress supports in-plane loads only.")
        if profile:
            from phyra_engine.meshing.profile import validate_mesh_request

            validate_mesh_request(
                profile,
                study["mesh"]["size"],
                study["mesh"].get("boundarySize", study["mesh"]["size"]),
            )
            return
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
        return
    if any(load["kind"] not in ("force", "pressure") for load in study["loads"]):
        raise EngineError(
            "unsupported-study", "Solid studies support total force and pressure only."
        )
    if cad_domain:
        # Exact shape/mesh bounds and the complete face correspondence are
        # checked during preparation, not inferred from authoring parameters.
        if "boundarySize" in study["mesh"]:
            raise EngineError(
                "unsupported-study", "Exact solid meshing supports one global target size."
            )
        return
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
    return
