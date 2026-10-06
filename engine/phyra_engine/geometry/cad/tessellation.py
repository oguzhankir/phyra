"""Bounded SI display buffers; exact BRep geometry remains authoritative."""

from dataclasses import dataclass
from typing import Any

import numpy as np
from OCP.BRep import BRep_Tool  # type: ignore[import-untyped]
from OCP.BRepAdaptor import BRepAdaptor_Curve  # type: ignore[import-untyped]
from OCP.BRepMesh import BRepMesh_IncrementalMesh  # type: ignore[import-untyped]
from OCP.GCPnts import GCPnts_QuasiUniformDeflection  # type: ignore[import-untyped]
from OCP.TopAbs import TopAbs_REVERSED  # type: ignore[import-untyped]
from OCP.TopLoc import TopLoc_Location  # type: ignore[import-untyped]
from OCP.TopoDS import TopoDS  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.topology import KERNEL_PER_METRE, Entity, bounds, entities

MAX_POINTS = 250_000
MAX_DISPLAY_TRIANGLES = 250_000


@dataclass(frozen=True)
class CadDisplay:
    arrays: dict[str, np.ndarray]
    faces: tuple[Entity, ...]
    edges: tuple[Entity, ...]
    bodies: tuple[Entity, ...]
    deflection: float


def tessellate(shape: Any, owner_id: str) -> CadDisplay:
    low, high = np.asarray(bounds(shape))
    extent = float(np.max(high - low))
    if not np.isfinite(extent) or not 1e-9 <= extent <= 10_000:
        raise EngineError(
            "unsupported-cad-scale", "CAD display requires an extent between 1 nm and 10 km."
        )
    deflection = max(extent / 1000, 1e-9)
    faces, edges, bodies = (entities(shape, owner_id, kind) for kind in ("face", "edge", "body"))
    mesher = BRepMesh_IncrementalMesh(shape, deflection * KERNEL_PER_METRE, False, 0.3, False)
    if not mesher.IsDone():
        raise EngineError("cad-display-failed", "The exact CAD shape could not be tessellated.")
    positions: list[list[float]] = []
    triangles: list[list[int]] = []
    triangle_faces: list[int] = []
    for index, entity in enumerate(faces):
        face = TopoDS.Face(entity.shape)
        location = TopLoc_Location()
        mesh = BRep_Tool.Triangulation_s(face, location)
        if mesh is None or mesh.NbNodes() < 3:
            raise EngineError("cad-display-failed", "A CAD face has no display triangulation.")
        if (
            len(positions) + mesh.NbNodes() > MAX_POINTS
            or len(triangles) + mesh.NbTriangles() > MAX_DISPLAY_TRIANGLES
        ):
            raise EngineError(
                "cad-resource-limit", "The CAD display exceeds its node or triangle limit."
            )
        offset = len(positions)
        transform = location.Transformation()
        for node in range(1, mesh.NbNodes() + 1):
            point = mesh.Node(node).Transformed(transform)
            positions.append(
                [
                    point.X() / KERNEL_PER_METRE,
                    point.Y() / KERNEL_PER_METRE,
                    point.Z() / KERNEL_PER_METRE,
                ]
            )
        for triangle in range(1, mesh.NbTriangles() + 1):
            a, b, c = mesh.Triangle(triangle).Get()
            if face.Orientation() == TopAbs_REVERSED:
                b, c = c, b
            triangles.append([offset + a - 1, offset + b - 1, offset + c - 1])
            triangle_faces.append(index)
    edge_positions: list[list[float]] = []
    edge_segments: list[list[int]] = []
    segment_edges: list[int] = []
    for index, entity in enumerate(edges):
        if entity.metadata().get("degenerate"):
            continue
        curve = BRepAdaptor_Curve(TopoDS.Edge(entity.shape))
        sampler = GCPnts_QuasiUniformDeflection(curve, deflection * KERNEL_PER_METRE)
        if not sampler.IsDone():
            raise EngineError("cad-display-failed", "A CAD edge could not be sampled for display.")
        count = sampler.NbPoints()
        if len(edge_positions) + count > MAX_POINTS:
            raise EngineError("cad-resource-limit", "The CAD edge display exceeds its point limit.")
        offset = len(edge_positions)
        for node in range(1, count + 1):
            point = sampler.Value(node)
            edge_positions.append(
                [
                    point.X() / KERNEL_PER_METRE,
                    point.Y() / KERNEL_PER_METRE,
                    point.Z() / KERNEL_PER_METRE,
                ]
            )
            if node > 1:
                edge_segments.append([offset + node - 2, offset + node - 1])
                segment_edges.append(index)
    arrays: dict[str, np.ndarray] = {
        "positions": np.asarray(positions, dtype=np.float64).reshape(-1, 3),
        "triangles": np.asarray(triangles, dtype=np.uint32).reshape(-1, 3),
        "triangleFaces": np.asarray(triangle_faces, dtype=np.uint32),
        "edgePositions": np.asarray(edge_positions, dtype=np.float64).reshape(-1, 3),
        "edgeSegments": np.asarray(edge_segments, dtype=np.uint32).reshape(-1, 2),
        "segmentEdges": np.asarray(segment_edges, dtype=np.uint32),
    }
    if any(not np.isfinite(array).all() for array in arrays.values()):
        raise EngineError("invalid-cad-display", "CAD display contains nonfinite coordinates.")
    return CadDisplay(arrays, faces, edges, bodies, deflection)
