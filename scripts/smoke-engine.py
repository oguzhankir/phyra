"""Exercise the bundled worker from an unrelated cwd without development Python paths."""

import json
import os
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
        output = Path(directory) / "result"

        def invoke(
            operation: str, selected_project: dict = project
        ) -> tuple[int, list[dict]]:
            request = {
                "protocolVersion": 1,
                "operation": operation,
                "jobId": "bundle-smoke",
                "project": selected_project,
            }
            process = subprocess.run(
                [str(EXECUTABLE), "--output", str(output)],
                input=json.dumps(request).encode(),
                capture_output=True,
                env=env,
                cwd=directory,
                timeout=120,
                check=False,
            )
            try:
                messages = [json.loads(line) for line in process.stdout.splitlines()]
            except json.JSONDecodeError as error:
                raise RuntimeError(
                    f"Bundled stdout was not framed JSON: {process.stdout!r}"
                ) from error
            if process.stderr:
                print(process.stderr.decode(errors="replace"), file=sys.stderr)
            return process.returncode, messages

        code, messages = invoke("solve")
        if code != 0 or not messages or messages[-1].get("type") != "complete":
            raise RuntimeError(f"Bundled solve failed: {messages}")
        manifest = messages[-1]["manifest"]
        if (
            manifest["projectId"] != project["id"]
            or manifest["jobId"] != "bundle-smoke"
        ):
            raise RuntimeError("Bundled worker lost execution identity.")
        summary = manifest["summary"]
        if summary["maxDisplacement"] <= 0 or summary["relativeResidual"] >= 1e-8:
            raise RuntimeError(
                "Bundled mechanics did not produce a valid equilibrium solution."
            )
        if any(
            abs(value - expected) > 2e-9
            for value, expected in zip(summary["totalReaction"], [0, 0, 1], strict=True)
        ):
            raise RuntimeError(
                "Bundled solve reaction does not balance the applied force."
            )
        code, messages = invoke("validate")
        if code != 0 or messages[-1].get("type") != "complete":
            raise RuntimeError(f"Bundled cache validation failed: {messages}")
        changed = json.loads(json.dumps(project))
        changed["study"]["loads"][0]["vector"][2] = -2
        code, messages = invoke("validate", changed)
        if code == 0 or messages[-1].get("code") != "stale-cache":
            raise RuntimeError("Bundled worker accepted stale result provenance.")
        binary = output / "buffer.bin"
        payload = bytearray(binary.read_bytes())
        payload[-1] ^= 1
        binary.write_bytes(payload)
        code, messages = invoke("validate")
        if code == 0 or messages[-1].get("code") != "corrupt-cache":
            raise RuntimeError("Bundled worker accepted corrupt binary data.")
        print(
            f"Bundled worker solve/cache/failure smoke passed: "
            f"{manifest['statistics']['nodes']} nodes, {manifest['statistics']['cells']} cells, "
            f"max |u|={summary['maxDisplacement']:.9g} m, "
            f"relative residual={summary['relativeResidual']:.3g}."
        )


if __name__ == "__main__":
    main()
