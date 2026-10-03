"""Exact constant-component lifting on finite straight exterior boundary segments.

Each nonnegative vanishing function is inward supporting-line distance plus
squared tangent overhang beyond the segment ends. Thus it vanishes on the
specified finite segment only, has finite first derivatives at its endpoints,
and introduces no interior or coincident unassigned support. Constant data are
combined by harmonic-distance interpolation, grouping identical values before
interpolation to preserve compatibility at adjacent equal-valued supports.
Collinear touching segments are merged across semantic region identifiers so
splitting an authored edge cannot change the admissible displacement space.
Curved or interior-crossing essential boundaries need a different construction.
"""

from dataclasses import dataclass
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.meshing.types import Mesh2D
from phyra_engine.methods.physicsml.normalization import Normalization
from phyra_engine.methods.physicsml.sampling import edge_components
from phyra_engine.physics.elasticity.plane_stress import constraint_dofs


@dataclass(frozen=True, slots=True)
class LiftingGroup:
    value: float
    # nx, ny, inward offset, tx, ty, tangent lower, tangent upper, factor scale
    segments: np.ndarray


@dataclass(frozen=True, slots=True)
class ComponentLifting:
    groups: tuple[LiftingGroup, ...]


def _merge_collinear_segments(
    segments: list[np.ndarray], positions: np.ndarray, tolerance: float
) -> np.ndarray:
    """Canonicalize the physical union, preserving every unassigned gap."""
    lines: list[tuple[np.ndarray, list[tuple[float, float]]]] = []
    for segment in segments:
        for line, intervals in lines:
            if np.max(np.abs(line[:5] - segment[:5])) <= tolerance:
                intervals.append((float(segment[5]), float(segment[6])))
                break
        else:
            lines.append((segment, [(float(segment[5]), float(segment[6]))]))
    result = []
    for line, intervals in lines:
        merged: list[list[float]] = []
        for low, high in sorted(intervals):
            if merged and low <= merged[-1][1] + tolerance:
                merged[-1][1] = max(high, merged[-1][1])
            else:
                merged.append([low, high])
        distances = positions @ line[:2] + line[2]
        tangent = positions @ line[3:5]
        for low, high in merged:
            vanishing = (
                distances + np.maximum(low - tangent, 0) ** 2 + np.maximum(tangent - high, 0) ** 2
            )
            result.append(np.r_[line[:5], low, high, vanishing.max()])
    return np.asarray(result, dtype=np.float64).reshape(-1, 8)


def profile_lifting(
    mesh: Mesh2D, study: dict[str, Any], scales: Normalization
) -> tuple[ComponentLifting, ComponentLifting]:
    constraint_dofs(mesh, study["constraints"])
    positions = (mesh.positions[:, :2] - scales.origin) / scales.length
    components = edge_components(mesh, study)
    result = []
    tolerance = 1e-10
    for component in range(2):
        grouped: dict[float, list[np.ndarray]] = {}
        for region, data in components.items():
            prescribed = data[component]
            if prescribed is None:
                continue
            edges = mesh.edges[mesh.edge_regions == mesh.regions.index(region)]
            a, b = positions[edges[0]]
            direction = (b - a) / np.linalg.norm(b - a)
            normal = np.array([-direction[1], direction[0]])
            offset = float(a @ normal)
            distances = positions @ normal - offset
            if np.max(np.abs(distances[np.unique(edges)])) > tolerance:
                raise EngineError(
                    "unsupported-essential-boundary",
                    "Energy PINN supports must lie on "
                    "straight exterior segments; curved supports are not implemented.",
                )
            if distances.max() <= tolerance:
                normal, offset, distances = -normal, -offset, -distances
            if distances.min() < -tolerance or distances.max() <= tolerance:
                raise EngineError(
                    "unsupported-essential-boundary",
                    "A support's straight line must stay "
                    "outside the entire domain, without crossing its interior.",
                )
            # The inward normal fixes a canonical tangent orientation. Mesh
            # edge winding and semantic boundary splitting must not alter it.
            direction = np.array([normal[1], -normal[0]])
            tangent = positions @ direction
            intervals = sorted(tuple(sorted(tangent[edge])) for edge in edges)
            merged: list[list[float]] = []
            for low, high in intervals:
                if merged and low <= merged[-1][1] + tolerance:
                    merged[-1][1] = max(high, merged[-1][1])
                else:
                    merged.append([low, high])
            segments = grouped.setdefault(float(prescribed) / scales.displacement, [])
            for low, high in merged:
                vanishing = (
                    distances
                    + np.maximum(low - tangent, 0) ** 2
                    + np.maximum(tangent - high, 0) ** 2
                )
                segments.append(np.r_[normal, -offset, direction, low, high, vanishing.max()])
        result.append(
            ComponentLifting(
                tuple(
                    LiftingGroup(value, _merge_collinear_segments(segments, positions, tolerance))
                    for value, segments in grouped.items()
                )
            )
        )
    return result[0], result[1]
