"""Exact single-solid study preparation and recipe-bound face assignments."""

import hashlib
import json
import re
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

import numpy as np

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Progress
from phyra_engine.meshing.types import Mesh


def is_cad_solid(project: dict[str, Any]) -> bool:
    study = project.get("study")
    return isinstance(study, dict) and study.get("domain", {}).get("kind") == "cad-solid"


def geometry_fingerprint(geometry: dict[str, Any]) -> str:
    # Native request objects have sorted keys. This preserves their current CAD
    # receipt stamp while making direct headless callers independent of dict order.
    encoded = json.dumps(geometry, sort_keys=True, separators=(",", ":"), allow_nan=False)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def validate_cad_domain(project: dict[str, Any], *, current: bool) -> None:
    """Check explicit source bindings without importing a CAD kernel or trusting IDs."""
    from phyra_engine.studies.project import SELECTION_WHITESPACE

    study = project["study"]
    if study is None or "domain" not in study:
        return
    domain = study["domain"]
    if (
        project["geometry"]["kind"] != "cad"
        or project["geometry"]["dimension"] != "3d"
        or study["dimension"] != "3d"
        or study["formulation"] != "solid"
        or study["solver"]["kind"] != "fem"
        or domain["kind"] != "cad-solid"
    ):
        raise EngineError("unsupported-study", "Exact CAD domains require 3D solid FEM.")
    owner = domain["outputFeatureId"]
    if not owner.strip(SELECTION_WHITESPACE):
        raise EngineError("invalid-cad-domain", "CAD source output identity must not be blank.")
    if len(owner.encode("utf-8")) > 100:
        owner = "feature-" + hashlib.sha256(owner.encode("utf-8")).hexdigest()[:24]
    aliases, faces = set(), set()
    for boundary in domain["boundaries"]:
        alias, face = boundary["id"], boundary["faceId"]
        if (
            alias in aliases
            or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{0,99}", alias)
            or face in faces
            or len(face.encode("utf-8")) > 200
            or not re.fullmatch(re.escape(owner) + r"/face/[a-f0-9]{24}", face)
            or not boundary["name"].strip(SELECTION_WHITESPACE)
        ):
            raise EngineError(
                "invalid-cad-domain", "CAD boundaries need unique valid source faces."
            )
        aliases.add(alias)
        faces.add(face)
    if current and (
        domain["outputFeatureId"] != project["geometry"]["outputFeatureId"]
        or domain["geometryFingerprint"] != geometry_fingerprint(project["geometry"])
    ):
        raise EngineError(
            "stale-cad-domain",
            "CAD geometry changed. Rebuild and repair the study's face assignments.",
        )


def generate_cad_study_mesh(
    project: dict[str, Any], assets: Mapping[str, bytes], progress: Progress | None
) -> Mesh:
    validate_cad_domain(project, current=True)
    from phyra_engine.geometry.cad.native_output import cad_log_to_stderr

    if progress:
        progress("building-exact-solid", None)
    # Native writers may print diagnostics. Never emit protocol progress inside
    # this scope; the owned worker can still be cancelled by native termination.
    with cad_log_to_stderr():
        from phyra_engine.geometry.cad.kernel import build, export_step
        from phyra_engine.meshing.cad import generate_cad_mesh

        geometry = project["geometry"]
        result = build(geometry, dict(assets))
        if any(instance.component_path for instance in result.body_instances):
            raise EngineError(
                "cad-domain-unavailable", "Assembly components require explicit connectivity."
            )
        # Match the existing exact receipt's post-STEP content-reference state.
        export_step(result.shape)
        try:
            inspected = generate_cad_mesh(
                result.shape, project["study"]["mesh"]["size"], owner_id=result.output_feature_id
            )
        except EngineError as error:
            if error.code in ("unsupported-cad-mesh", "invalid-cad-mesh"):
                raise EngineError("cad-domain-unavailable", str(error)) from error
            raise
    correspondence = inspected.correspondence
    if correspondence.reason:
        raise EngineError("cad-domain-unavailable", correspondence.reason)
    catalog = project["study"]["domain"]["boundaries"]
    by_face = {boundary["faceId"]: index for index, boundary in enumerate(catalog)}
    if len(catalog) != len(correspondence.face_ids) or set(by_face) != set(correspondence.face_ids):
        raise EngineError(
            "cad-domain-unavailable",
            "The study's complete face catalog does not match the current exact solid.",
        )
    remap = np.array([by_face[face] for face in correspondence.face_ids], dtype=np.uint32)
    mesh = replace(
        inspected.mesh,
        regions=tuple(boundary["id"] for boundary in catalog),
        surface_regions=remap[inspected.mesh.surface_regions],
    )
    if progress:
        progress("mesh-ready", 1)
    return mesh
