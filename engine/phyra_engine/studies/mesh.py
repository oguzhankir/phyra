"""Prepare a discretization from one validated engineering study definition."""

from collections.abc import Mapping
from typing import Any

from phyra_engine.execution.events import Progress
from phyra_engine.meshing.types import Mesh, Mesh2D


def generate_study_mesh(
    project: dict[str, Any],
    progress: Progress | None = None,
    *,
    assets: Mapping[str, bytes] | None = None,
) -> Mesh | Mesh2D:
    from phyra_engine.studies.cad import generate_cad_study_mesh, is_cad_solid
    from phyra_engine.studies.project import numerical_view, validate_numerical_project

    validate_numerical_project(project)
    if is_cad_solid(project):
        return generate_cad_study_mesh(project, assets or {}, progress)
    project = numerical_view(project)
    if project["study"].get("dimension") == "2d":
        from phyra_engine.meshing.plane_stress import generate_rectangle

        if progress:
            progress("generating-plane-stress-mesh", None)
        geometry, study = project["geometry"], project["study"]
        if geometry["kind"] == "profile":
            from phyra_engine.meshing.profile import generate_profile

            return generate_profile(
                geometry["profile"],
                study["thickness"],
                study["mesh"]["size"],
                study["mesh"].get("boundarySize"),
                progress,
            )
        return generate_rectangle(
            geometry["length"], geometry["width"], study["thickness"], study["mesh"]["size"]
        )
    from phyra_engine.meshing.solid import generate_solid

    return generate_solid(project["geometry"], project["study"]["mesh"]["size"], progress)
