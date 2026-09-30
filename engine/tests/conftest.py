"""Independent structured fixtures, separate from the product's Gmsh path."""

import sys
from collections import defaultdict
from itertools import combinations
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from phyra_engine.meshing.types import Mesh


def brick_mesh(lengths=(1.0, 1.0, 1.0), divisions=(2, 2, 2)):
    """Six conforming tetrahedra per voxel; derive boundary faces independently."""
    nx, ny, nz = divisions
    coordinates = [
        np.linspace(0, size, count + 1) for size, count in zip(lengths, divisions, strict=True)
    ]
    positions = np.array(
        [[x, y, z] for x in coordinates[0] for y in coordinates[1] for z in coordinates[2]],
        dtype=np.float64,
    )

    def index(i, j, k):
        return (i * (ny + 1) + j) * (nz + 1) + k

    # All cubes use the same body diagonal, so triangles match across interfaces.
    pattern = ((0, 4, 6, 7), (0, 6, 2, 7), (0, 2, 3, 7), (0, 3, 1, 7), (0, 1, 5, 7), (0, 5, 4, 7))
    cells = []
    for i in range(nx):
        for j in range(ny):
            for k in range(nz):
                corners = [
                    index(i + a, j + b, k + c) for a in (0, 1) for b in (0, 1) for c in (0, 1)
                ]
                for local in pattern:
                    cell = [corners[q] for q in local]
                    p = positions[cell]
                    if np.linalg.det(np.array([p[1] - p[0], p[2] - p[0], p[3] - p[0]])) < 0:
                        cell[1], cell[2] = cell[2], cell[1]
                    cells.append(cell)
    cells = np.array(cells, dtype=np.uint32)
    occurrences = defaultdict(list)
    for cell_index, cell in enumerate(cells):
        for face in combinations(cell.tolist(), 3):
            occurrences[tuple(sorted(face))].append(cell_index)
    regions = ("x0", "x1", "y0", "y1", "z0", "z1")
    surface, surface_regions, surface_cells = [], [], []
    for face_key, owners in occurrences.items():
        if len(owners) != 1:
            continue
        owner = owners[0]
        face = list(face_key)
        p = positions[face]
        normal = np.cross(p[1] - p[0], p[2] - p[0])
        if normal @ (positions[cells[owner]].mean(axis=0) - p.mean(axis=0)) > 0:
            face[1], face[2] = face[2], face[1]
        region = next(
            2 * axis + side
            for axis in range(3)
            for side in range(2)
            if np.allclose(p[:, axis], side * lengths[axis], atol=1e-14, rtol=0)
        )
        surface.append(face)
        surface_regions.append(region)
        surface_cells.append(owner)
    return Mesh(
        positions,
        cells,
        np.array(surface, dtype=np.uint32),
        np.array(surface_regions, dtype=np.uint32),
        np.array(surface_cells, dtype=np.uint32),
        regions,
    )


@pytest.fixture
def cube():
    return brick_mesh()


@pytest.fixture
def project():
    return {
        "schemaVersion": 1,
        "id": "test-project",
        "name": "Verification",
        "revision": 0,
        "displayUnits": "mm",
        "geometry": {
            "kind": "box",
            "length": 0.1,
            "width": 0.02,
            "height": 0.02,
            "radius": 0.01,
            "thickness": 0.005,
        },
        "study": {
            "id": "test-study",
            "type": "linear-static",
            "material": {"name": "Verification material", "young": 210e9, "poisson": 0.3},
            "mesh": {"size": 0.012},
            "constraints": [
                {"id": "fixed", "name": "Fixed end", "regions": ["x0"], "components": [0, 0, 0]}
            ],
            "loads": [
                {
                    "id": "end",
                    "name": "End force",
                    "regions": ["x1"],
                    "kind": "force",
                    "vector": [0, 0, -1],
                    "pressure": 0,
                }
            ],
        },
    }
