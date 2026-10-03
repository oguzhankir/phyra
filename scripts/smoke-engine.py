"""Run bundled 3D and 2D workers from an unrelated cwd without Python paths.

The driver uses only the standard library. It independently reads typed buffers
and checks plane-stress axial displacement/stress against F/(tW), Poisson
contraction and FL/(2EA). No development engine or tensor runtime is imported.
"""

import hashlib
import json
import math
import os
import struct
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXECUTABLE = (
    ROOT
    / "src-tauri"
    / "resources"
    / "engine"
    / ("phyra-engine.exe" if sys.platform == "win32" else "phyra-engine")
)


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def number(value: object) -> bool:
    return type(value) in (int, float) and math.isfinite(value)


def reject_constant(value: str) -> None:
    raise ValueError(f"Nonfinite JSON constant: {value}")


def read_arrays(manifest: dict, output: Path) -> dict[str, list]:
    payload = (output / "buffer.bin").read_bytes()
    require(len(payload) == manifest["byteLength"], "Bundled buffer length mismatch.")
    require(
        hashlib.sha256(payload).hexdigest() == manifest["bufferHash"],
        "Buffer hash mismatch.",
    )
    arrays = {}
    ranges = []
    for key, descriptor in manifest["arrays"].items():
        shape = descriptor["shape"]
        require(
            isinstance(shape, list) and all(type(v) is int and v > 0 for v in shape),
            f"Invalid {key} shape.",
        )
        offset, length = descriptor["offset"], descriptor["byteLength"]
        require(
            type(offset) is int and offset >= 0 and offset % 8 == 0,
            f"Invalid {key} alignment.",
        )
        require(
            type(length) is int and length >= 0 and offset + length <= len(payload),
            f"Invalid {key} byte bounds.",
        )
        require(descriptor["dtype"] in ("float64", "uint32"), f"Invalid {key} dtype.")
        scalar, size = ("d", 8) if descriptor["dtype"] == "float64" else ("I", 4)
        count = math.prod(shape)
        require(count * size == length, f"Invalid {key} byte count.")
        flat = list(struct.unpack_from(f"<{count}{scalar}", payload, offset))
        require(all(number(value) for value in flat), f"Nonfinite {key} field.")
        arrays[key] = (
            flat
            if len(shape) == 1
            else [flat[begin : begin + shape[1]] for begin in range(0, count, shape[1])]
        )
        ranges.append((offset, offset + length))
    cursor = 0
    for start, end in sorted(ranges):
        require(
            start >= cursor and start - cursor < 8 and not any(payload[cursor:start]),
            "Bundled arrays overlap or contain invalid padding.",
        )
        cursor = end
    require(cursor == len(payload), "Unowned bundled buffer bytes.")
    return arrays


def relative_l2(prediction: list[list], reference: list[list]) -> float:
    require(len(prediction) == len(reference), "Comparison sample counts differ.")
    denominator = sum(value * value for row in reference for value in row)
    require(denominator > 0, "Smoke reference must be nonzero.")
    difference = sum(
        (value - exact) ** 2
        for row, target in zip(prediction, reference, strict=True)
        for value, exact in zip(row, target, strict=True)
    )
    return math.sqrt(difference / denominator)


def check_2d_fields(
    manifest: dict, output: Path, project: dict, operation: str
) -> dict[str, float]:
    arrays = read_arrays(manifest, output)
    stats = manifest["statistics"]
    nodes, cells, edges = stats["nodes"], stats["cells"], stats["boundaryEdges"]
    descriptors = {
        "positions": ([nodes, 3], "node", "m", "float64"),
        "cells": ([cells, 3], "cell", "1", "uint32"),
        "surface": ([cells, 3], "surface", "1", "uint32"),
        "surfaceRegions": ([cells], "surface", "1", "uint32"),
        "surfaceCells": ([cells], "surface", "1", "uint32"),
        "boundaryEdges": ([edges, 2], "edge", "1", "uint32"),
        "edgeRegions": ([edges], "edge", "1", "uint32"),
    }
    result_fields = {
        "displacement": ([nodes, 3], "node", "m", "float64"),
        "stress": ([cells, 6], "cell", "Pa", "float64"),
        "vonMises": ([cells], "cell", "Pa", "float64"),
        "reactions": ([nodes, 3], "node", "N", "float64"),
    }
    descriptors.update(result_fields)
    if operation == "compare":
        descriptors.update(
            {f"pinn{k[0].upper()}{k[1:]}": v for k, v in result_fields.items()}
        )
    require(
        set(manifest["arrays"]) == set(descriptors), "Unexpected bundled 2D field set."
    )
    for key, (shape, association, units, dtype) in descriptors.items():
        descriptor = manifest["arrays"][key]
        require(
            descriptor["shape"] == shape
            and descriptor["association"] == association
            and descriptor["units"] == units
            and descriptor["dtype"] == dtype,
            f"Bundled {key} sampling location or SI units mismatch.",
        )
    require(
        arrays["surface"] == arrays["cells"]
        and arrays["surfaceCells"] == list(range(cells))
        and not any(arrays["surfaceRegions"]),
        "2D display mapping changed field locations.",
    )
    require(
        all(0 <= node < nodes for cell in arrays["cells"] for node in cell)
        and all(0 <= node < nodes for edge in arrays["boundaryEdges"] for node in edge),
        "Bundled connectivity contains an absent node.",
    )
    require(
        all(position[2] == 0 for position in arrays["positions"]),
        "2D domain left xy plane.",
    )
    require(
        manifest["dimension"] == "2d"
        and manifest["formulation"] == "plane-stress"
        and manifest["cellType"] == "triangle3"
        and manifest["thickness"] == project["study"]["thickness"],
        "2D physical provenance changed.",
    )
    require(
        manifest["stressComponents"] == ["xx", "yy", "zz", "xy", "yz", "xz"],
        "Bundled stress component convention changed.",
    )
    for prefix in ("", "pinn") if operation == "compare" else ("",):
        displacement_key = "displacement" if not prefix else "pinnDisplacement"
        stress_key = "stress" if not prefix else "pinnStress"
        require(
            all(row[2] == 0 for row in arrays[displacement_key]),
            "Out-of-plane 2D displacement.",
        )
        require(
            all(row[2] == row[4] == row[5] == 0 for row in arrays[stress_key]),
            "Plane-stress field contains unsupported components.",
        )
    study, geometry = project["study"], project["geometry"]
    stress = study["loads"][0]["vector"][0] / (study["thickness"] * geometry["width"])
    strain = stress / study["material"]["young"]
    exact_displacement = [
        [strain * x, -study["material"]["poisson"] * strain * y, 0]
        for x, y, _ in arrays["positions"]
    ]
    exact_stress = [[stress, 0, 0, 0, 0, 0] for _ in range(cells)]
    errors = {
        "displacement": relative_l2(arrays["displacement"], exact_displacement),
        "stress": relative_l2(arrays["stress"], exact_stress),
    }
    if operation == "compare":
        errors.update(
            {
                "pinnDisplacement": relative_l2(
                    arrays["pinnDisplacement"], exact_displacement
                ),
                "pinnStress": relative_l2(arrays["pinnStress"], exact_stress),
                "pinnMaxDisplacement": abs(
                    max(
                        math.sqrt(sum(v * v for v in row))
                        for row in arrays["pinnDisplacement"]
                    )
                    / max(
                        math.sqrt(sum(v * v for v in row)) for row in exact_displacement
                    )
                    - 1
                ),
            }
        )
        comparison = manifest["comparison"]
        require(
            comparison["mapping"]
            == "identical nodes and cell centroids; unweighted relative L2",
            "Bundled comparison uses an unexpected field mapping.",
        )
        for key in ("displacement", "stress"):
            predicted = arrays[f"pinn{key[0].upper()}{key[1:]}"]
            measured = relative_l2(predicted, arrays[key])
            require(
                math.isclose(
                    comparison[key]["relativeL2"],
                    measured,
                    rel_tol=1e-12,
                    abs_tol=1e-15,
                ),
                f"Bundled {key} comparison metric does not match the arrays.",
            )
        for key in ("femSeconds", "trainingSeconds", "inferenceSeconds"):
            require(
                number(comparison[key]) and comparison[key] >= 0,
                "Invalid comparison timing.",
            )
    return errors


def check_training(
    manifest: dict, messages: list[dict], project: dict, device: str
) -> tuple[float, float]:
    training = manifest["training"]
    configuration = project["study"]["solver"]["pinn"]
    require(
        training["configuration"] == configuration,
        "Bundled training configuration changed.",
    )
    require(
        training["device"] == manifest["device"] == device,
        "Actual training device mismatch.",
    )
    require(
        training["precision"] == ("float32" if device == "mps" else "float64"),
        "Actual training precision mismatch.",
    )
    require(
        training["framework"] == "pytorch"
        and isinstance(training["frameworkVersion"], str),
        "Missing bundled tensor runtime provenance.",
    )
    history = training["history"]
    live = [message for message in messages if message["type"] == "metrics"]
    require(
        1 < len(history) <= 1001 and len(history) == len(live),
        "Metrics/history count mismatch.",
    )
    require(
        history[0]["step"] == 0 and history[-1]["step"] == configuration["steps"],
        "Bundled training omitted initial or final metrics.",
    )
    prior_step, prior_elapsed = -1, -1.0
    for event, streamed in zip(history, live, strict=True):
        require(
            all(
                event[key] == streamed[key]
                for key in (
                    "jobId",
                    "step",
                    "elapsed",
                    "total",
                    "pde",
                    "boundary",
                    "device",
                )
            ),
            "Live metrics differ from persisted training history.",
        )
        require(
            type(event["step"]) is int
            and prior_step < event["step"]
            and event["device"] == device
            and event["jobId"] == manifest["jobId"],
            "Training metrics lost monotonic execution identity.",
        )
        require(
            all(
                number(event[key]) and event[key] >= 0
                for key in ("elapsed", "total", "pde", "boundary")
            )
            and event["elapsed"] >= prior_elapsed,
            "Invalid or nonmonotonic training metrics.",
        )
        require(
            math.isclose(
                event["total"],
                event["pde"] + event["boundary"],
                rel_tol=1e-7,
                abs_tol=1e-12,
            ),
            "Bundled training loss components do not sum.",
        )
        prior_step, prior_elapsed = event["step"], event["elapsed"]
    for value in training["normalization"].values():
        require(number(value) and value > 0, "Invalid physical normalization.")
    for key in ("trainingSeconds", "inferenceSeconds"):
        require(
            number(training["timings"][key]) and training["timings"][key] >= 0,
            "Invalid training/inference timing.",
        )
    validation = training["validation"]
    require(
        set(validation)
        == {
            "schemaVersion",
            "sampling",
            "seed",
            "interiorPoints",
            "boundaryPointsPerRegion",
            "total",
            "pde",
            "boundary",
            "displacement",
            "traction",
        }
        and type(validation["schemaVersion"]) is int
        and validation["schemaVersion"] == 1
        and validation["sampling"] == "independent-uniform",
        "Bundled held-out residual contract changed.",
    )
    for key, expected in (
        ("seed", configuration["seed"] ^ 0x5EED5EED),
        ("interiorPoints", configuration["interiorPoints"]),
        ("boundaryPointsPerRegion", configuration["boundaryPoints"]),
    ):
        require(
            type(validation[key]) is int and validation[key] == expected,
            "Held-out sampling lost its independent seed or configured point counts.",
        )
    require(
        all(
            number(validation[key]) and validation[key] >= 0
            for key in ("total", "pde", "boundary", "displacement", "traction")
        ),
        "Bundled held-out residual contains nonfinite or negative losses.",
    )
    epsilon = 2**-23 if device == "mps" else 2**-52
    for key, components in (
        ("total", ("pde", "boundary")),
        ("boundary", ("displacement", "traction")),
    ):
        require(
            math.isclose(
                validation[key],
                sum(validation[component] for component in components),
                rel_tol=8 * epsilon,
                abs_tol=0,
            ),
            "Bundled held-out loss components do not sum at the actual precision.",
        )
    return history[0]["total"], history[-1]["total"]


def main() -> None:
    project = {
        "schemaVersion": 1,
        "id": "package-smoke",
        "name": "Bundled worker verification",
        "revision": 0,
        "displayUnits": "mm",
        "geometry": {
            "kind": "box",
            "length": 0.1,
            "width": 0.02,
            "height": 0.02,
            "radius": 0.01,
            "thickness": 0.005,
        },
        "study": {
            "id": "linear-static",
            "type": "linear-static",
            "material": {
                "name": "Verification material",
                "young": 210e9,
                "poisson": 0.3,
            },
            "mesh": {"size": 0.012},
            "constraints": [
                {
                    "id": "fixed",
                    "name": "Fixed",
                    "regions": ["x0"],
                    "components": [0, 0, 0],
                }
            ],
            "loads": [
                {
                    "id": "force",
                    "name": "Force",
                    "regions": ["x1"],
                    "kind": "force",
                    "vector": [0, 0, -1],
                    "pressure": 0,
                }
            ],
        },
    }
    env = {
        key: value
        for key, value in os.environ.items()
        if key not in ("PYTHONPATH", "PYTHONHOME", "VIRTUAL_ENV")
    }
    with tempfile.TemporaryDirectory(prefix="phyra-bundle-smoke-") as directory:

        def invoke(
            operation: str, selected_project: dict, output: Path, job_id: str
        ) -> tuple[int, list[dict]]:
            request = {
                "protocolVersion": 1,
                "operation": operation,
                "jobId": job_id,
                "project": selected_project,
            }
            process = subprocess.run(
                [str(EXECUTABLE), "--output", str(output)],
                input=json.dumps(request, allow_nan=False).encode(),
                capture_output=True,
                env=env,
                cwd=directory,
                timeout=120,
                check=False,
            )
            require(
                len(process.stdout) <= 4 * 1024 * 1024,
                "Bundled stdout exceeded framing limit.",
            )
            try:
                messages = [
                    json.loads(line, parse_constant=reject_constant)
                    for line in process.stdout.splitlines()
                ]
            except (json.JSONDecodeError, ValueError) as error:
                raise RuntimeError(
                    "Bundled stdout was not finite framed JSON."
                ) from error
            require(
                0 < len(messages) <= 2048,
                "Missing or excessive bundled protocol frames.",
            )
            require(
                messages[-1].get("type") in ("complete", "error"),
                "Missing terminal worker frame.",
            )
            for message in messages[:-1]:
                require(
                    message.get("type") in ("progress", "metrics")
                    and message.get("jobId") == job_id,
                    "Worker emitted an invalid or foreign progress frame.",
                )
            if process.stderr:
                print(process.stderr.decode(errors="replace")[:4096], file=sys.stderr)
            return process.returncode, messages

        def completed(
            operation: str, selected_project: dict, output: Path, job_id: str
        ) -> tuple[dict, list[dict]]:
            code, messages = invoke(operation, selected_project, output, job_id)
            require(
                code == 0 and messages[-1].get("type") == "complete",
                f"Bundled {operation} failed: {messages[-1]}",
            )
            manifest = messages[-1]["manifest"]
            require(
                manifest["projectId"] == selected_project["id"]
                and manifest["studyId"] == selected_project["study"]["id"]
                and manifest["jobId"] == job_id,
                "Bundled worker lost execution identity.",
            )
            return manifest, messages

        output = Path(directory) / "result-3d"
        manifest, _ = completed("solve", project, output, "bundle-3d")
        diagnostic = manifest["summary"]
        require(
            diagnostic["maxDisplacement"] > 0 and diagnostic["relativeResidual"] < 1e-8,
            "Bundled 3D mechanics did not produce a valid equilibrium solution.",
        )
        require(
            all(
                abs(value - expected) <= 2e-9
                for value, expected in zip(
                    diagnostic["totalReaction"], [0, 0, 1], strict=True
                )
            ),
            "Bundled 3D reaction does not balance applied force.",
        )
        reopened, _ = completed("validate", project, output, "bundle-3d")
        require(reopened == manifest, "Bundled 3D reopening changed metadata.")
        changed = json.loads(json.dumps(project))
        changed["study"]["loads"][0]["vector"][2] = -2
        code, messages = invoke("validate", changed, output, "bundle-3d")
        require(
            code != 0 and messages[-1].get("code") == "stale-cache",
            "Accepted stale 3D provenance.",
        )
        binary = output / "buffer.bin"
        payload = bytearray(binary.read_bytes())
        payload[-1] ^= 1
        binary.write_bytes(payload)
        code, messages = invoke("validate", project, output, "bundle-3d")
        require(
            code != 0 and messages[-1].get("code") == "corrupt-cache",
            "Accepted corrupt binary data.",
        )
        print(
            f"Bundled 3D solve/cache/failures passed: {manifest['statistics']['nodes']} nodes, "
            f"{manifest['statistics']['cells']} cells, residual={diagnostic['relativeResidual']:.3g}."
        )

        profile = json.loads(
            (ROOT / "examples" / "kirsch-quarter.json").read_text(encoding="utf-8")
        )
        output = Path(directory) / "profile"
        manifest, _ = completed("mesh", profile, output, "bundle-profile-mesh")
        require(
            manifest["dimension"] == "2d"
            and manifest["versions"]["gmsh"] != "unused-2d",
            "Profile did not use the exact Gmsh domain route.",
        )
        manifest, _ = completed("solve", profile, output, "bundle-profile")
        arrays = read_arrays(manifest, output)
        require(
            manifest["reference"]["kind"] == "kirsch-plane-stress",
            "Missing independent reference.",
        )
        require(
            all(
                manifest["summary"][key] < 1e-8
                for key in (
                    "relativeResidual",
                    "relativeForceBalance",
                    "relativeMomentBalance",
                )
            ),
            "Bundled profile violates equilibrium.",
        )
        require(
            manifest["versions"].get("scikit-fem") == "12.0.2",
            "Missing pinned assembly backend.",
        )
        region_ids = [region["id"] for region in manifest["regions"]]
        for edge, region in zip(
            arrays["boundaryEdges"], arrays["edgeRegions"], strict=True
        ):
            for node in edge:
                if region_ids[region] == "x0":
                    require(
                        arrays["displacement"][node][0] == 0,
                        "X symmetry support moved.",
                    )
                if region_ids[region] == "y0":
                    require(
                        arrays["displacement"][node][1] == 0,
                        "Y symmetry support moved.",
                    )
        # Independent resultant from exact Kirsch tractions on the finite left/top
        # boundaries. This formula does not use the engine reference evaluator.
        L = profile["geometry"]["length"]
        parameters = profile["study"]["loads"][0]["traction"]
        R, T = parameters["radius"], parameters["tension"]
        thickness = profile["study"]["thickness"]
        expected_force = [
            -thickness * T * (L - 0.5 * R**2 / L - 0.5 * R**4 / L**3),
            -thickness * T * 0.5 * (R**2 / L - R**4 / L**3),
            0.0,
        ]
        require(
            all(
                math.isclose(a, b, rel_tol=1e-7, abs_tol=abs(T * thickness * L) * 1e-9)
                for a, b in zip(
                    manifest["summary"]["totalForce"], expected_force, strict=True
                )
            ),
            "Finite boundary traction resultant has the wrong sign or magnitude.",
        )
        expected_moment = (
            thickness * T * ((L**2 - R**2) / 2 + 1.5 * R**2 * (1 - R**2 / L**2))
        )
        reaction_moment = sum(
            p[0] * r[1] - p[1] * r[0]
            for p, r in zip(arrays["positions"], arrays["reactions"], strict=True)
        )
        require(
            math.isclose(-reaction_moment, expected_moment, rel_tol=1e-7),
            "Applied boundary moment is not balanced by independently checked reactions.",
        )
        reopened, _ = completed("validate", profile, output, "bundle-profile")
        require(
            reopened == manifest, "Profile cache reopening changed physical metadata."
        )
        changed = json.loads(json.dumps(profile))
        changed["study"]["loads"][0]["traction"]["tension"] *= 0.5
        code, messages = invoke("validate", changed, output, "bundle-profile")
        require(
            code != 0 and messages[-1].get("code") == "stale-cache",
            "Accepted changed profile load cache.",
        )
        code, messages = invoke(
            "train", profile, Path(directory) / "profile-train", "unsupported-profile"
        )
        require(
            code != 0 and messages[-1].get("code") == "unsupported-study",
            "Profile incorrectly offered PINN.",
        )
        print(
            f"Bundled exact profile mesh/solve/reference/cache passed: {manifest['statistics']['cells']} triangles; "
            f"force={manifest['summary']['relativeForceBalance']:.3g}, moment={manifest['summary']['relativeMomentBalance']:.3g}."
        )

        plane = json.loads(
            (ROOT / "examples" / "plane-stress-tension.json").read_text(
                encoding="utf-8"
            )
        )
        plane["study"]["solver"]["pinn"]["device"] = "cpu"
        devices_path = Path(directory) / "devices"
        devices, _ = completed("devices", plane, devices_path, "bundle-devices")
        require(
            devices["protocolVersion"] == 1
            and devices["status"] == "succeeded"
            and devices["operation"] == "devices"
            and devices["defaultDevice"] == "cpu",
            "Bundled devices response lost its wrapped manifest contract.",
        )
        require(
            isinstance(devices["framework"], str)
            and devices["framework"].startswith("PyTorch "),
            "Missing device framework provenance.",
        )
        capabilities = devices["devices"]
        require(
            isinstance(capabilities, list)
            and {entry["id"] for entry in capabilities} == {"cpu", "mps", "cuda"},
            "Bundled device capabilities are incomplete.",
        )
        for entry in capabilities:
            require(
                type(entry["available"]) is bool
                and entry["precision"] in ("float64", "float32")
                and isinstance(entry["reason"], str)
                and bool(entry["reason"]),
                "Invalid device probe response.",
            )
        require(
            next(entry for entry in capabilities if entry["id"] == "cpu")["available"],
            "Bundled CPU unavailable.",
        )
        methods = devices["capabilities"]
        require(
            methods["schemaVersion"] == 1
            and methods["execution"]
            == {
                "backend": "local-process",
                "jobsPerWorker": 1,
                "cancellation": "terminate-worker",
            }
            and methods["materialModels"] == ["homogeneous-isotropic-linear-elastic"],
            "Bundled runtime misrepresented its execution or material scope.",
        )
        registered = {method["id"]: method for method in methods["methods"]}
        require(
            len(methods["methods"]) == 4
            and set(registered)
            == {
                "fem-solid-tetra4",
                "fem-plane-stress-tri3",
                "pinn-plane-stress-displacement",
                "pinn-plane-stress-energy",
            },
            "Bundled method registry differs from its implemented routes.",
        )
        for method_id in ("fem-solid-tetra4", "fem-plane-stress-tri3"):
            method = registered[method_id]
            require(
                method["kind"] == "fem"
                and method["framework"]
                == ("scikit-fem" if method_id == "fem-plane-stress-tri3" else "scipy")
                and method["operation"] == "solve"
                and method["configuration"] is None
                and len(method["devices"]) == 1
                and method["devices"][0]["id"] == "cpu"
                and method["devices"][0]["precision"] == "float64"
                and method["devices"][0]["available"] is True,
                "Classical FEM falsely declared an accelerated or unavailable device.",
            )
        pinn = registered["pinn-plane-stress-displacement"]
        require(
            pinn["kind"] == "pinn"
            and pinn["dimension"] == "2d"
            and pinn["formulation"] == "plane-stress"
            and pinn["framework"] == "pytorch"
            and pinn["operation"] == "train"
            and pinn["configuration"] == "study.solver.pinn"
            and pinn["devices"] == capabilities,
            "PINN method devices disagree with the actual derivative probe.",
        )
        require(
            not (devices_path / "buffer.bin").exists(),
            "Device probe unexpectedly wrote result arrays.",
        )
        print(
            "Bundled devices passed: "
            + ", ".join(
                f"{v['id']}={v['available']} ({v['precision']})" for v in capabilities
            )
            + "."
        )

        output = Path(directory) / "result-2d-cpu"
        manifest, messages = completed("compare", plane, output, "bundle-2d-cpu")
        errors = check_2d_fields(manifest, output, plane, "compare")
        initial, final = check_training(manifest, messages, plane, "cpu")
        require(
            errors["displacement"] < 2e-10 and errors["stress"] < 2e-10,
            "Bundled 2D FEM axial reference failed.",
        )
        require(
            errors["pinnDisplacement"] < 0.008 and errors["pinnStress"] < 0.008,
            f"Bundled CPU PINN analytical reference failed: {errors}",
        )
        require(
            final < 1e-5 and final < initial * 1e-4,
            "Bundled CPU PINN loss did not converge.",
        )
        require(
            errors["pinnMaxDisplacement"] < 0.02,
            "Bundled PINN maximum displacement failed.",
        )
        energy = 100**2 * 0.1 / (2 * 70e9 * 0.05 * 0.002)
        require(
            math.isclose(manifest["summary"]["strainEnergy"], energy, rel_tol=2e-10),
            "Bundled FEM strain energy does not match the analytical axial reference.",
        )
        require(
            math.isclose(
                manifest["pinnSummary"]["strainEnergy"], energy, rel_tol=0.015
            ),
            "Bundled PINN strain energy does not match the axial reference.",
        )
        require(
            manifest["pinnSummary"]["relativeForceBalance"] < 0.01
            and manifest["pinnSummary"]["relativeMomentBalance"] < 0.001,
            "Bundled learned support tractions fail the tested equilibrium tolerance.",
        )
        require(
            number(manifest["durationSeconds"]) and manifest["durationSeconds"] > 0,
            "Missing measured full-run duration.",
        )
        reopened, _ = completed("validate", plane, output, "bundle-2d-cpu")
        require(
            reopened == manifest, "Bundled 2D comparison reopening changed metadata."
        )
        arrays = read_arrays(manifest, output)
        require(
            all(row[2] == 0 for row in arrays["pinnReactions"]),
            "2D PINN reaction left xy plane.",
        )
        print(
            f"Bundled CPU 2D comparison/cache passed: loss {initial:.6g} → {final:.6g}, "
            f"held-out residual={manifest['training']['validation']['total']:.6g}, "
            f"analytical L2 |u|={errors['pinnDisplacement']:.3%}, stress={errors['pinnStress']:.3%}, "
            f"training={manifest['training']['timings']['trainingSeconds']:.3f}s."
        )

        energy_project = json.loads(
            (ROOT / "examples" / "energy-tension.json").read_text(encoding="utf-8")
        )
        output = Path(directory) / "result-energy-cpu"
        energy_manifest, messages = completed(
            "compare", energy_project, output, "bundle-energy-cpu"
        )
        errors = check_2d_fields(energy_manifest, output, energy_project, "compare")
        check_training(energy_manifest, messages, energy_project, "cpu")
        measured_energy = energy_manifest["training"]["energy"]
        require(
            measured_energy["relativeIntegrationDifference"] <= 0.01
            and measured_energy["history"][-1]["potential"] < 0
            and measured_energy["physicalScale"] > 0,
            "Missing signed energy or independent integration gate.",
        )
        # Independent axial field gates; no residual objective is an accuracy proxy.
        require(
            errors["pinnDisplacement"] < 0.03
            and errors["pinnStress"] < 0.05
            and energy_manifest["pinnSummary"]["relativeForceBalance"] < 0.05,
            f"Bundled energy axial reference failed: {errors}",
        )
        reopened, _ = completed("validate", energy_project, output, "bundle-energy-cpu")
        require(
            reopened == energy_manifest, "Energy cache changed signed measurements."
        )
        energy_project["study"]["solver"]["pinn"]["formulation"] = "strong-form"
        code, messages = invoke("validate", energy_project, output, "bundle-energy-cpu")
        require(
            code != 0 and messages[-1].get("code") == "stale-cache",
            "Formulation change incorrectly reused energy fields.",
        )
        energy_profile = json.loads(
            (ROOT / "examples" / "energy-hole.json").read_text(encoding="utf-8")
        )
        energy_profile["study"]["solver"]["pinn"].update(
            steps=12, interiorPoints=1024, boundaryPoints=32
        )
        output = Path(directory) / "result-energy-profile"
        profile_energy, messages = completed(
            "train", energy_profile, output, "bundle-energy-profile"
        )
        check_training(profile_energy, messages, energy_profile, "cpu")
        read_arrays(profile_energy, output)
        reopened, _ = completed(
            "validate", energy_profile, output, "bundle-energy-profile"
        )
        require(reopened == profile_energy, "Profile energy cache lost provenance.")
        print(
            "Bundled energy rectangle compare/analytical/cache and profile traction training passed."
        )

        if next(entry for entry in capabilities if entry["id"] == "mps")["available"]:
            accelerator = json.loads(json.dumps(plane))
            accelerator["study"]["solver"]["pinn"].update(
                {"device": "mps", "steps": 10}
            )
            output = Path(directory) / "result-2d-mps"
            manifest, messages = completed(
                "train", accelerator, output, "bundle-2d-mps"
            )
            check_2d_fields(manifest, output, accelerator, "train")
            initial, final = check_training(manifest, messages, accelerator, "mps")
            reopened, _ = completed("validate", accelerator, output, "bundle-2d-mps")
            require(
                reopened == manifest, "Bundled MPS cache reopening changed metadata."
            )
            print(
                f"Bundled MPS float32 training/cache passed: 10 steps, finite fields, "
                f"loss {initial:.6g} → {final:.6g}, "
                f"held-out residual={manifest['training']['validation']['total']:.6g}; "
                "short-run accuracy was not asserted."
            )
            accelerator["study"]["solver"]["pinn"]["formulation"] = "potential-energy"
            accelerator["study"]["solver"]["pinn"].update(
                interiorPoints=1024, boundaryPoints=64
            )
            output = Path(directory) / "result-energy-mps"
            energy_mps, messages = completed(
                "train", accelerator, output, "bundle-energy-mps"
            )
            check_2d_fields(energy_mps, output, accelerator, "train")
            check_training(energy_mps, messages, accelerator, "mps")
            reopened, _ = completed(
                "validate", accelerator, output, "bundle-energy-mps"
            )
            require(
                reopened == energy_mps,
                "Energy MPS cache lost measured precision or audit.",
            )
            print(
                "Bundled MPS energy autograd/training/audit/cache passed; short-run accuracy not asserted."
            )
        else:
            print(
                "Bundled MPS unavailable by actual derivative probe; GPU training was not exercised."
            )


if __name__ == "__main__":
    main()
