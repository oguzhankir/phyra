"""The selected output's bounded dependency closure defines the evaluated shape."""

from typing import Any

from phyra_engine.errors import EngineError


def dependencies(feature: dict[str, Any]) -> tuple[str, ...]:
    """The exact authored sources for one implemented feature."""
    references = [
        feature[key]
        for key in ("sketchId", "inputId", "leftId", "rightId", "profileId", "spineId")
        if key in feature
    ]
    if feature["kind"] == "loft":
        references.extend(feature["sectionIds"])
    if feature["kind"] == "assembly":
        references.extend(component["featureId"] for component in feature["components"])
    return tuple(dict.fromkeys(references))


def output_features(geometry: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    """Keep inactive authored history intact without executing its kernel operations."""
    features = geometry["features"]
    indexed = {feature["id"]: feature for feature in features}
    if len(indexed) != len(features) or len(features) > 128:
        raise EngineError("invalid-geometry", "CAD feature identities must be unique and bounded.")
    pending = [geometry["outputFeatureId"]]
    required: set[str] = set()
    while pending:
        identifier = pending.pop()
        if identifier in required:
            continue
        feature = indexed.get(identifier)
        if feature is None:
            raise EngineError("invalid-geometry", "CAD output dependency is unavailable.")
        required.add(identifier)
        pending.extend(dependencies(feature))
    return tuple(feature for feature in features if feature["id"] in required)


def spine_features(features: tuple[dict[str, Any], ...]) -> frozenset[str]:
    """Open wires are an actual sweep input role, never a second authored graph."""
    indexed = {feature["id"]: feature for feature in features}
    required: set[str] = set()
    for feature in features:
        if feature["kind"] != "sweep":
            continue
        identifier = feature["spineId"]
        visited: set[str] = set()
        while identifier not in visited:
            visited.add(identifier)
            source = indexed[identifier]
            required.add(identifier)
            if source["kind"] == "sketch":
                break
            if source["kind"] != "transform":
                raise EngineError(
                    "unsupported-sweep-spine",
                    "Sweep paths require an open sketch or its rigid transforms.",
                )
            identifier = source["inputId"]
        else:
            raise EngineError("invalid-geometry", "CAD dependencies cannot contain a cycle.")
    return frozenset(required)
