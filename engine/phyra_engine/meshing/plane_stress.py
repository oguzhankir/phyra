"""Validated counterclockwise triangular rectangles and physical boundary edges."""

import hashlib
import math
from collections import defaultdict

import numpy as np
from scipy.sparse import coo_matrix  # type: ignore[import-untyped]
from scipy.sparse.csgraph import connected_components  # type: ignore[import-untyped]

from phyra_engine.errors import EngineError
from phyra_engine.execution.limits import MAX_CELLS, MAX_NODES
from phyra_engine.geometry.regions import PLANAR_REGIONS
from phyra_engine.meshing.types import Mesh2D


def mesh_id(mesh: Mesh2D) -> str:
    digest = hashlib.sha256()
    digest.update(np.asarray(mesh.positions, dtype="<f8").tobytes())
    digest.update(np.asarray(mesh.cells, dtype="<u4").tobytes())
    return digest.hexdigest()


def cell_areas(mesh: Mesh2D) -> np.ndarray:
    p = mesh.positions[mesh.cells, :2]
    a, b = p[:, 1] - p[:, 0], p[:, 2] - p[:, 0]
    return (a[:, 0] * b[:, 1] - a[:, 1] * b[:, 0]) / 2


def quality(mesh: Mesh2D) -> np.ndarray:
    p = mesh.positions[mesh.cells, :2]
    edge_sum = sum(np.sum((p[:, i] - p[:, j]) ** 2, axis=1) for i, j in ((0, 1), (1, 2), (2, 0)))
    return 4 * np.sqrt(3) * cell_areas(mesh) / edge_sum


def edge_geometry(mesh: Mesh2D) -> tuple[np.ndarray, np.ndarray]:
    direction = mesh.positions[mesh.edges[:, 1], :2] - mesh.positions[mesh.edges[:, 0], :2]
    lengths = np.linalg.norm(direction, axis=1)
    normals = np.column_stack((direction[:, 1], -direction[:, 0])) / lengths[:, None]
    return lengths, normals


def validate_mesh(mesh: Mesh2D) -> None:
    if (
        mesh.positions.ndim != 2
        or mesh.positions.shape[1] != 3
        or len(mesh.positions) < 3
        or mesh.cells.ndim != 2
        or mesh.cells.shape[1] != 3
        or not len(mesh.cells)
        or mesh.edges.ndim != 2
        or mesh.edges.shape[1] != 2
        or not len(mesh.edges)
    ):
        raise EngineError(
            "invalid-mesh", "Expected 2D nodes, triangles and oriented boundary edges."
        )
    if (
        len(mesh.positions) > MAX_NODES
        or len(mesh.cells) > MAX_CELLS
        or len(mesh.edges) > 2 * MAX_NODES
    ):
        raise EngineError("resource-limit", "The 2D mesh exceeds supported resource limits.")
    if not np.isfinite(mesh.positions).all() or np.any(mesh.positions[:, 2] != 0):
        raise EngineError(
            "invalid-mesh", "Plane-stress coordinates must be finite and lie in z = 0."
        )
    if not np.isfinite(mesh.thickness) or mesh.thickness <= 0:
        raise EngineError(
            "invalid-thickness", "Physical plate thickness must be finite and positive."
        )
    for connectivity in (mesh.cells, mesh.edges, mesh.edge_regions):
        if connectivity.dtype.kind not in "ui" or np.any(connectivity < 0):
            raise EngineError("invalid-mesh", "Connectivity must contain nonnegative integers.")
    if mesh.cells.max() >= len(mesh.positions) or mesh.edges.max() >= len(mesh.positions):
        raise EngineError("invalid-mesh", "Connectivity refers to an absent node.")
    if (
        mesh.edge_regions.shape != (len(mesh.edges),)
        or not mesh.regions
        or len(set(mesh.regions)) != len(mesh.regions)
        or mesh.edge_regions.max() >= len(mesh.regions)
    ):
        raise EngineError("invalid-mesh", "Boundary region indices are invalid.")
    points = mesh.positions[mesh.cells, :2]
    scale2 = np.max(np.sum((points[:, :, None] - points[:, None, :]) ** 2, axis=3), axis=(1, 2))
    if np.any(cell_areas(mesh) <= 64 * np.finfo(float).eps * scale2):
        raise EngineError("degenerate-mesh", "Mesh contains an inverted or degenerate triangle.")
    if len(np.unique(np.sort(mesh.cells, axis=1), axis=0)) != len(mesh.cells):
        raise EngineError("invalid-mesh", "The 2D mesh contains duplicate triangles.")
    owners: dict[tuple[int, int], list[int]] = defaultdict(list)
    for ci, cell in enumerate(mesh.cells):
        for i, j in ((0, 1), (1, 2), (2, 0)):
            a, b = sorted((int(cell[i]), int(cell[j])))
            owners[(a, b)].append(ci)
    if any(len(value) > 2 for value in owners.values()):
        raise EngineError("invalid-mesh", "The triangle mesh has a nonmanifold edge.")
    boundary = {edge: value[0] for edge, value in owners.items() if len(value) == 1}
    keys = [(int(min(edge)), int(max(edge))) for edge in mesh.edges]
    if len(set(keys)) != len(keys) or set(keys) != set(boundary):
        raise EngineError("invalid-mesh", "Boundary edges must cover the domain boundary exactly.")
    for edge, key in zip(mesh.edges, keys, strict=True):
        p = mesh.positions[edge, :2]
        normal = np.array([p[1, 1] - p[0, 1], p[0, 0] - p[1, 0]])
        inward = mesh.positions[mesh.cells[int(boundary[key])]][:, :2].mean(axis=0) - p.mean(axis=0)
        if np.dot(normal, inward) >= 0:
            raise EngineError(
                "invalid-mesh", "Boundary edges must point counterclockwise around the solid."
            )
    connections = np.concatenate(
        [mesh.cells[:, [0, 1]], mesh.cells[:, [1, 2]], mesh.cells[:, [2, 0]]]
    )
    graph = coo_matrix(
        (np.ones(len(connections)), (connections[:, 0], connections[:, 1])),
        shape=(len(mesh.positions), len(mesh.positions)),
    ).tocsr()
    if connected_components(graph, directed=False)[0] != 1:
        raise EngineError("disconnected-mesh", "Only a single connected 2D domain is supported.")


def generate_rectangle(length: float, width: float, thickness: float, size: float) -> Mesh2D:
    dimensions = np.asarray([length, width, thickness, size], dtype=np.float64)
    if not np.isfinite(dimensions).all() or np.any(dimensions <= 0):
        raise EngineError(
            "invalid-geometry",
            "Rectangle dimensions, thickness and mesh size must be positive and finite.",
        )
    if min(length, width) / max(length, width) < 1e-6:
        raise EngineError(
            "unsupported-geometry", "Rectangle aspect ratio exceeds the supported limit."
        )
    # Test ratios before ceil so even subnormal untrusted mesh sizes cannot
    # overflow an integer conversion or allocate a huge structured grid.
    if size < min(length, width) / MAX_NODES:
        raise EngineError("resource-limit", "Increase the 2D element size.")
    nx, ny = max(1, math.ceil(length / size)), max(1, math.ceil(width / size))
    if (nx + 1) * (ny + 1) > MAX_NODES or 2 * nx * ny > MAX_CELLS:
        raise EngineError("resource-limit", "The requested 2D mesh is too fine.")
    xs, ys = np.linspace(0, length, nx + 1), np.linspace(0, width, ny + 1)
    positions = np.array([[x, y, 0] for x in xs for y in ys], dtype=np.float64)

    def node(i: int, j: int) -> int:
        return i * (ny + 1) + j

    cells: list[tuple[int, int, int]] = []
    for i in range(nx):
        for j in range(ny):
            a, b, c, d = node(i, j), node(i + 1, j), node(i + 1, j + 1), node(i, j + 1)
            cells.extend(((a, b, c), (a, c, d)))
    edges = (
        [(node(0, j + 1), node(0, j)) for j in range(ny)]
        + [(node(nx, j), node(nx, j + 1)) for j in range(ny)]
        + [(node(i, 0), node(i + 1, 0)) for i in range(nx)]
        + [(node(i + 1, ny), node(i, ny)) for i in range(nx)]
    )
    edge_regions = [0] * ny + [1] * ny + [2] * nx + [3] * nx
    mesh = Mesh2D(
        positions,
        np.asarray(cells, dtype=np.uint32),
        np.asarray(edges, dtype=np.uint32),
        np.asarray(edge_regions, dtype=np.uint32),
        PLANAR_REGIONS,
        float(thickness),
    )
    validate_mesh(mesh)
    return mesh
