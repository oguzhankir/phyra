"""Exact SI measurements and conservative, content-addressed entity references.

References survive unchanged geometry, not arbitrary topology edits. Duplicate
signatures are explicitly ambiguous; no array-index or nearest-face fallback is
allowed for a physical or modeling assignment.
"""

import hashlib
import io
import json
from dataclasses import dataclass
from typing import Any

from OCP.Bnd import Bnd_Box  # type: ignore[import-untyped]
from OCP.BRep import BRep_Tool  # type: ignore[import-untyped]
from OCP.BRepAdaptor import BRepAdaptor_Curve, BRepAdaptor_Surface  # type: ignore[import-untyped]
from OCP.BRepBndLib import BRepBndLib  # type: ignore[import-untyped]
from OCP.BRepGProp import BRepGProp  # type: ignore[import-untyped]
from OCP.BRepTools import BRepTools  # type: ignore[import-untyped]
from OCP.GProp import GProp_GProps  # type: ignore[import-untyped]
from OCP.TopAbs import TopAbs_EDGE, TopAbs_FACE, TopAbs_SOLID  # type: ignore[import-untyped]
from OCP.TopExp import TopExp_Explorer  # type: ignore[import-untyped]
from OCP.TopoDS import TopoDS  # type: ignore[import-untyped]
from OCP.TopTools import TopTools_FormatVersion_VERSION_3  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError

KERNEL_PER_METRE = 1000.0
MAX_ENTITIES = 2048


@dataclass(frozen=True)
class Entity:
    reference: str
    shape: Any
    metadata_json: bytes
    ambiguous: bool

    def metadata(self) -> dict[str, Any]:
        return json.loads(self.metadata_json)


@dataclass(frozen=True)
class BodyInstance:
    """Exact solid ownership; assembly identity is independent of geometric coincidence."""

    shape: Any
    name: str
    source_feature_id: str
    component_path: tuple[str, ...] = ()


def subshapes(shape: Any, kind: Any) -> tuple[Any, ...]:
    explorer = TopExp_Explorer(shape, kind)
    values: list[Any] = []
    while explorer.More():
        child = explorer.Current()
        if not any(child.IsSame(old) for old in values):
            values.append(child)
            if len(values) > MAX_ENTITIES:
                raise EngineError(
                    "cad-resource-limit", "CAD topology exceeds 2048 entities per kind."
                )
        explorer.Next()
    return tuple(values)


def bounds(shape: Any) -> list[list[float]]:
    box = Bnd_Box()
    BRepBndLib.AddOptimal_s(shape, box, False, False)
    if box.IsVoid():
        raise EngineError("invalid-cad", "The CAD result has no finite bounding box.")
    return [
        [point.X() / KERNEL_PER_METRE, point.Y() / KERNEL_PER_METRE, point.Z() / KERNEL_PER_METRE]
        for point in (box.CornerMin(), box.CornerMax())
    ]


def properties(shape: Any, kind: str) -> tuple[float, list[float]]:
    props = GProp_GProps()
    if kind == "edge":
        BRepGProp.LinearProperties_s(shape, props)
    elif kind == "face":
        BRepGProp.SurfaceProperties_s(shape, props)
    else:
        BRepGProp.VolumeProperties_s(shape, props)
    order = {"edge": 1, "face": 2, "body": 3}[kind]
    center = props.CentreOfMass()
    return props.Mass() / KERNEL_PER_METRE**order, [
        center.X() / KERNEL_PER_METRE,
        center.Y() / KERNEL_PER_METRE,
        center.Z() / KERNEL_PER_METRE,
    ]


def _signature(shape: Any, kind: str) -> tuple[str, dict[str, Any]]:
    measure, center = properties(shape, kind)
    metadata: dict[str, Any] = {"bounds": bounds(shape), "centroid": center}
    metadata[{"edge": "length", "face": "area", "body": "volume"}[kind]] = measure
    if kind == "edge" and BRep_Tool.Degenerated_s(TopoDS.Edge(shape)):
        metadata["degenerate"] = True
        metadata["samples"] = []
    elif kind == "edge":
        curve = BRepAdaptor_Curve(TopoDS.Edge(shape))
        metadata["curveType"] = str(curve.GetType()).split(".")[-1]
        # Interior samples distinguish curves with the same endpoints, bounds and length.
        low, high = curve.FirstParameter(), curve.LastParameter()
        samples = []
        for fraction in (0, 0.25, 0.5, 0.75, 1):
            p = curve.Value(low + fraction * (high - low))
            samples.append(
                [p.X() / KERNEL_PER_METRE, p.Y() / KERNEL_PER_METRE, p.Z() / KERNEL_PER_METRE]
            )
        samples = min(samples, list(reversed(samples)))
        metadata["samples"] = samples
    elif kind == "face":
        surface = BRepAdaptor_Surface(TopoDS.Face(shape), True)
        metadata["surfaceType"] = str(surface.GetType()).split(".")[-1]
        # Include exact boundary signatures so two trimmed patches cannot be
        # accepted merely because their area and centroid coincide.
        metadata["boundarySignatures"] = sorted(
            _signature(edge, "edge")[0] for edge in subshapes(shape, TopAbs_EDGE)
        )
    else:
        metadata["faceSignatures"] = sorted(
            _signature(face, "face")[0] for face in subshapes(shape, TopAbs_FACE)
        )
    # Measurements and samples describe an entity, but cannot establish exact
    # identity for arbitrary spline surfaces/curves. Hash the complete exact
    # subshape serialization without display triangulations or normals.
    stream = io.BytesIO()
    BRepTools.Write_s(shape, stream, False, False, TopTools_FormatVersion_VERSION_3)
    exact = stream.getvalue()
    if len(exact) > 64 * 1024 * 1024:
        raise EngineError("cad-resource-limit", "Exact CAD entity content exceeds 64 MiB.")
    return hashlib.sha256(exact).hexdigest()[:24], metadata


def _owner_token(owner_id: str) -> str:
    # Canonical IDs may contain Unicode. Transport references remain <=200
    # UTF-8 bytes; the original authored IDs live in explicit metadata.
    return (
        owner_id
        if len(owner_id.encode("utf-8")) <= 100
        else "feature-" + hashlib.sha256(owner_id.encode("utf-8")).hexdigest()[:24]
    )


def entities(
    shape: Any, owner_id: str, kind: str, body_instances: tuple[BodyInstance, ...] = ()
) -> tuple[Entity, ...]:
    enum = {"edge": TopAbs_EDGE, "face": TopAbs_FACE, "body": TopAbs_SOLID}[kind]
    owner = _owner_token(owner_id)
    solids = subshapes(shape, TopAbs_SOLID)
    if body_instances and (
        len(body_instances) != len(solids)
        or any(
            sum(instance.shape.IsSame(solid) for instance in body_instances) != 1
            for solid in solids
        )
    ):
        raise EngineError(
            "invalid-cad-ownership", "CAD solid ownership does not match its topology."
        )
    bodies = entities(shape, owner_id, "body", body_instances) if kind != "body" else ()
    memberships = [subshapes(solid, enum) for solid in solids] if kind != "body" else []
    raw = []
    for index, child in enumerate(subshapes(shape, enum)):
        signature, metadata = _signature(child, kind)
        context = owner
        inherited_ambiguity = False
        if kind == "body":
            instance = next(
                (instance for instance in body_instances if instance.shape.IsSame(child)), None
            )
            metadata["name"] = instance.name if instance else f"Body {index + 1}"
            if instance:
                metadata["sourceFeatureId"] = instance.source_feature_id
                if instance.component_path:
                    path_hash = hashlib.sha256(
                        json.dumps(instance.component_path, ensure_ascii=False).encode("utf-8")
                    ).hexdigest()[:24]
                    context += "/instance/" + path_hash
                    metadata["componentId"] = instance.component_path[0]
                    metadata["componentPath"] = list(instance.component_path)
        else:
            metadata["name"] = f"{kind.title()} {index + 1}"
            owners = [
                body
                for body, children in zip(bodies, memberships, strict=True)
                if any(child.IsSame(member) for member in children)
            ]
            if len(owners) == 1:
                body = owners[0]
                metadata["bodyId"] = body.reference
                inherited_ambiguity = body.ambiguous
                if body.metadata().get("componentPath"):
                    context += (
                        "/member/" + hashlib.sha256(body.reference.encode("utf-8")).hexdigest()[:24]
                    )
            elif len(owners) > 1:
                inherited_ambiguity = True
        raw.append((child, context, signature, metadata, inherited_ambiguity))
    counts: dict[tuple[str, str], int] = {}
    for _, context, signature, _, _ in raw:
        key = (context, signature)
        counts[key] = counts.get(key, 0) + 1
    result = []
    for index, (child, context, signature, metadata, inherited_ambiguity) in enumerate(raw):
        reference = f"{context}/{kind}/{signature}"
        ambiguous = counts[(context, signature)] > 1 or inherited_ambiguity
        if ambiguous:
            # A display token may distinguish coincident rows. It never becomes
            # a semantic reference: selected_edges rejects every ambiguous row.
            reference += f"/ambiguous-{index + 1}"
        metadata.update(id=reference, identity="ambiguous" if ambiguous else "content-reference")
        result.append(
            Entity(reference, child, json.dumps(metadata, allow_nan=False).encode(), ambiguous)
        )
    return tuple(result)


def selected_edges(
    shape: Any,
    owner_id: str,
    references: list[str],
    body_instances: tuple[BodyInstance, ...] = (),
) -> tuple[Any, ...]:
    if not references or len(set(references)) != len(references):
        raise EngineError("invalid-cad-selection", "Select existing edges without duplicates.")
    available = entities(shape, owner_id, "edge", body_instances)
    result = []
    for reference in references:
        matches = [entity for entity in available if entity.reference == reference]
        if len(matches) != 1 or matches[0].ambiguous or matches[0].metadata().get("degenerate"):
            raise EngineError(
                "cad-selection-repair", "A selected edge changed or is ambiguous; reselect it."
            )
        result.append(TopoDS.Edge(matches[0].shape))
    return tuple(result)
