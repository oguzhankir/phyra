"""Exact, conservative lowering into already verified numerical geometry.

This is a derived view, never a replacement for authored CAD. No geometric
recognition of imported or filleted BReps is used to infer solver support.
"""

import hashlib
import math
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.geometry.cad.recipe import output_features
from phyra_engine.geometry.profile import arc_data, profile_bounds
from phyra_engine.geometry.sketch_constraints import build_profile


def _primitive(
    kind: str, length: float, width: float, height: float, radius: float
) -> dict[str, Any]:
    return {
        "kind": kind,
        "length": length,
        "width": width,
        "height": height,
        "radius": radius,
        "thickness": min(length, width) / 4,
    }


def lower_geometry(geometry: dict[str, Any]) -> dict[str, Any]:
    """Return an exact existing geometry contract or a truthful unsupported gate."""
    if geometry["kind"] != "cad":
        return geometry
    features = {feature["id"]: feature for feature in output_features(geometry)}
    output = features[geometry["outputFeatureId"]]
    kind, dimension = output["kind"], geometry["dimension"]
    if kind in ("assembly", "loft", "sweep"):
        reason = (
            "Current analyses do not support multiple component bodies, contacts or assembly bonds."
            if kind == "assembly"
            else "Current analyses do not support lofted or swept solid/surface domains."
        )
        raise EngineError(
            "unsupported-cad-study",
            f"{reason} This exact design remains editable and can be saved or exported.",
        )
    if kind == "transform":
        raise EngineError(
            "unsupported-cad-study",
            "Moved or rotated geometry remains exact editable CAD. Current analyses do not "
            "yet support rigidly placed domains; return to an eligible output to create a study.",
        )
    if dimension == "3d" and kind == "box":
        length, width, height = (output[key] for key in ("length", "width", "height"))
        return _verified(geometry, _primitive("box", length, width, height, min(width, height) / 2))
    if dimension == "3d" and kind == "cylinder":
        radius, length = output["radius"], output["length"]
        return _verified(geometry, _primitive("cylinder", length, 2 * radius, 2 * radius, radius))
    if dimension == "2d" and kind == "sketch" and output["plane"] == "xy":
        profile, _ = build_profile(output["sketch"])
        low, high = profile_bounds(profile)
        return _verified(
            geometry,
            {
                **_primitive(
                    "profile", float(high[0] - low[0]), float(high[1] - low[1]), 0.001, 0.001
                ),
                "profile": profile,
            },
        )
    if dimension == "3d" and kind == "extrude" and output["distance"] > 0:
        sketch = features[output["sketchId"]]
        if sketch["kind"] == "sketch" and sketch["plane"] == "xy":
            profile, _ = build_profile(sketch["sketch"])
            outer = profile["outer"]
            if not profile["holes"] and len(outer) == 4 and all(s["kind"] == "line" for s in outer):
                points = {tuple(s["start"]) for s in outer}
                xs, ys = sorted({p[0] for p in points}), sorted({p[1] for p in points})
                if (
                    len(xs) == len(ys) == 2
                    and xs[0] == ys[0] == 0
                    and xs[1] > 0
                    and ys[1] > 0
                    and points == {(x, y) for x in xs for y in ys}
                    and all(
                        s["start"][0] == s["end"][0] or s["start"][1] == s["end"][1] for s in outer
                    )
                ):
                    return _verified(
                        geometry,
                        _primitive("box", xs[1], ys[1], output["distance"], min(xs[1], ys[1]) / 2),
                    )
    raise EngineError(
        "unsupported-cad-study",
        "Current analyses support direct CAD boxes, X-axis cylinders, XY planar profiles "
        "and positive XY extrusion of an origin-aligned rectangle. "
        "This design remains editable CAD.",
    )


def _verified(geometry: dict[str, Any], numerical: dict[str, Any]) -> dict[str, Any]:
    # The normal worker must independently establish exact CAD validity, even
    # without a frontend receipt. Allowed operations need no imported assets.
    from phyra_engine.geometry.cad.kernel import build

    build(geometry, {})
    return numerical


def _close(first: list[float], second: list[float], scale: float) -> bool:
    return math.dist(first, second) <= max(scale * 1e-10, 1e-12)


def _bindings(
    geometry: dict[str, Any],
    numerical: dict[str, Any],
    faces: list[dict[str, Any]],
    edges: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Link proven primitive/profile boundaries to unique exact CAD entities.

    This is limited to domains already proven equivalent by their authored
    operations. It is never used to recognize or remap arbitrary imported BReps.
    """
    kind = numerical["kind"]
    bindings = []
    if geometry["dimension"] == "3d":
        for axis, label in enumerate("xyz" if kind == "box" else "x"):
            extent = numerical[("length", "width", "height")[axis]]
            for end_label, coordinate in (("0", 0.0), ("1", extent)):
                candidates = [
                    face["id"]
                    for face in faces
                    if face["identity"] == "content-reference"
                    and face["surfaceType"] == "GeomAbs_Plane"
                    and all(
                        abs(bound[axis] - coordinate) <= extent * 1e-10 for bound in face["bounds"]
                    )
                ]
                bindings.append(
                    {
                        "regionId": label + end_label,
                        "entityIds": candidates if len(candidates) == 1 else [],
                    }
                )
        if kind == "cylinder":
            candidates = [
                face["id"]
                for face in faces
                if face["surfaceType"] == "GeomAbs_Cylinder"
                and face["identity"] == "content-reference"
            ]
            bindings.append(
                {"regionId": "outer", "entityIds": candidates if len(candidates) == 1 else []}
            )
        return bindings
    profile = numerical["profile"]
    authored = {
        "cad-" + hashlib.sha256(entity["id"].encode()).hexdigest()[:32]: entity["id"]
        for feature in geometry["features"]
        if feature["id"] == geometry["outputFeatureId"]
        for entity in feature["sketch"]["entities"]
    }
    scale = max(numerical["length"], numerical["width"])
    for boundary in profile["outer"] + profile["holes"]:
        identifier = boundary["id"]
        if "kind" not in boundary:
            candidates = [
                edge["id"]
                for edge in edges
                if edge["identity"] == "content-reference"
                and edge.get("curveType") == "GeomAbs_Circle"
                and _close(edge["centroid"], [*boundary["center"], 0.0], scale)
                and abs(edge["length"] - 2 * math.pi * boundary["radius"]) <= scale * 1e-10
            ]
        else:
            start, end = [*boundary["start"], 0.0], [*boundary["end"], 0.0]
            if boundary["kind"] == "line":
                middle = [(a + b) / 2 for a, b in zip(start, end, strict=True)]
                length = math.dist(start, end)
            else:
                center, radius, angle, sweep = arc_data(boundary)
                middle = [
                    center[0] + radius * math.cos(angle + sweep / 2),
                    center[1] + radius * math.sin(angle + sweep / 2),
                    0.0,
                ]
                length = radius * abs(sweep)
            candidates = []
            for edge in edges:
                samples = edge.get("samples", [])
                if edge["identity"] != "content-reference" or len(samples) != 5:
                    continue
                if (
                    abs(edge["length"] - length) <= scale * 1e-10
                    and _close(samples[2], middle, scale)
                    and (
                        (_close(samples[0], start, scale) and _close(samples[-1], end, scale))
                        or (_close(samples[0], end, scale) and _close(samples[-1], start, scale))
                    )
                ):
                    candidates.append(edge["id"])
        source = authored.get(identifier, authored.get(identifier[:-2]))
        bindings.append(
            {
                "regionId": identifier,
                "entityIds": candidates if len(candidates) == 1 else [],
                **({"sourceEntityId": source} if source else {}),
            }
        )
    return bindings


def eligibility(
    geometry: dict[str, Any],
    faces: list[dict[str, Any]] | None = None,
    edges: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    try:
        numerical = lower_geometry(geometry)
    except EngineError as error:
        return {
            "state": "unsupported",
            "dimension": geometry["dimension"],
            "methodIds": [],
            "reason": str(error),
            "regionBindings": [],
        }
    dimension = geometry["dimension"]
    return {
        "state": "supported",
        "dimension": dimension,
        "methodIds": ["fem-solid-tetra4"]
        if dimension == "3d"
        else ["fem-plane-stress-tri3", "pinn-plane-stress-energy"],
        "reason": "The authored design is exactly equivalent to a current numerical domain; "
        "loads, supports, material, meshing and method eligibility are checked separately.",
        "numericalGeometry": numerical,
        "regionBindings": _bindings(geometry, numerical, faces, edges)
        if faces is not None and edges is not None
        else [],
    }
