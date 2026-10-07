"""Conservative exact CAD face correspondence through Gmsh's private XAO export.

The XAO face table associates named Gmsh tags with exact BRep subshapes. Matching
the complete normalized face serialization includes the underlying surface,
trimming curves, topology, tolerances, placement and orientation. No geometric
sampling, nearest-face guess or index ordering establishes correspondence.

https://gmsh.info/doc/texinfo/#Geometry-module
https://dev.opencascade.org/doc/refman/html/class_topo_d_s___shape.html
"""

import hashlib
import io
import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import gmsh  # type: ignore[import-untyped]
from OCP.BRep import BRep_Builder  # type: ignore[import-untyped]
from OCP.BRepAdaptor import BRepAdaptor_Surface  # type: ignore[import-untyped]
from OCP.BRepTools import BRepTools  # type: ignore[import-untyped]
from OCP.collections import (  # type: ignore[import-untyped]
    IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher,
)
from OCP.TopAbs import TopAbs_FACE  # type: ignore[import-untyped]
from OCP.TopExp import TopExp  # type: ignore[import-untyped]
from OCP.TopoDS import TopoDS, TopoDS_Shape  # type: ignore[import-untyped]
from OCP.TopTools import TopTools_FormatVersion_VERSION_3  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_BUFFER_BYTES
from phyra_engine.geometry.cad.topology import (
    KERNEL_PER_METRE,
    MAX_ENTITIES,
    Entity,
    properties,
    subshapes,
)


@dataclass(frozen=True)
class CadCorrespondence:
    """All-or-nothing exact source IDs in the supplied mesh-region order."""

    face_ids: tuple[str, ...] = ()
    reason: str | None = None

    def metadata(self) -> dict[str, str]:
        result = {
            "status": "unavailable" if self.reason else "verified",
            "scope": "unchanged-geometry",
            "method": "exact-brep-round-trip",
        }
        if self.reason:
            result["reason"] = self.reason
        return result


class _Unavailable(ValueError):
    pass


def _shape_map(shape: Any) -> Any:
    mapping = IndexedMap_TopoDS_Shape_TopTools_ShapeMapHasher()
    TopExp.MapShapes_s(shape, mapping)
    if mapping.Extent() > MAX_ENTITIES * 6:
        raise _Unavailable("Exact face correspondence exceeds the topology inspection limit.")
    return mapping


def canonical_face_bytes(face: Any) -> bytes:
    """Normalize only the Checked cache flag and exact signed-zero tokens.

    The isolated worker owns this private normalized/imported shape. Temporarily
    clear Checked through the API and restore it in finally, without assumptions
    about flag positions in BRep text. Copying only a face would silently remove
    adjacent-face p-curves from its shared edges, so do not rebuild its topology.
    The writer emits whitespace-delimited numeric tokens; -0 and 0 describe the
    same value. Every other token, including negative coordinates and exponents,
    stays byte-for-byte unchanged; there is no tolerance or numeric rounding.
    """
    original = _shape_map(face)
    saved = [
        (original.FindKey(index), original.FindKey(index).Checked())
        for index in range(1, original.Extent() + 1)
    ]
    try:
        for child, _ in saved:
            child.Checked(False)
        stream = io.BytesIO()
        BRepTools.Write_s(face, stream, False, False, TopTools_FormatVersion_VERSION_3)
    finally:
        for child, checked in saved:
            child.Checked(checked)
    payload = stream.getvalue()
    if not 0 < len(payload) <= MAX_BUFFER_BYTES:
        raise _Unavailable("Exact face correspondence exceeds the 64 MiB inspection limit.")
    return re.sub(rb"(?<!\S)-0(?!\S)", b"0", payload)


def _xao_faces(payload: bytes, tags: tuple[int, ...]) -> dict[int, Any]:
    """Read only bounded, embedded BRep data written by the isolated Gmsh job."""
    if (
        not 0 < len(payload) <= MAX_BUFFER_BYTES
        or b"<!DOCTYPE" in payload.upper()
        or b"<!ENTITY" in payload.upper()
    ):
        raise _Unavailable("The mesher's exact face export is not a bounded embedded BRep.")
    root = ET.fromstring(payload)
    geometry = root.find("geometry")
    if root.tag != "XAO" or geometry is None:
        raise _Unavailable("The mesher did not return an exact face correspondence table.")
    brep = geometry.find("shape")
    table = geometry.find("topology/faces")
    if (
        brep is None
        or brep.attrib != {"format": "BREP"}
        or not brep.text
        or table is None
        or table.get("count") != str(len(tags))
        or len(table) != len(tags)
    ):
        raise _Unavailable("The mesher changed or omitted exact boundary faces during import.")
    shape = TopoDS_Shape()
    BRepTools.Read_s(shape, io.BytesIO(brep.text.encode("utf-8")), BRep_Builder())
    if shape.IsNull() or len(subshapes(shape, TopAbs_FACE)) != len(tags):
        raise _Unavailable("The mesher changed or omitted exact boundary faces during import.")
    mapping = _shape_map(shape)
    result: dict[int, Any] = {}
    references: set[int] = set()
    for item in table:
        name = re.fullmatch(r"phyra-face-([1-9][0-9]*)", item.get("name", ""))
        raw_reference = item.get("reference", "")
        if item.tag != "face" or name is None or not re.fullmatch(r"[1-9][0-9]*", raw_reference):
            raise _Unavailable("The mesher's exact boundary face labels are incomplete.")
        tag, reference = int(name[1]), int(raw_reference)
        if (
            tag not in tags
            or tag in result
            or reference in references
            or reference > mapping.Extent()
        ):
            raise _Unavailable("The mesher's exact boundary face labels are ambiguous.")
        face = mapping.FindKey(reference)
        if face.ShapeType() != TopAbs_FACE:
            raise _Unavailable("The mesher's boundary reference does not identify an exact face.")
        result[tag] = face
        references.add(reference)
    if set(result) != set(tags):
        raise _Unavailable("The mesher's exact boundary face labels are incomplete.")
    return result


def _tag_geometry_agrees(tag: int, face: Any) -> bool:
    """Cross-check XAO tag associations against the live imported Gmsh model.

    This only checks the exporter table; it never selects a source face. Source
    identity still requires equality of the complete exact face representation.
    Exported surface parameterization is retained, so evaluate the same UV values
    independently in both kernels. A changed table or unsupported parameterization
    leaves correspondence unavailable.
    """
    area, center = properties(face, "face")
    if not math.isclose(area * KERNEL_PER_METRE**2, gmsh.model.occ.getMass(2, tag), rel_tol=1e-9):
        return False
    if any(
        not math.isclose(a * KERNEL_PER_METRE, b, rel_tol=1e-12, abs_tol=1e-10)
        for a, b in zip(center, gmsh.model.occ.getCenterOfMass(2, tag), strict=True)
    ):
        return False
    low, high = gmsh.model.getParametrizationBounds(2, tag)
    if len(low) != 2 or len(high) != 2 or not all(math.isfinite(v) for v in (*low, *high)):
        return False
    surface = BRepAdaptor_Surface(TopoDS.Face(face), True)
    for u in (0.173, 0.427, 0.811):
        for v in (0.173, 0.427, 0.811):
            parameters = [low[0] + u * (high[0] - low[0]), low[1] + v * (high[1] - low[1])]
            point = surface.Value(*parameters)
            measured = gmsh.model.getValue(2, tag, parameters)
            if len(measured) != 3 or any(
                not math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-10)
                for a, b in zip((point.X(), point.Y(), point.Z()), measured, strict=True)
            ):
                return False
    return True


def verify_cad_correspondence(
    source_faces: tuple[Entity, ...], normalization: Any, tags: tuple[int, ...]
) -> CadCorrespondence:
    """Verify a complete bijection, or leave every boundary mesh-scoped only."""
    try:
        if (
            not source_faces
            or len(source_faces) != len(tags)
            or any(e.ambiguous for e in source_faces)
        ):
            raise _Unavailable(
                "The source CAD faces are ambiguous or changed during meshing import."
            )
        expected: dict[bytes, str] = {}
        total = 0
        for entity in source_faces:
            # ModifiedShape identifies the copied subshape, but its returned
            # wrapper need not carry the parent's cumulative orientation. The
            # normalization is a positive uniform scale and translation.
            normalized = normalization.ModifiedShape(entity.shape).Oriented(
                entity.shape.Orientation()
            )
            if normalized.IsNull() or normalized.ShapeType() != TopAbs_FACE:
                raise _Unavailable("The normalization did not preserve an exact source face.")
            payload = canonical_face_bytes(normalized)
            total += len(payload)
            if total > MAX_BUFFER_BYTES:
                raise _Unavailable("Exact face correspondence exceeds the 64 MiB inspection limit.")
            signature = hashlib.sha256(payload).digest()
            if signature in expected:
                raise _Unavailable(
                    "Multiple source faces have the same exact boundary representation."
                )
            expected[signature] = entity.reference
        for tag in tags:
            gmsh.model.setEntityName(2, tag, f"phyra-face-{tag}")
        with TemporaryDirectory(prefix="phyra-cad-faces-") as directory:
            export = Path(directory) / "faces.xao"
            try:
                gmsh.write(str(export))
            except Exception as error:
                raise _Unavailable(
                    "This mesher cannot export exact face correspondence."
                ) from error
            if export.stat().st_size > MAX_BUFFER_BYTES:
                raise _Unavailable("The mesher's exact face export exceeds 64 MiB.")
            exported = _xao_faces(export.read_bytes(), tags)
        matched: list[str] = []
        total = 0
        for tag in tags:
            if not _tag_geometry_agrees(tag, exported[tag]):
                raise _Unavailable(
                    "The mesher's face table does not agree with its exact surfaces."
                )
            payload = canonical_face_bytes(exported[tag])
            total += len(payload)
            if total > MAX_BUFFER_BYTES:
                raise _Unavailable("Exact face correspondence exceeds the 64 MiB inspection limit.")
            reference = expected.get(hashlib.sha256(payload).digest())
            if reference is None or reference in matched:
                raise _Unavailable(
                    "The mesher's exact faces differ from the source CAD representation. "
                    "Boundary correspondence is unavailable for this geometry."
                )
            matched.append(reference)
        return CadCorrespondence(tuple(matched))
    except _Unavailable as error:
        return CadCorrespondence(reason=str(error))
    except (OSError, ValueError, RuntimeError, ET.ParseError) as error:
        # Export/correspondence failure never turns an otherwise usable inspection
        # mesh into an authored topology assignment. No partial guesses escape.
        if isinstance(error, EngineError):
            raise
        return CadCorrespondence(
            reason="The mesher's exact face correspondence could not be verified."
        )
