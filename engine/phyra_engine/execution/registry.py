"""Implemented study/method routes and truthful local-runtime capabilities.

The dispatcher below executes the same registrations that are described to the
workbench. New physics/backends require a real method and a versioned contract;
this registry does not infer support from a library's advertised capabilities.
"""

from dataclasses import asdict, dataclass
from typing import Any

from phyra_engine.errors import EngineError
from phyra_engine.execution.events import Cancellation, Metrics, Progress
from phyra_engine.meshing.types import Mesh, Mesh2D
from phyra_engine.results.comparison import MAPPING


@dataclass(frozen=True)
class Method:
    id: str
    kind: str
    dimension: str
    formulation: str
    framework: str
    operation: str
    configuration: str | None


METHODS = (
    Method("fem-solid-tetra4", "fem", "3d", "solid", "scipy", "solve", None),
    Method("fem-plane-stress-tri3", "fem", "2d", "plane-stress", "scikit-fem", "solve", None),
    Method(
        "pinn-plane-stress-displacement",
        "pinn",
        "2d",
        "plane-stress",
        "pytorch",
        "train",
        "study.solver.pinn",
    ),
)


def methods_for_operation(project: dict[str, Any], operation: str) -> tuple[Method, ...]:
    dimension = project["study"].get("dimension", "3d")
    formulation = project["study"].get("formulation", "solid")
    if operation == "mesh":
        return ()
    if operation in ("train", "compare") and (
        project["geometry"]["kind"] == "profile"
        or any(load["kind"] == "traction" for load in project["study"]["loads"])
    ):
        raise EngineError(
            "unsupported-study",
            "PINN training supports rectangular constant-traction studies only.",
        )
    operations = ("solve", "train") if operation == "compare" else (operation,)
    methods = tuple(
        method
        for requested in operations
        for method in METHODS
        if method.dimension == dimension
        and method.formulation == formulation
        and method.operation == requested
    )
    if len(methods) != len(operations):
        raise EngineError(
            "unsupported-study", "The requested method is not implemented for this study."
        )
    return methods


def execute_method(
    method: Method,
    mesh: Mesh | Mesh2D,
    study: dict[str, Any],
    progress: Progress | None = None,
    metrics: Metrics | None = None,
    cancelled: Cancellation | None = None,
) -> dict[str, Any]:
    if method not in METHODS:
        raise EngineError("unsupported-method", "The method is not registered in this runtime.")
    if method.id == "fem-solid-tetra4" and isinstance(mesh, Mesh):
        from phyra_engine.methods.classical.solid import solve_mesh

        return solve_mesh(mesh, study, progress)
    if method.id == "fem-plane-stress-tri3" and isinstance(mesh, Mesh2D):
        from phyra_engine.methods.classical.plane_stress import solve_mesh as solve_plane

        return solve_plane(mesh, study, progress)
    if method.id == "pinn-plane-stress-displacement" and isinstance(mesh, Mesh2D):
        from phyra_engine.methods.physicsml.plane_stress import train

        if progress:
            progress("initializing-pinn", 0)
        return train(mesh, study, study["solver"]["pinn"], metrics, cancelled)
    raise EngineError("unsupported-study", "Method and mesh dimensions disagree.")


def capabilities(devices: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """Describe actual methods; probe PyTorch once if no existing device probe is supplied."""
    if devices is None:
        from phyra_engine.execution.devices import device_capabilities

        devices = device_capabilities()
    classical_cpu = {
        "id": "cpu",
        "label": "CPU",
        "precision": "float64",
        "available": True,
        "reason": "The installed SciPy sparse solver executes on the local CPU.",
    }
    return {
        "schemaVersion": 1,
        "execution": {
            "backend": "local-process",
            "jobsPerWorker": 1,
            "cancellation": "terminate-worker",
        },
        "materialModels": ["homogeneous-isotropic-linear-elastic"],
        "meshing": [
            {
                "id": "gmsh-occ-tetra4",
                "dimension": "3d",
                "cellType": "tetra4",
                "geometryKinds": ["box", "cylinder", "bracket"],
            },
            {
                "id": "structured-rectangle-tri3",
                "dimension": "2d",
                "cellType": "triangle3",
                "geometryKinds": ["box"],
            },
            {
                "id": "gmsh-occ-profile-tri3",
                "dimension": "2d",
                "cellType": "triangle3",
                "geometryKinds": ["profile"],
            },
        ],
        "methods": [
            {
                **asdict(method),
                "devices": [
                    dict(device)
                    for device in (devices if method.kind == "pinn" else [classical_cpu])
                ],
            }
            for method in METHODS
        ],
        "comparisons": [
            {
                "id": "plane-stress-fem-pinn",
                "operation": "compare",
                "reference": "fem-plane-stress-tri3",
                "prediction": "pinn-plane-stress-displacement",
                "mapping": MAPPING,
            }
        ],
    }
