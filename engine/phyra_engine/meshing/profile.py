"""OpenCASCADE exact-profile triangulation with Phyra-owned boundary identities."""

from collections import defaultdict
from typing import Any

import gmsh  # type: ignore[import-untyped]
import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.execution.limits import MAX_CELLS, MAX_NODES
from phyra_engine.geometry.profile import (
    arc_data,
    normalized_profile,
    profile_area,
    validate_profile,
)
from phyra_engine.meshing.plane_stress import cell_areas, quality, validate_mesh
from phyra_engine.meshing.types import Mesh2D


def validate_mesh_request(profile: dict[str, Any], size: float, boundary_size: float) -> None:
    validate_profile(profile)
    normalized, _, scale = normalized_profile(profile)
    sizes = np.asarray([size, boundary_size], dtype=float) / scale
    if not np.isfinite(sizes).all() or np.any(sizes <= 0):
        raise EngineError("invalid-mesh", "Mesh sizes must be positive finite SI lengths.")
    perimeter = sum(
        np.linalg.norm(np.asarray(s["end"]) - s["start"])
        if s["kind"] == "line"
        else arc_data(s)[1] * abs(arc_data(s)[3])
        for s in normalized["outer"]
    )
    perimeter += sum(2 * np.pi * h["radius"] for h in normalized["holes"])
    # Conservative preflight bounds precede Gmsh allocation; actual bounds are
    # checked again before transport. Curvature has at least 32 circle intervals.
    effective = min(sizes)
    if (
        effective < 1 / MAX_NODES
        or 4 * profile_area(normalized) / effective**2 > MAX_CELLS
        or 2 * perimeter / effective > MAX_NODES
    ):
        raise EngineError(
            "resource-limit", "Profile mesh is too fine; increase bulk or boundary size."
        )


def generate_profile(
    profile: dict[str, Any],
    thickness: float,
    size: float,
    boundary_size: float | None = None,
    progress: Progress | None = None,
) -> Mesh2D:
    boundary_size = size if boundary_size is None else boundary_size
    validate_mesh_request(profile, size, boundary_size)
    if type(thickness) not in (int, float) or not np.isfinite(thickness) or thickness <= 0:
        raise EngineError("invalid-thickness", "Plate thickness must be positive and finite.")
    normalized, origin, scale = normalized_profile(profile)
    regions = tuple(item["id"] for item in profile["outer"] + profile["holes"])
    gmsh.initialize([], readConfigFiles=False)
    try:
        gmsh.option.setNumber("General.Terminal", 0)
        gmsh.option.setNumber("General.NumThreads", 1)
        gmsh.model.add("phyra-profile")
        point_tags: dict[tuple[float, float], int] = {}

        def point(coordinates: list[float]) -> int:
            key = (coordinates[0], coordinates[1])
            if key not in point_tags:
                point_tags[key] = gmsh.model.occ.addPoint(*coordinates, 0)
            return point_tags[key]

        curves, tags = [], {}
        for index, segment in enumerate(normalized["outer"]):
            first, last = point(segment["start"]), point(segment["end"])
            if segment["kind"] == "line":
                tag = gmsh.model.occ.addLine(first, last)
                curves.append(tag)
            else:
                center, radius, start, sweep = arc_data(segment)
                midpoint = center + radius * np.array(
                    [np.cos(start + sweep / 2), np.sin(start + sweep / 2)]
                )
                # The on-curve midpoint resolves a semicircle's otherwise
                # ambiguous choice of plane/direction in OCC's center form.
                tag = gmsh.model.occ.addCircleArc(
                    first, point(midpoint.tolist()), last, center=False
                )
                curves.append(tag)
            tags[tag] = index
        loops = [gmsh.model.occ.addCurveLoop(curves)]
        for index, hole in enumerate(normalized["holes"], len(curves)):
            tag = gmsh.model.occ.addCircle(*hole["center"], 0, hole["radius"])
            tags[tag] = index
            loops.append(gmsh.model.occ.addCurveLoop([tag]))
        surface = gmsh.model.occ.addPlaneSurface(loops)
        gmsh.model.occ.synchronize()
        actual = {
            tag for dim, tag in gmsh.model.getBoundary([(2, surface)], oriented=False) if dim == 1
        }
        if actual != set(tags):
            raise EngineError(
                "invalid-region",
                "Exact profile boundary ownership was changed by meshing preparation.",
            )
        gmsh.option.setNumber("Mesh.ElementOrder", 1)
        gmsh.option.setNumber("Mesh.Algorithm", 6)
        gmsh.option.setNumber("Mesh.MeshSizeMin", min(size, boundary_size) / scale)
        gmsh.option.setNumber("Mesh.MeshSizeMax", size / scale)
        gmsh.option.setNumber("Mesh.MinimumCircleNodes", 32)
        gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 32)
        # A distance/threshold field refines curved boundaries without converting
        # the exact OCC curves to hand-built polygons.
        curved = [
            tag
            for tag, index in tags.items()
            if index >= len(curves) or normalized["outer"][index]["kind"] == "arc"
        ]
        if curved and boundary_size < size:
            distance = gmsh.model.mesh.field.add("Distance")
            gmsh.model.mesh.field.setNumbers(distance, "CurvesList", curved)
            gmsh.model.mesh.field.setNumber(distance, "Sampling", 100)
            threshold = gmsh.model.mesh.field.add("Threshold")
            for key, value in {
                "InField": distance,
                "SizeMin": boundary_size / scale,
                "SizeMax": size / scale,
                "DistMin": boundary_size / scale,
                "DistMax": 3 * size / scale,
            }.items():
                gmsh.model.mesh.field.setNumber(threshold, key, value)
            gmsh.model.mesh.field.setAsBackgroundMesh(threshold)
        if progress:
            progress("meshing-exact-profile", None)
        gmsh.model.mesh.generate(2)
        node_tags, coordinates, _ = gmsh.model.mesh.getNodes()
        if len(node_tags) > MAX_NODES:
            raise EngineError(
                "resource-limit", "Generated profile has too many nodes; increase size."
            )
        # OCC center points are geometry construction entities and not domain DOFs.
        types, _, element_nodes = gmsh.model.mesh.getElements(2, surface)
        if len(types) != 1 or int(types[0]) != 2:
            raise EngineError(
                "unsupported-mesh", "Expected first-order triangular profile elements."
            )
        domain_tags = np.unique(element_nodes[0])
        lookup = {int(tag): i for i, tag in enumerate(domain_tags)}
        source_lookup = {int(tag): i for i, tag in enumerate(node_tags)}
        coordinates = np.asarray(coordinates).reshape(-1, 3)
        positions = coordinates[[source_lookup[int(tag)] for tag in domain_tags]] * scale
        positions[:, :2] += origin
        positions[:, 2] = 0
        cells = np.asarray([lookup[int(tag)] for tag in element_nodes[0]], dtype=np.uint32).reshape(
            -1, 3
        )
        if len(cells) > MAX_CELLS:
            raise EngineError(
                "resource-limit", "Generated profile has too many cells; increase size."
            )
        p = positions[cells, :2]
        signed = (p[:, 1, 0] - p[:, 0, 0]) * (p[:, 2, 1] - p[:, 0, 1]) - (
            p[:, 1, 1] - p[:, 0, 1]
        ) * (p[:, 2, 0] - p[:, 0, 0])
        negative = signed < 0
        cells[negative, 1], cells[negative, 2] = (
            cells[negative, 2].copy(),
            cells[negative, 1].copy(),
        )
        owners: dict[tuple[int, int], list[int]] = defaultdict(list)
        for index, cell in enumerate(cells):
            for a, b in ((0, 1), (1, 2), (2, 0)):
                owners[(min(int(cell[a]), int(cell[b])), max(int(cell[a]), int(cell[b])))].append(
                    index
                )
        edges, associations = [], []
        for tag, region in tags.items():
            types, _, edge_nodes = gmsh.model.mesh.getElements(1, tag)
            if len(types) != 1 or int(types[0]) != 1:
                raise EngineError("unsupported-mesh", "Expected first-order boundary edges.")
            for first, last in np.asarray(edge_nodes[0]).reshape(-1, 2):
                edge = np.array([lookup[int(first)], lookup[int(last)]], dtype=np.uint32)
                cell_owners = owners.get(tuple(sorted(edge.tolist())), [])
                if len(cell_owners) != 1:
                    raise EngineError(
                        "invalid-mesh", "A profile boundary edge has no unique solid owner."
                    )
                p = positions[edge, :2]
                normal = np.array([p[1, 1] - p[0, 1], p[0, 0] - p[1, 0]])
                if (
                    normal @ (positions[cells[cell_owners[0]], :2].mean(axis=0) - p.mean(axis=0))
                    > 0
                ):
                    edge = edge[::-1]
                edges.append(edge)
                associations.append(region)
        mesh = Mesh2D(
            positions,
            cells,
            np.asarray(edges, dtype=np.uint32),
            np.asarray(associations, dtype=np.uint32),
            regions,
            float(thickness),
        )
        validate_mesh(mesh)
        if float(quality(mesh).min()) < 1e-4:
            raise EngineError(
                "poor-mesh-quality",
                "Profile contains a nearly collapsed triangle; adjust geometry or mesh size.",
            )
        if progress:
            progress("mesh-ready", 1)
        return mesh
    except EngineError:
        raise
    except Exception as error:
        raise EngineError("meshing-failed", f"Exact profile meshing failed: {error}") from error
    finally:
        gmsh.finalize()


def validate_profile_mesh(mesh: Mesh2D, profile: dict[str, Any]) -> None:
    """Validate cached curve ownership and curve coverage independently of Gmsh IDs."""
    from phyra_engine.geometry.profile import _on_arc, _point, segment_distance

    validate_profile(profile)
    if float(quality(mesh).min()) < 1e-4:
        raise EngineError(
            "poor-mesh-quality", "Cached profile contains a nearly collapsed triangle."
        )
    normalized, origin, scale = normalized_profile(profile)
    coordinates = (mesh.positions[:, :2] - origin) / scale
    if mesh.regions != tuple(item["id"] for item in profile["outer"] + profile["holes"]):
        raise EngineError(
            "invalid-cache", "Profile boundary identities do not match the definition."
        )
    # Polygonal first-order circles alter area by O(h²). Compute exact correction
    # from each oriented chord and validate the true curved profile area instead.
    area_correction = 0.0
    for index, item in enumerate(normalized["outer"] + normalized["holes"]):
        selected = mesh.edges[mesh.edge_regions == index]
        if not len(selected):
            raise EngineError("invalid-cache", "A named profile boundary has no mesh edges.")
        points = coordinates[selected]
        if index < len(normalized["outer"]) and item["kind"] == "line":
            if any(segment_distance(p, item) > 1e-9 for p in points.reshape(-1, 2)):
                raise EngineError("invalid-cache", "A profile line boundary has misplaced nodes.")
            length = np.linalg.norm(points[:, 1] - points[:, 0], axis=1).sum()
            if not np.isclose(
                length, np.linalg.norm(_point(item["end"]) - _point(item["start"])), rtol=1e-9
            ):
                raise EngineError(
                    "invalid-cache", "Profile boundary does not cover the complete line."
                )
            continue
        if index < len(normalized["outer"]):
            center, radius, _, sweep = arc_data(item)
            if any(not _on_arc(p, item) for p in points.reshape(-1, 2)):
                raise EngineError(
                    "invalid-cache", "Profile arc nodes lie outside the declared arc."
                )
            expected_sweep = abs(sweep)
        else:
            center, radius, expected_sweep = _point(item["center"]), item["radius"], 2 * np.pi
        radial = points - center
        if not np.allclose(np.linalg.norm(radial, axis=2), radius, rtol=1e-9, atol=0):
            raise EngineError(
                "invalid-cache", "Circular profile boundary nodes are not on the exact circle."
            )
        cross = radial[:, 0, 0] * radial[:, 1, 1] - radial[:, 0, 1] * radial[:, 1, 0]
        dot = np.sum(radial[:, 0] * radial[:, 1], axis=1)
        angles = np.arctan2(cross, dot)
        if not np.isclose(np.abs(angles).sum(), expected_sweep, rtol=1e-9, atol=0):
            raise EngineError(
                "invalid-cache", "Profile circular edges do not cover the complete curve."
            )
        area_correction += 0.5 * radius**2 * np.sum(angles - np.sin(angles))
    actual_area = cell_areas(mesh).sum() / scale**2 + area_correction
    if not np.isclose(actual_area, profile_area(normalized), rtol=1e-9, atol=0):
        raise EngineError(
            "invalid-cache", "Profile mesh filled area differs from the exact definition."
        )
