"""Bounded exact planar profiles: one line/minor-arc loop and circular holes.

All intersection and containment checks use analytic curves, not display polygons.
OpenCASCADE's modelling tolerance is handled by normalized coordinates at meshing.
"""

import math
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError

TAU = 2 * math.pi
TOL = 1e-10


def _point(value: Any) -> np.ndarray:
    if (
        not isinstance(value, (list, tuple))
        or len(value) != 2
        or any(type(v) not in (int, float) or not math.isfinite(v) or abs(v) > 1000 for v in value)
    ):
        raise EngineError(
            "invalid-geometry", "Profile coordinates must be two finite SI numbers within ±1000 m."
        )
    return np.asarray(value, dtype=np.float64)


def arc_data(segment: dict[str, Any]) -> tuple[np.ndarray, float, float, float]:
    center = _point(segment.get("center"))
    a, b = _point(segment["start"]) - center, _point(segment["end"]) - center
    radius = float(np.linalg.norm(a))
    start, end = math.atan2(a[1], a[0]), math.atan2(b[1], b[0])
    sweep = -((start - end) % TAU) if segment.get("clockwise", False) else (end - start) % TAU
    return center, radius, start, sweep


def _on_arc(point: np.ndarray, segment: dict[str, Any], tolerance: float = TOL) -> bool:
    center, radius, start, sweep = arc_data(segment)
    delta = math.atan2(point[1] - center[1], point[0] - center[0]) - start
    distance = (-delta) % TAU if sweep < 0 else delta % TAU
    return distance <= abs(sweep) + tolerance or abs(distance - TAU) <= tolerance


def segment_distance(point: np.ndarray, segment: dict[str, Any]) -> float:
    a, b = _point(segment["start"]), _point(segment["end"])
    if segment["kind"] == "line":
        d = b - a
        t = float(np.clip(np.dot(point - a, d) / np.dot(d, d), 0, 1))
        return float(np.linalg.norm(point - (a + t * d)))
    center, radius, _, _ = arc_data(segment)
    if np.linalg.norm(point - center) > 0 and _on_arc(point, segment):
        return abs(float(np.linalg.norm(point - center)) - radius)
    return min(float(np.linalg.norm(point - a)), float(np.linalg.norm(point - b)))


def _cross(a: np.ndarray, b: np.ndarray) -> float:
    return float(a[0] * b[1] - a[1] * b[0])


def _intersections(first: dict[str, Any], second: dict[str, Any]) -> list[np.ndarray]:
    a, b = _point(first["start"]), _point(first["end"])
    c, d = _point(second["start"]), _point(second["end"])
    if first["kind"] == second["kind"] == "line":
        u, v = b - a, d - c
        denominator = _cross(u, v)
        if abs(denominator) <= TOL * np.linalg.norm(u) * np.linalg.norm(v):
            if abs(_cross(c - a, u)) > TOL * np.linalg.norm(u):
                return []
            # Collinear overlap: retain overlapping endpoints; an interval overlap
            # adds its midpoint so it cannot be mistaken for one shared vertex.
            ts = sorted(
                (float(np.dot(c - a, u) / np.dot(u, u)), float(np.dot(d - a, u) / np.dot(u, u)))
            )
            lo, hi = max(0.0, ts[0]), min(1.0, ts[1])
            if hi < lo - TOL:
                return []
            return [a + lo * u] if hi - lo <= TOL else [a + lo * u, a + hi * u]
        t, s = _cross(c - a, v) / denominator, _cross(c - a, u) / denominator
        return [a + t * u] if -TOL <= t <= 1 + TOL and -TOL <= s <= 1 + TOL else []
    if first["kind"] == "arc" and second["kind"] == "line":
        return _intersections(second, first)
    if first["kind"] == "line":
        center, radius, _, _ = arc_data(second)
        u, q = b - a, a - center
        aa, bb, cc = float(u @ u), float(2 * q @ u), float(q @ q - radius**2)
        discriminant = bb**2 - 4 * aa * cc
        if discriminant < -TOL * aa:
            return []
        roots = [(-bb + sign * math.sqrt(max(0.0, discriminant))) / (2 * aa) for sign in (-1, 1)]
        return [a + t * u for t in roots if -TOL <= t <= 1 + TOL and _on_arc(a + t * u, second)]
    c1, r1, _, _ = arc_data(first)
    c2, r2, _, _ = arc_data(second)
    vector, distance = c2 - c1, float(np.linalg.norm(c2 - c1))
    if distance <= TOL and abs(r1 - r2) <= TOL:
        candidates = [a, b, c, d]
        # Detect interior overlap even when all endpoints coincide or are adjacent.
        center, radius, start, sweep = arc_data(first)
        candidates.append(
            center + radius * np.array([math.cos(start + sweep / 2), math.sin(start + sweep / 2)])
        )
        return [p for p in candidates if _on_arc(p, first) and _on_arc(p, second)]
    if distance <= TOL or distance > r1 + r2 + TOL or distance < abs(r1 - r2) - TOL:
        return []
    along = (r1**2 - r2**2 + distance**2) / (2 * distance)
    perpendicular = math.sqrt(max(0.0, r1**2 - along**2))
    direction = vector / distance
    base = c1 + along * direction
    offset = perpendicular * np.array([-direction[1], direction[0]])
    return [p for p in (base - offset, base + offset) if _on_arc(p, first) and _on_arc(p, second)]


def _signed_outer_area(profile: dict[str, Any]) -> float:
    integral = 0.0
    for segment in profile["outer"]:
        a, b = _point(segment["start"]), _point(segment["end"])
        if segment["kind"] == "line":
            integral += _cross(a, b)
        else:
            center, radius, start, sweep = arc_data(segment)
            end = start + sweep
            integral += (
                radius**2 * sweep
                + center[0] * radius * (math.sin(end) - math.sin(start))
                + center[1] * radius * (math.cos(start) - math.cos(end))
            )
    return integral / 2


def profile_area(profile: dict[str, Any]) -> float:
    return _signed_outer_area(profile) - sum(
        math.pi * hole["radius"] ** 2 for hole in profile["holes"]
    )


def profile_bounds(profile: dict[str, Any]) -> tuple[np.ndarray, np.ndarray]:
    points: list[np.ndarray] = []
    for segment in profile["outer"]:
        points.extend((_point(segment["start"]), _point(segment["end"])))
        if segment["kind"] == "arc":
            center, radius, _, _ = arc_data(segment)
            for angle in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
                point = center + radius * np.array([math.cos(angle), math.sin(angle)])
                if _on_arc(point, segment):
                    points.append(point)
    return np.min(points, axis=0), np.max(points, axis=0)


def _inside(point: np.ndarray, outer: list[dict[str, Any]]) -> bool:
    """Exact even/odd ray crossings; split arcs into y-monotone analytic pieces."""
    crossings = 0
    for segment in outer:
        a, b = _point(segment["start"]), _point(segment["end"])
        if segment["kind"] == "line":
            if (a[1] > point[1]) != (b[1] > point[1]):
                x = a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])
                crossings += int(x > point[0])
            continue
        center, radius, start, sweep = arc_data(segment)
        fractions = [0.0, 1.0]
        for critical in (math.pi / 2, 3 * math.pi / 2):
            delta = ((start - critical) % TAU) if sweep < 0 else ((critical - start) % TAU)
            if TOL < delta < abs(sweep) - TOL:
                fractions.append(delta / abs(sweep))
        for low, high in zip(sorted(fractions)[:-1], sorted(fractions)[1:], strict=True):
            t0, t1 = start + sweep * low, start + sweep * high
            y0, y1 = center[1] + radius * math.sin(t0), center[1] + radius * math.sin(t1)
            if (y0 > point[1]) == (y1 > point[1]):
                continue
            sy = (point[1] - center[1]) / radius
            dx = radius * math.sqrt(max(0.0, 1 - sy**2))
            midpoint = (t0 + t1) / 2
            x = center[0] + (dx if math.cos(midpoint) >= 0 else -dx)
            crossings += int(x > point[0])
    return crossings % 2 == 1


def normalized_profile(profile: dict[str, Any]) -> tuple[dict[str, Any], np.ndarray, float]:
    low, high = profile_bounds(profile)
    scale = float(np.max(high - low))
    normalized: dict[str, Any] = {"outer": [], "holes": []}
    for segment in profile["outer"]:
        item = dict(segment)
        for key in ("start", "end", "center"):
            if key in item:
                item[key] = ((_point(item[key]) - low) / scale).tolist()
        normalized["outer"].append(item)
    for hole in profile["holes"]:
        normalized["holes"].append(
            {
                **hole,
                "center": ((_point(hole["center"]) - low) / scale).tolist(),
                "radius": hole["radius"] / scale,
            }
        )
    return normalized, low, scale


def validate_profile(profile: Any) -> None:
    if (
        not isinstance(profile, dict)
        or set(profile) != {"outer", "holes"}
        or not isinstance(profile["outer"], list)
        or not 2 <= len(profile["outer"]) <= 64
        or not isinstance(profile["holes"], list)
        or len(profile["holes"]) > 16
    ):
        raise EngineError(
            "invalid-geometry",
            "Use one closed outer loop (2–64 curves) and at most 16 circular holes.",
        )
    for segment in profile["outer"]:
        if not isinstance(segment, dict) or segment.get("kind") not in ("line", "arc"):
            raise EngineError(
                "unsupported-geometry", "Outer curves must be exact lines or circular arcs."
            )
        _point(segment.get("start"))
        _point(segment.get("end"))
        if segment["kind"] == "arc":
            _point(segment.get("center"))
            if type(segment.get("clockwise", False)) is not bool:
                raise EngineError(
                    "invalid-geometry", "Arc direction must be clockwise or counterclockwise."
                )
    for hole in profile["holes"]:
        if not isinstance(hole, dict):
            raise EngineError(
                "invalid-hole", "Each hole must be a named circle with center and radius."
            )
        _point(hole.get("center"))
        if (
            type(hole.get("radius")) not in (int, float)
            or not math.isfinite(hole["radius"])
            or hole["radius"] <= 0
            or hole["radius"] > 1000
        ):
            raise EngineError("invalid-geometry", "Hole radii must be positive finite SI lengths.")
    identities = [item.get("id") for item in profile["outer"] + profile["holes"]]
    if any(not isinstance(identifier, str) or not identifier for identifier in identities) or len(
        set(identities)
    ) != len(identities):
        raise EngineError(
            "invalid-region", "Every profile boundary needs a unique persistent identifier."
        )
    low, high = profile_bounds(profile)
    scale = float(np.max(high - low))
    if not math.isfinite(scale) or scale < 1e-90 or np.min(high - low) / scale < 1e-6:
        raise EngineError(
            "unsupported-geometry", "Profile extent is too small or thin for float64 geometry."
        )
    for index, segment in enumerate(profile["outer"]):
        if not np.array_equal(
            _point(segment["end"]),
            _point(profile["outer"][(index + 1) % len(profile["outer"])]["start"]),
        ):
            raise EngineError(
                "open-profile", "Consecutive curve endpoints must match exactly; close the loop."
            )
    normalized, _, _ = normalized_profile(profile)
    outer, holes = normalized["outer"], normalized["holes"]
    for index, segment in enumerate(outer):
        a, b = _point(segment["start"]), _point(segment["end"])
        if np.linalg.norm(b - a) <= 1e-8:
            raise EngineError(
                "degenerate-geometry", f"Boundary {segment['id']} has coincident endpoints."
            )
        if np.linalg.norm(b - _point(outer[(index + 1) % len(outer)]["start"])) > TOL:
            raise EngineError(
                "open-profile",
                f"Boundary {segment['id']} does not meet the next curve; close the loop.",
            )
        if segment["kind"] == "arc":
            center, radius, _, sweep = arc_data(segment)
            if radius <= 1e-8 or abs(np.linalg.norm(b - center) - radius) > TOL:
                raise EngineError(
                    "invalid-arc", f"Boundary {segment['id']} endpoints must lie on one circle."
                )
            if abs(sweep) > math.pi + TOL:
                raise EngineError(
                    "unsupported-geometry",
                    f"Split boundary {segment['id']} into arcs of at most 180 degrees.",
                )
        for previous in range(index):
            intersections = _intersections(segment, outer[previous])
            adjacent = previous == index - 1 or (index == len(outer) - 1 and previous == 0)
            shared = [a, b] if len(outer) == 2 else [a if previous == index - 1 else b]
            if any(
                not adjacent or all(np.linalg.norm(p - q) > 8 * TOL for q in shared)
                for p in intersections
            ):
                raise EngineError(
                    "self-intersection",
                    f"Boundaries {segment['id']} and {outer[previous]['id']} intersect or overlap.",
                )
    if _signed_outer_area(normalized) <= 0:
        raise EngineError(
            "invalid-orientation", "Order the outer loop counterclockwise around the solid."
        )
    if profile_area(normalized) <= 1e-10:
        raise EngineError("degenerate-geometry", "The profile must enclose a positive solid area.")
    for index, hole in enumerate(holes):
        center, radius = _point(hole["center"]), hole["radius"]
        if (
            radius <= 1e-8
            or not _inside(center, outer)
            or any(segment_distance(center, segment) <= radius + TOL for segment in outer)
        ):
            raise EngineError(
                "invalid-hole",
                f"Hole {hole['id']} must lie strictly inside the outer loop without touching it.",
            )
        for previous in holes[:index]:
            if (
                np.linalg.norm(center - _point(previous["center"]))
                <= radius + previous["radius"] + TOL
            ):
                raise EngineError(
                    "invalid-hole", f"Holes {hole['id']} and {previous['id']} overlap or touch."
                )
