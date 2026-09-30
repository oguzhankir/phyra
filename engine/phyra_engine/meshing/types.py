"""SI mesh topology shared by classical and neural methods."""

from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class Mesh:
    positions: np.ndarray
    cells: np.ndarray
    surface: np.ndarray
    surface_regions: np.ndarray
    surface_cells: np.ndarray
    regions: tuple[str, ...]


@dataclass(frozen=True)
class Mesh2D:
    positions: np.ndarray
    cells: np.ndarray
    edges: np.ndarray
    edge_regions: np.ndarray
    regions: tuple[str, ...]
    thickness: float
