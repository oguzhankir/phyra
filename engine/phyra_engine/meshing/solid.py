"""Positive tetrahedral meshes with outward boundary triangles and cell ownership."""

import hashlib
from collections import defaultdict
from itertools import combinations
from typing import Any

import gmsh  # type: ignore[import-untyped]
import numpy as np
from scipy.sparse import coo_matrix  # type: ignore[import-untyped]
from scipy.sparse.csgraph import connected_components  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.execution.limits import MAX_CELLS, MAX_NODES, MAX_TRIANGLES
from phyra_engine.geometry.primitives import classify_surface, create_solid
from phyra_engine.geometry.regions import SOLID_REGIONS
from phyra_engine.meshing.types import Mesh


def mesh_id(mesh: Mesh) -> str:
    digest = hashlib.sha256()
    digest.update(np.asarray(mesh.positions, dtype="<f8").tobytes())
    digest.update(np.asarray(mesh.cells, dtype="<u4").tobytes())
    return digest.hexdigest()


def tetra_volumes(positions: np.ndarray, cells: np.ndarray) -> np.ndarray:
    points = positions[cells]
    jacobian = np.stack(
        (points[:, 1] - points[:, 0], points[:, 2] - points[:, 0], points[:, 3] - points[:, 0]),
        axis=2,
    )
    return np.linalg.det(jacobian) / 6


def quality(mesh: Mesh) -> np.ndarray:
    """Tetrahedral mean ratio 12*(3V)^(2/3)/sum(edge_length²), 1 for regular tetrahedra."""
    points = mesh.positions[mesh.cells]
    edge_sum = sum(
        np.sum((points[:, i] - points[:, j]) ** 2, axis=1) for i, j in combinations(range(4), 2)
    )
    return 12 * (3 * tetra_volumes(mesh.positions, mesh.cells)) ** (2 / 3) / edge_sum


def boundary_faces(cells: np.ndarray) -> dict[tuple[int, int, int], int]:
    owners: dict[tuple[int, int, int], list[int]] = defaultdict(list)
    for ci, cell in enumerate(cells):
        for face in combinations(cell.tolist(), 3):
            owners[tuple(sorted(face))].append(ci)
    if any(len(indices) > 2 for indices in owners.values()):
        raise EngineError("invalid-mesh", "The volume mesh has a nonmanifold face.")
    return {face: indices[0] for face, indices in owners.items() if len(indices) == 1}


def validate_mesh(mesh: Mesh) -> None:
    positions, cells, surface = mesh.positions, mesh.cells, mesh.surface
    if (
        positions.ndim != 2
        or positions.shape[1] != 3
        or len(positions) < 4
        or cells.ndim != 2
        or cells.shape[1] != 4
        or not len(cells)
        or surface.ndim != 2
        or surface.shape[1] != 3
        or not len(surface)
    ):
        raise EngineError("invalid-mesh", "Expected nonempty 3D nodes, tetrahedra and triangles.")
    if len(positions) > MAX_NODES or len(cells) > MAX_CELLS or len(surface) > MAX_TRIANGLES:
        raise EngineError("resource-limit", "Actual mesh exceeds the supported resource limit.")
    if not np.isfinite(positions).all():
        raise EngineError("invalid-mesh", "Mesh coordinates must be finite.")
    for array in (cells, surface, mesh.surface_regions, mesh.surface_cells):
        if array.dtype.kind not in "ui" or np.any(array < 0):
            raise EngineError("invalid-mesh", "Connectivity must contain nonnegative integers.")
    if cells.max() >= len(positions) or surface.max() >= len(positions):
        raise EngineError("invalid-mesh", "Mesh connectivity references an absent node.")
    if mesh.surface_regions.shape != (len(surface),) or mesh.surface_cells.shape != (len(surface),):
        raise EngineError("invalid-mesh", "Boundary associations do not match the triangles.")
    if (
        not mesh.regions
        or len(set(mesh.regions)) != len(mesh.regions)
        or mesh.surface_regions.max() >= len(mesh.regions)
        or mesh.surface_cells.max() >= len(cells)
    ):
        raise EngineError("invalid-mesh", "Boundary region or cell indices are invalid.")
    points = positions[cells]
    edge_scale = np.max(
        np.linalg.norm(points[:, :, None] - points[:, None, :], axis=3), axis=(1, 2)
    )
    volumes = tetra_volumes(positions, cells)
    if np.any(volumes <= 64 * np.finfo(float).eps * edge_scale**3):
        raise EngineError("degenerate-mesh", "Mesh contains an inverted or degenerate tetrahedron.")
    if len(np.unique(np.sort(cells, axis=1), axis=0)) != len(cells):
        raise EngineError("invalid-mesh", "Mesh contains duplicate tetrahedra.")
    edges = np.concatenate([cells[:, [i, j]] for i, j in combinations(range(4), 2)])
    graph = coo_matrix(
        (np.ones(len(edges)), (edges[:, 0], edges[:, 1])), shape=(len(positions), len(positions))
    ).tocsr()
    count, _ = connected_components(graph, directed=False)
    if count != 1:
        raise EngineError("disconnected-mesh", "Only a single connected solid is supported.")
    boundary = boundary_faces(cells)
    keys = [tuple(sorted(face.tolist())) for face in surface]
    if len(set(keys)) != len(keys) or set(keys) != set(boundary):
        raise EngineError(
            "invalid-mesh", "Surface triangles must cover the volume boundary exactly."
        )
    for ti, key in enumerate(keys):
        if boundary[key] != int(mesh.surface_cells[ti]):
            raise EngineError("invalid-mesh", "Boundary triangle has the wrong owning cell.")
    tri = positions[surface]
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    inward = positions[cells[mesh.surface_cells]].mean(axis=1) - tri.mean(axis=1)
    if np.any(np.einsum("ij,ij->i", normals, inward) >= 0):
        raise EngineError("invalid-mesh", "Boundary orientation must point out of the solid.")


def collect_solid_mesh(
    tags: dict[int, int],
    regions: tuple[str, ...],
    scale: float,
    origin: np.ndarray | None = None,
) -> Mesh:
    """Read one meshed Gmsh model into bounded, oriented SI tetrahedral topology."""
    node_tags, coordinates, _ = gmsh.model.mesh.getNodes()
    if len(node_tags) > MAX_NODES:
        raise EngineError(
            "resource-limit", "Generated mesh has too many nodes; increase mesh size."
        )
    positions = np.asarray(coordinates, dtype=np.float64).reshape(-1, 3) * scale
    if origin is not None:
        positions += origin
    lookup = {int(tag): i for i, tag in enumerate(node_tags)}
    types, _, element_nodes = gmsh.model.mesh.getElements(3)
    if len(types) != 1 or int(types[0]) != 4:
        raise EngineError("unsupported-mesh", "Expected first-order tetrahedral volume elements.")
    if len(element_nodes[0]) // 4 > MAX_CELLS:
        raise EngineError("resource-limit", "Generated mesh has too many tetrahedra.")
    cells = np.asarray([lookup[int(tag)] for tag in element_nodes[0]], dtype=np.uint32).reshape(
        -1, 4
    )
    negative = tetra_volumes(positions, cells) < 0
    cells[negative, 1], cells[negative, 2] = (
        cells[negative, 2].copy(),
        cells[negative, 1].copy(),
    )
    owners = boundary_faces(cells)
    surface: list[np.ndarray] = []
    surface_regions: list[int] = []
    surface_cells: list[int] = []
    for tag, region_index in tags.items():
        types, _, face_nodes = gmsh.model.mesh.getElements(2, tag)
        if len(types) != 1 or int(types[0]) != 2:
            raise EngineError("unsupported-mesh", "Expected first-order boundary triangles.")
        if len(surface) + len(face_nodes[0]) // 3 > MAX_TRIANGLES:
            raise EngineError("resource-limit", "Generated mesh has too many boundary triangles.")
        faces = np.asarray([lookup[int(node)] for node in face_nodes[0]], dtype=np.uint32).reshape(
            -1, 3
        )
        for face in faces:
            owner = owners.get(tuple(sorted(face.tolist())))
            if owner is None:
                raise EngineError(
                    "invalid-mesh", "A geometry triangle is missing from volume boundary."
                )
            triangle = positions[face]
            normal = np.cross(triangle[1] - triangle[0], triangle[2] - triangle[0])
            direction = positions[cells[owner]].mean(axis=0) - triangle.mean(axis=0)
            if np.dot(normal, direction) > 0:
                face[[1, 2]] = face[[2, 1]]
            surface.append(face)
            surface_regions.append(region_index)
            surface_cells.append(owner)
    mesh = Mesh(
        positions,
        cells,
        np.asarray(surface, dtype=np.uint32),
        np.asarray(surface_regions, dtype=np.uint32),
        np.asarray(surface_cells, dtype=np.uint32),
        tuple(regions),
    )
    validate_mesh(mesh)
    return mesh


def generate_solid(
    source: dict[str, Any], target_size: float, progress: Progress | None = None
) -> Mesh:
    if progress:
        progress("geometry", None)
    gmsh.initialize([], readConfigFiles=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("General.NumThreads", 1)
        gmsh.model.add("phyra")
        scale = (
            max(source["length"], 2 * source["radius"])
            if source["kind"] == "cylinder"
            else max(source[key] for key in ("length", "width", "height"))
        )
        # OCC has an absolute modelling tolerance. Build dimensionless solids,
        # then restore exact SI coordinate meaning before mechanics or transport.
        geometry = {
            key: (value / scale if isinstance(value, (int, float)) else value)
            for key, value in source.items()
        }
        volume_tag = create_solid(geometry)
        gmsh.model.occ.synchronize()
        boundaries = gmsh.model.getBoundary([(3, volume_tag)], oriented=False)
        regions = SOLID_REGIONS[geometry["kind"]]
        tags = {
            tag: regions.index(classify_surface(tag, geometry))
            for dim, tag in boundaries
            if dim == 2
        }
        if set(tags.values()) != set(range(len(regions))):
            raise EngineError("invalid-region", "Solid boundary identification is incomplete.")
        size = target_size / scale
        # A coarse target size must not reduce a circular cross section to the
        # mesher's default seven-sided polygon. Keep at least 24 circle nodes.
        gmsh.option.setNumber("Mesh.MinimumCircleNodes", 24)
        minimum = (
            min(size, 2 * np.pi * geometry["radius"] / 24)
            if geometry["kind"] == "cylinder"
            else size
        )
        gmsh.option.setNumber("Mesh.MeshSizeMin", minimum)
        gmsh.option.setNumber("Mesh.MeshSizeMax", size)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 24)
        gmsh.option.setNumber("Mesh.ElementOrder", 1)
        gmsh.option.setNumber("Mesh.Algorithm3D", 1)
        if progress:
            progress("meshing", None)
        gmsh.model.mesh.generate(3)
        gmsh.model.mesh.optimize("Netgen")
        mesh = collect_solid_mesh(tags, tuple(regions), scale)
        if progress:
            progress("mesh-ready", 1)
        return mesh
    except EngineError:
        raise
    except Exception as error:
        raise EngineError("meshing-failed", f"Solid meshing failed: {error}") from error
    finally:
        gmsh.finalize()
