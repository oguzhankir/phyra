"""Bounded exact BRep recipe execution using OCCT 8.0.1, without filesystem access.

SI recipe values are converted explicitly to millimetres at the kernel boundary
because OCCT's absolute modeling tolerance is defined in its working units.
STEP translation reads declared file units; user scaleFactor is dimensionless.
https://occt3d.com/dev/doc/refman/html/class_s_t_e_p_control___reader.html
"""

import io
import math
from dataclasses import dataclass
from typing import Any

from OCP.BRep import BRep_Builder  # type: ignore[import-untyped]
from OCP.BRepAlgoAPI import (  # type: ignore[import-untyped]
    BRepAlgoAPI_Common,
    BRepAlgoAPI_Cut,
    BRepAlgoAPI_Fuse,
)
from OCP.BRepBuilderAPI import (  # type: ignore[import-untyped]
    BRepBuilderAPI_Copy,
    BRepBuilderAPI_MakeEdge,
    BRepBuilderAPI_MakeFace,
    BRepBuilderAPI_MakeWire,
    BRepBuilderAPI_Transform,
)
from OCP.BRepCheck import BRepCheck_Analyzer  # type: ignore[import-untyped]
from OCP.BRepFilletAPI import (  # type: ignore[import-untyped]
    BRepFilletAPI_MakeChamfer,
    BRepFilletAPI_MakeFillet,
)
from OCP.BRepPrimAPI import (  # type: ignore[import-untyped]
    BRepPrimAPI_MakeBox,
    BRepPrimAPI_MakeCylinder,
    BRepPrimAPI_MakePrism,
    BRepPrimAPI_MakeRevol,
)
from OCP.BRepTools import BRepTools  # type: ignore[import-untyped]
from OCP.collections import (  # type: ignore[import-untyped]
    List_TopoDS_Shape,
    Sequence_TCollection_AsciiString,
)
from OCP.GC import GC_MakeArcOfCircle  # type: ignore[import-untyped]
from OCP.gp import (  # type: ignore[import-untyped]
    gp_Ax1,
    gp_Ax2,
    gp_Circ,
    gp_Dir,
    gp_Pnt,
    gp_Trsf,
    gp_Vec,
)
from OCP.IFSelect import IFSelect_RetDone  # type: ignore[import-untyped]
from OCP.Interface import Interface_Static  # type: ignore[import-untyped]
from OCP.Precision import Precision  # type: ignore[import-untyped]
from OCP.Standard import Standard_DomainError, Standard_Failure  # type: ignore[import-untyped]
from OCP.STEPControl import (  # type: ignore[import-untyped]
    STEPControl_AsIs,
    STEPControl_Reader,
    STEPControl_Writer,
)
from OCP.TopAbs import (  # type: ignore[import-untyped]
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_SOLID,
    TopAbs_VERTEX,
)
from OCP.TopoDS import TopoDS_Compound, TopoDS_Shape  # type: ignore[import-untyped]
from OCP.TopTools import TopTools_FormatVersion_VERSION_3  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.loft_sweep import loft, sweep, validate_result
from phyra_engine.geometry.cad.recipe import output_features, spine_features
from phyra_engine.geometry.cad.sketch import sketch_face, sketch_spine
from phyra_engine.geometry.cad.topology import (
    KERNEL_PER_METRE,
    MAX_ENTITIES,
    BodyInstance,
    entities,
    selected_edges,
    subshapes,
)
from phyra_engine.geometry.profile import arc_data, validate_profile


@dataclass(frozen=True)
class CadBuild:
    shape: Any
    output_feature_id: str
    feature_metadata: tuple[dict[str, Any], ...]
    body_instances: tuple[BodyInstance, ...] = ()


def valid_shape(shape: Any, require_faces: bool = True) -> None:
    if shape.IsNull() or not BRepCheck_Analyzer(shape).IsValid():
        raise EngineError("invalid-cad", "The CAD operation produced an invalid shape.")
    if require_faces and not subshapes(shape, TopAbs_FACE):
        raise EngineError("empty-cad", "The CAD operation produced no surface or solid.")


def _point(coordinates: list[float], plane: str = "xy") -> Any:
    u, v = coordinates[:2]
    xyz = {"xy": (u, v, 0), "xz": (u, 0, v), "yz": (0, u, v)}[plane]
    return gp_Pnt(*(value * KERNEL_PER_METRE for value in xyz))


def profile_face(profile: dict[str, Any], plane: str) -> Any:
    validate_profile(profile)
    wire = BRepBuilderAPI_MakeWire()
    for segment in profile["outer"]:
        first, last = _point(segment["start"], plane), _point(segment["end"], plane)
        if segment["kind"] == "line":
            edge = BRepBuilderAPI_MakeEdge(first, last).Edge()
        else:
            center, radius, start, sweep = arc_data(segment)
            midpoint = [
                float(center[0] + radius * math.cos(start + sweep / 2)),
                float(center[1] + radius * math.sin(start + sweep / 2)),
            ]
            edge = BRepBuilderAPI_MakeEdge(
                GC_MakeArcOfCircle(first, _point(midpoint, plane), last).Value()
            ).Edge()
        wire.Add(edge)
    if not wire.IsDone():
        raise EngineError("invalid-cad-sketch", "Sketch curves could not form a closed wire.")
    builder = BRepBuilderAPI_MakeFace(wire.Wire(), True)
    normal = {"xy": (0, 0, 1), "xz": (0, -1, 0), "yz": (1, 0, 0)}[plane]
    for hole in profile["holes"]:
        circle = gp_Circ(
            gp_Ax2(_point(hole["center"], plane), gp_Dir(*normal)),
            hole["radius"] * KERNEL_PER_METRE,
        )
        hole_wire = BRepBuilderAPI_MakeWire(BRepBuilderAPI_MakeEdge(circle).Edge()).Wire()
        hole_wire.Reverse()
        builder.Add(hole_wire)
    builder.Build()
    if not builder.IsDone():
        raise EngineError("invalid-cad-sketch", "Sketch loops could not form an exact face.")
    shape = builder.Face()
    valid_shape(shape)
    return shape


def import_step(source: bytes, scale_factor: float = 1) -> tuple[Any, list[str]]:
    if not source or len(source) > 64 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "A STEP source must contain at most 64 MiB.")
    reader = STEPControl_Reader()
    if reader.ReadStream("source.step", io.BytesIO(source)) != IFSelect_RetDone:
        raise EngineError("invalid-step", "The STEP source could not be decoded.")
    lengths, angles, solids = (Sequence_TCollection_AsciiString() for _ in range(3))
    reader.FileUnits(lengths, angles, solids)
    units = [lengths.Value(i).ToCString() for i in range(1, lengths.Size() + 1)]
    if not units:
        raise EngineError("invalid-step-units", "The STEP source does not declare length units.")
    reader.SetSystemLengthUnit(1.0)  # OCCT local coordinates are millimetres.
    if reader.TransferRoots() < 1:
        raise EngineError("invalid-step", "The STEP source has no transferable geometry.")
    shape = reader.OneShape()
    if scale_factor != 1:
        transform = gp_Trsf()
        transform.SetScale(gp_Pnt(), scale_factor)
        shape = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    valid_shape(shape)
    return shape, units


def export_step(shape: Any, unit: str = "m") -> bytes:
    valid_shape(shape)
    if unit not in ("m", "mm"):
        raise EngineError("invalid-cad-units", "STEP export supports metres or millimetres.")
    writer = STEPControl_Writer()  # Initializes the static STEP parameter dictionary.
    previous = Interface_Static.CVal_s("write.step.unit")
    try:
        if not Interface_Static.SetCVal_s("write.step.unit", "M" if unit == "m" else "MM"):
            raise EngineError("cad-export-failed", "STEP unit configuration failed.")
        writer.Model().SetLocalLengthUnit(1.0)
        writer.Model().SetWriteLengthUnit(1000.0 if unit == "m" else 1.0)
        if writer.Transfer(shape, STEPControl_AsIs) != IFSelect_RetDone:
            raise EngineError(
                "cad-export-failed", "The exact shape could not be transferred to STEP."
            )
        stream = io.BytesIO()
        if writer.WriteStream(stream) != IFSelect_RetDone:
            raise EngineError("cad-export-failed", "The STEP output could not be serialized.")
        payload = stream.getvalue()
        if len(payload) > 64 * 1024 * 1024:
            raise EngineError("cad-resource-limit", "The STEP output exceeds 64 MiB.")
        return payload
    finally:
        Interface_Static.SetCVal_s("write.step.unit", previous)


def export_brep(shape: Any) -> bytes:
    """Export exact metre coordinates; BRep itself has no declared length unit."""
    transform = gp_Trsf()
    transform.SetScale(gp_Pnt(), 1 / KERNEL_PER_METRE)
    si_shape = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    stream = io.BytesIO()
    BRepTools.Write_s(si_shape, stream, False, False, TopTools_FormatVersion_VERSION_3)
    payload = stream.getvalue()
    if len(payload) > 64 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "The exact BRep output exceeds 64 MiB.")
    return payload


def read_brep(payload: bytes) -> Any:
    """Read this application's metre-coordinate BRep into internal kernel units."""
    if not payload or len(payload) > 64 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "The BRep source exceeds its resource limit.")
    shape = TopoDS_Shape()
    BRepTools.Read_s(shape, io.BytesIO(payload), BRep_Builder())
    if shape.IsNull():
        raise EngineError("invalid-cad", "The SI BRep source could not be decoded.")
    transform = gp_Trsf()
    transform.SetScale(gp_Pnt(), KERNEL_PER_METRE)
    shape = BRepBuilderAPI_Transform(shape, transform, True).Shape()
    valid_shape(shape)
    return shape


def _primitive_sizes(feature: dict[str, Any], names: tuple[str, ...]) -> tuple[float, ...]:
    """Check authored SI sizes before entering platform-specific kernel bindings.

    Boxes and cylinders reject sizes <=Precision::Confusion in working units.
    Keep that actual kernel tolerance; never clamp, enlarge or scale the design.
    https://occt3d.com/dev/doc/refman/html/class_b_rep_prim_a_p_i___make_box.html
    https://occt3d.com/dev/doc/refman/html/class_b_rep_prim_a_p_i___make_cylinder.html
    """
    minimum_si = Precision.Confusion_s() * (1 / KERNEL_PER_METRE)
    values = []
    for name in names:
        value = feature[name]
        # This interval also rejects NaN/infinities without converting a huge
        # untrusted Python integer to float. The upper bound is canonical SI.
        if type(value) not in (int, float) or not minimum_si < value <= 1000:
            raise EngineError(
                "invalid-cad-dimensions",
                f"{name.title()} must be finite, greater than OCCT's {minimum_si:g} m "
                "modeling tolerance and at most 1000 m. Revise the authored dimension.",
            )
        values.append(value * KERNEL_PER_METRE)
    return tuple(values)


def build(geometry: dict[str, Any], assets: dict[str, bytes]) -> CadBuild:
    shapes: dict[str, Any] = {}
    ownership: dict[str, tuple[BodyInstance, ...]] = {}
    planes: dict[str, str] = {}
    metadata = []
    features = output_features(geometry)
    indexed = {feature["id"]: feature for feature in features}
    spines = spine_features(features)

    def authored_sketch(identifier: str) -> bool:
        visited: set[str] = set()
        while identifier not in visited:
            visited.add(identifier)
            source = indexed[identifier]
            if source["kind"] == "sketch":
                return True
            if source["kind"] != "transform":
                return False
            identifier = source["inputId"]
        return False

    for feature in features:
        identifier, kind = feature["id"], feature["kind"]
        details: dict[str, Any] = {"id": identifier, "kind": kind, "name": feature["name"]}
        instances: tuple[BodyInstance, ...] | None = None
        try:
            if kind == "box":
                shape = BRepPrimAPI_MakeBox(
                    *_primitive_sizes(feature, ("length", "width", "height"))
                ).Shape()
            elif kind == "cylinder":
                shape = BRepPrimAPI_MakeCylinder(
                    gp_Ax2(gp_Pnt(), gp_Dir(1, 0, 0)),
                    *_primitive_sizes(feature, ("radius", "length")),
                ).Shape()
            elif kind == "import-step":
                shape, units = import_step(assets[feature["assetId"]], feature["scaleFactor"])
                details["sourceUnits"] = units
            elif kind == "sketch":
                shape, sketch_metadata = (sketch_spine if identifier in spines else sketch_face)(
                    feature["sketch"], feature["plane"]
                )
                planes[identifier] = feature["plane"]
                details["sketch"] = sketch_metadata
            elif kind == "extrude":
                source_id = feature["sketchId"]
                normal = {"xy": (0, 0, 1), "xz": (0, -1, 0), "yz": (1, 0, 0)}[planes[source_id]]
                operation = BRepPrimAPI_MakePrism(
                    shapes[source_id],
                    gp_Vec(
                        *(
                            component * feature["distance"] * KERNEL_PER_METRE
                            for component in normal
                        )
                    ),
                )
                shape = operation.Shape()
            elif kind == "revolve":
                axis = gp_Ax1(
                    gp_Pnt(*(v * KERNEL_PER_METRE for v in feature["axisOrigin"])),
                    gp_Dir(*feature["axisDirection"]),
                )
                shape = BRepPrimAPI_MakeRevol(
                    shapes[feature["sketchId"]], axis, feature["angle"]
                ).Shape()
            elif kind == "boolean":
                operation = {
                    "union": BRepAlgoAPI_Fuse,
                    "cut": BRepAlgoAPI_Cut,
                    "intersect": BRepAlgoAPI_Common,
                }[feature["operation"]]()
                arguments, tools = List_TopoDS_Shape(), List_TopoDS_Shape()
                arguments.Append(shapes[feature["leftId"]])
                tools.Append(shapes[feature["rightId"]])
                operation.SetArguments(arguments)
                operation.SetTools(tools)
                operation.SetNonDestructive(True)
                operation.Build()
                if not operation.IsDone():
                    raise EngineError(
                        "cad-feature-failed", "The Boolean operation did not complete."
                    )
                shape = operation.Shape()
                details["history"] = [
                    {
                        "sourceId": source_id,
                        "faceId": face.reference,
                        "modified": len(list(operation.Modified(face.shape))),
                        "generated": len(list(operation.Generated(face.shape))),
                        "deleted": operation.IsDeleted(face.shape),
                    }
                    for source_id in (feature["leftId"], feature["rightId"])
                    for face in entities(shapes[source_id], source_id, "face", ownership[source_id])
                ]
            elif kind == "loft":
                if not all(authored_sketch(source) for source in feature["sectionIds"]):
                    raise EngineError(
                        "unsupported-cad-section",
                        "Loft sections must be sketches or rigidly transformed sketches.",
                    )
                shape = loft(
                    tuple(shapes[source] for source in feature["sectionIds"]),
                    feature["solid"],
                    feature["ruled"],
                )
                details["sectionIds"] = list(feature["sectionIds"])
                details["solid"], details["ruled"] = feature["solid"], feature["ruled"]
            elif kind == "sweep":
                if not authored_sketch(feature["profileId"]):
                    raise EngineError(
                        "unsupported-cad-section",
                        "Sweep profiles must be sketches or rigidly transformed sketches.",
                    )
                shape = sweep(
                    shapes[feature["profileId"]], shapes[feature["spineId"]], feature["solid"]
                )
                details.update(
                    profileId=feature["profileId"],
                    spineId=feature["spineId"],
                    solid=feature["solid"],
                    transitionMode="miter",
                    trihedron="corrected-frenet",
                    profilePlacement="authored",
                )
            elif kind == "assembly":
                components = feature["components"]
                if not 1 <= len(components) <= 32 or len({c["id"] for c in components}) != len(
                    components
                ):
                    raise EngineError(
                        "invalid-assembly", "An assembly needs 1–32 uniquely identified components."
                    )
                # Independent copies cannot share publication topology. Reject
                # impossible expansions before allocating any component copy.
                for topology in (TopAbs_SOLID, TopAbs_FACE, TopAbs_EDGE):
                    count = sum(
                        len(subshapes(shapes[component["featureId"]], topology))
                        for component in components
                    )
                    if count > MAX_ENTITIES:
                        raise EngineError(
                            "cad-resource-limit",
                            "Assembly topology exceeds 2048 entities per kind.",
                        )
                compound = TopoDS_Compound()
                builder = BRep_Builder()
                builder.MakeCompound(compound)
                members = []
                for component in components:
                    source_id = component["featureId"]
                    source = shapes[source_id]
                    source_members = ownership[source_id]
                    if not source_members or any(
                        not any(
                            entity.IsSame(member_entity)
                            for member in source_members
                            for member_entity in subshapes(member.shape, topology)
                        )
                        for topology in (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX)
                        for entity in subshapes(source, topology)
                    ):
                        raise EngineError(
                            "unsupported-assembly-member",
                            "Assembly components must contain only closed solids.",
                        )
                    for member in source_members:
                        validate_result(member.shape, True)
                    copied = BRepBuilderAPI_Copy(source, True, False)
                    builder.Add(compound, copied.Shape())
                    for member in source_members:
                        path = (component["id"], *member.component_path)
                        if len(path) > 128:
                            raise EngineError(
                                "cad-resource-limit", "Assembly nesting exceeds 128 components."
                            )
                        members.append(
                            BodyInstance(
                                copied.ModifiedShape(member.shape),
                                component["name"],
                                source_id,
                                path,
                            )
                        )
                shape, instances = compound, tuple(members)
                details["components"] = list(components)
                details["bonding"] = "none"
            elif kind == "transform":
                source_id = feature["inputId"]
                direction = feature["axisDirection"]
                magnitude = math.hypot(*direction)
                if magnitude == 0 or not math.isfinite(magnitude):
                    raise EngineError(
                        "invalid-cad-transform", "A rigid transform needs a finite nonzero axis."
                    )
                rotation = gp_Trsf()
                rotation.SetRotation(
                    gp_Ax1(
                        gp_Pnt(*(value * KERNEL_PER_METRE for value in feature["axisOrigin"])),
                        gp_Dir(*(value / magnitude for value in direction)),
                    ),
                    feature["angle"],
                )
                translation = gp_Trsf()
                translation.SetTranslation(
                    gp_Vec(*(value * KERNEL_PER_METRE for value in feature["translation"]))
                )
                # OCCT PreMultiply computes T * R: rotate about the authored
                # global axis first, then translate in global SI directions.
                rotation.PreMultiply(translation)
                operation = BRepBuilderAPI_Transform(shapes[source_id], rotation, True)
                if not operation.IsDone():
                    raise EngineError("cad-feature-failed", "The rigid transform did not complete.")
                shape = operation.Shape()
                instances = tuple(
                    BodyInstance(
                        operation.ModifiedShape(member.shape),
                        member.name,
                        member.source_feature_id,
                        member.component_path,
                    )
                    for member in ownership[source_id]
                )
                details["history"] = [
                    {
                        "sourceId": source_id,
                        "faceId": face.reference,
                        "modified": len(list(operation.Modified(face.shape))),
                        "generated": len(list(operation.Generated(face.shape))),
                        "deleted": operation.IsDeleted(face.shape),
                    }
                    for face in entities(shapes[source_id], source_id, "face", ownership[source_id])
                ]
            elif kind in ("fillet", "chamfer"):
                source_id = feature["inputId"]
                if any(member.component_path for member in ownership[source_id]):
                    raise EngineError(
                        "unsupported-assembly-finish",
                        "Round or bevel each component before assembling it.",
                    )
                copied = BRepBuilderAPI_Copy(shapes[source_id], True, False).Shape()
                selected = selected_edges(copied, source_id, feature["edgeIds"])
                operation = (
                    BRepFilletAPI_MakeFillet if kind == "fillet" else BRepFilletAPI_MakeChamfer
                )(copied)
                size = feature["radius" if kind == "fillet" else "distance"] * KERNEL_PER_METRE
                for edge in selected:
                    operation.Add(size, edge)
                operation.Build()
                if not operation.IsDone():
                    raise EngineError(
                        "cad-feature-failed",
                        f"The {kind} is invalid at the selected size; reduce it or reselect edges.",
                    )
                shape = operation.Shape()
            else:
                raise EngineError("unsupported-cad-feature", "The CAD feature is not implemented.")
            valid_shape(shape, require_faces=identifier not in spines)
            requires_solid = (
                feature["solid"]
                if kind in ("loft", "sweep")
                else kind not in ("sketch", "import-step", "transform")
            )
            if requires_solid and not subshapes(shape, TopAbs_SOLID):
                raise EngineError(
                    "invalid-cad-solid", "The solid feature produced no closed volume."
                )
            shapes[identifier] = shape
            ownership[identifier] = (
                instances
                if instances is not None
                else tuple(
                    BodyInstance(solid, feature["name"], identifier)
                    for solid in subshapes(shape, TopAbs_SOLID)
                )
            )
            metadata.append(details)
        except EngineError as error:
            raise EngineError(error.code, f"Feature {feature['name']}: {error}") from error
        except (
            KeyError,
            ValueError,
            RuntimeError,
            Standard_DomainError,
            Standard_Failure,
        ) as error:
            reason = str(error).strip() or "The exact kernel rejected its dimensions or topology."
            raise EngineError(
                "cad-feature-failed", f"Feature {feature['name']} could not be recomputed: {reason}"
            ) from error
    return CadBuild(
        shapes[geometry["outputFeatureId"]],
        geometry["outputFeatureId"],
        tuple(metadata),
        ownership[geometry["outputFeatureId"]],
    )
