"""The selected output's bounded dependency closure defines the evaluated shape."""

from typing import Any

from phyra_engine.errors import EngineError


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
        pending.extend(
            feature[key] for key in ("sketchId", "inputId", "leftId", "rightId") if key in feature
        )
    return tuple(feature for feature in features if feature["id"] in required)
