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


def entities(shape: Any, owner_id: str, kind: str) -> tuple[Entity, ...]:
    enum = {"edge": TopAbs_EDGE, "face": TopAbs_FACE, "body": TopAbs_SOLID}[kind]
    raw = [(child, *_signature(child, kind)) for child in subshapes(shape, enum)]
    counts: dict[str, int] = {}
    for _, signature, _ in raw:
        counts[signature] = counts.get(signature, 0) + 1
    result = []
    for index, (child, signature, metadata) in enumerate(raw):
        metadata["name"] = f"{kind.title()} {index + 1}"
        reference = f"{owner_id}/{kind}/{signature}"
        ambiguous = counts[signature] > 1
        if ambiguous:
            # A display token may distinguish coincident rows. It never becomes
            # a semantic reference: selected_edges rejects every ambiguous row.
            reference += f"/ambiguous-{index + 1}"
        metadata.update(id=reference, identity="ambiguous" if ambiguous else "content-reference")
        result.append(
            Entity(reference, child, json.dumps(metadata, allow_nan=False).encode(), ambiguous)
        )
    return tuple(result)


def selected_edges(shape: Any, owner_id: str, references: list[str]) -> tuple[Any, ...]:
    if not references or len(set(references)) != len(references):
        raise EngineError("invalid-cad-selection", "Select existing edges without duplicates.")
    available = entities(shape, owner_id, "edge")
    result = []
    for reference in references:
        matches = [entity for entity in available if entity.reference == reference]
        if len(matches) != 1 or matches[0].ambiguous or matches[0].metadata().get("degenerate"):
            raise EngineError(
                "cad-selection-repair", "A selected edge changed or is ambiguous; reselect it."
            )
        result.append(TopoDS.Edge(matches[0].shape))
    return tuple(result)
