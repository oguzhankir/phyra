"""Exact single-solid BRep inspection with first-order tetrahedra, in SI.

Gmsh imports a private dimensionless BRep; no native pointer crosses OCCT
implementations. Boundary identifiers belong to this mesh only, never to the
authored CAD topology. No shape repair, contact or analysis admission is inferred.
https://gmsh.info/doc/texinfo/gmsh.html#Boolean-operations
https://gmsh.info/doc/texinfo/gmsh.html#Mesh-options
"""

import io
import math
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any

import gmsh  # type: ignore[import-untyped]
import numpy as np
from OCP.BRepBuilderAPI import BRepBuilderAPI_Transform  # type: ignore[import-untyped]
from OCP.BRepTools import BRepTools  # type: ignore[import-untyped]
from OCP.gp import gp_Pnt, gp_Trsf, gp_Vec  # type: ignore[import-untyped]
from OCP.TopAbs import (  # type: ignore[import-untyped]
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_SOLID,
    TopAbs_VERTEX,
)
from OCP.TopTools import TopTools_FormatVersion_VERSION_3  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.execution.limits import MAX_BUFFER_BYTES, MAX_CELLS, MAX_NODES, MAX_TRIANGLES
from phyra_engine.geometry.cad.kernel import valid_shape
from phyra_engine.geometry.cad.topology import KERNEL_PER_METRE, bounds, properties, subshapes
from phyra_engine.meshing.solid import collect_solid_mesh, tetra_volumes
from phyra_engine.meshing.types import Mesh

MAX_SIZE_EVALUATIONS = 250_000


@dataclass(frozen=True)
class CadMesh:
    mesh: Mesh
    exact_volume: float
    exact_surface_area: float
    target_size: float


def _single_solid(shape: Any) -> Any:
    valid_shape(shape)
    solids = subshapes(shape, TopAbs_SOLID)
    if len(solids) != 1:
        raise EngineError(
            "unsupported-cad-mesh", "Mesh inspection requires exactly one closed solid."
        )
    solid = solids[0]
    for kind in (TopAbs_FACE, TopAbs_EDGE, TopAbs_VERTEX):
        actual, expected = subshapes(shape, kind), subshapes(solid, kind)
        if len(actual) != len(expected) or any(
            not any(child.IsSame(member) for member in expected) for child in actual
        ):
            raise EngineError(
                "unsupported-cad-mesh", "Remove loose surfaces, edges or points before meshing."
            )
    return solid


def generate_cad_mesh(shape: Any, target_size: float, progress: Progress | None = None) -> CadMesh:
    """Mesh one valid kernel-unit solid; callers own worker isolation/cancellation."""
    if (
        isinstance(target_size, bool)
        or not isinstance(target_size, (int, float))
        or not math.isfinite(target_size)
        or not 0 < target_size <= 1000
    ):
        raise EngineError(
            "invalid-cad-mesh", "Mesh target size must be positive and at most 1000 m."
        )
    solid = _single_solid(shape)
    low, high = np.asarray(bounds(solid), dtype=np.float64)
    extents = high - low
    scale = float(extents.max())
    if not np.isfinite(extents).all() or scale <= 0 or extents.min() / scale < 1e-6:
        raise EngineError(
            "unsupported-cad-mesh", "Solid extents are too thin for the supported mesh inspection."
        )
    volume, _ = properties(solid, "body")
    area, _ = properties(solid, "face")
    if not all(math.isfinite(value) and value > 0 for value in (volume, area)):
        raise EngineError("invalid-cad-mesh", "The exact solid must have positive volume and area.")
    size, normalized_volume, normalized_area = (
        target_size / scale,
        volume / scale**3,
        area / scale**2,
    )
    if (
        not math.isfinite(size)
        or size < (12 * normalized_volume / MAX_CELLS) ** (1 / 3)
        or size < (4 * normalized_area / MAX_TRIANGLES) ** 0.5
        or size < (normalized_volume / MAX_NODES) ** (1 / 3)
    ):
        raise EngineError(
            "resource-limit", "Requested CAD mesh exceeds inspection limits. Increase target size."
        )
    transform = gp_Trsf()
    transform.SetScale(gp_Pnt(), 1 / (KERNEL_PER_METRE * scale))
    transform.SetTranslationPart(gp_Vec(*(-low / scale)))
    normalized = BRepBuilderAPI_Transform(solid, transform, True).Shape()
    valid_shape(normalized)
    stream = io.BytesIO()
    BRepTools.Write_s(normalized, stream, False, False, TopTools_FormatVersion_VERSION_3)
    payload = stream.getvalue()
    if not 0 < len(payload) <= MAX_BUFFER_BYTES:
        raise EngineError("cad-resource-limit", "Meshing BRep exceeds 64 MiB.")
    if progress:
        progress("geometry", None)
    gmsh.initialize([], readConfigFiles=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("General.NumThreads", 1)
        gmsh.model.add("phyra-cad-inspection")
        with TemporaryDirectory(prefix="phyra-cad-mesh-") as directory:
            source = Path(directory) / "solid.brep"
            source.write_bytes(payload)
            imported = gmsh.model.occ.importShapes(str(source), True, "brep")
        gmsh.model.occ.synchronize()
        if len(imported) != 1 or imported[0][0] != 3 or len(gmsh.model.getEntities(3)) != 1:
            raise EngineError("invalid-cad-mesh", "BRep import did not preserve one solid.")
        imported_volume = gmsh.model.occ.getMass(*imported[0])
        if not math.isclose(imported_volume, normalized_volume, rel_tol=1e-9):
            raise EngineError("invalid-cad-mesh", "BRep import changed the exact solid volume.")
        boundaries = sorted(gmsh.model.getBoundary(imported, oriented=False))
        if not boundaries or any(dim != 2 for dim, _ in boundaries) or len(boundaries) > 2048:
            raise EngineError(
                "invalid-cad-mesh", "Solid boundary topology exceeds inspection limits."
            )
        tags = {tag: index for index, (_, tag) in enumerate(boundaries)}
        regions = tuple(f"mesh-face-{index + 1}" for index in range(len(tags)))
        gmsh.option.setNumber("Mesh.MinimumCircleNodes", 24)
        gmsh.option.setNumber("Mesh.MeshSizeMin", 0)
        gmsh.option.setNumber("Mesh.MeshSizeMax", size)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 24)
        gmsh.option.setNumber("Mesh.ElementOrder", 1)
        gmsh.option.setNumber("Mesh.Algorithm3D", 1)
        if progress:
            progress("meshing", None)
        evaluations = 0
        budget_error: str | None = None

        def bounded_size(dim: int, tag: int, x: float, y: float, z: float, lc: float) -> float:
            nonlocal evaluations, budget_error
            evaluations += 1
            if evaluations > MAX_SIZE_EVALUATIONS or not math.isfinite(lc) or lc <= 0:
                budget_error = (
                    "CAD curvature refinement exceeds the bounded inspection budget. "
                    "Simplify small features or use a coarser target size."
                )
                # Exceptions raised in a ctypes callback are ignored by Python.
                # Zero is an invalid Gmsh size and aborts meshing; no mesh is
                # returned. Valid requests retain the original size unchanged.
                return 0.0
            return lc

        gmsh.model.mesh.setSizeCallback(bounded_size)
        for dimension in (1, 2, 3):
            try:
                gmsh.model.mesh.generate(dimension)
            except Exception as error:
                if budget_error:
                    raise EngineError("resource-limit", budget_error) from error
                raise
            if budget_error:
                raise EngineError("resource-limit", budget_error)
            node_tags, _, _ = gmsh.model.mesh.getNodes()
            if len(node_tags) > MAX_NODES:
                raise EngineError("resource-limit", "CAD mesh exceeds 12000 nodes.")
            if dimension >= 2:
                _, elements, _ = gmsh.model.mesh.getElements(dimension)
                if sum(len(tags) for tags in elements) > (
                    MAX_TRIANGLES if dimension == 2 else MAX_CELLS
                ):
                    raise EngineError(
                        "resource-limit", "CAD mesh exceeds its boundary or volume element limit."
                    )
        gmsh.model.mesh.optimize("Netgen")
        mesh = collect_solid_mesh(tags, regions, scale, low)
        mesh_volume = float(tetra_volumes(mesh.positions, mesh.cells).sum())
        if not math.isfinite(mesh_volume) or mesh_volume <= 0:
            raise EngineError(
                "invalid-cad-mesh", "The numerical domain has no positive finite volume."
            )
        if progress:
            progress("mesh-ready", 1)
        return CadMesh(mesh, volume, area, target_size)
    except EngineError:
        raise
    except Exception as error:
        raise EngineError("meshing-failed", f"Exact solid meshing failed: {error}") from error
    finally:
        gmsh.finalize()
