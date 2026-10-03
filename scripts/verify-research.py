"""Measure curated cases through the normal headless API, retaining real evidence.

Case metadata is explanatory provenance, not executable model configuration.
The shared validated SI projects supply geometry, physical inputs and settings.
Outputs stay in ignored artifacts; no success threshold replaces independent tests.
"""

import argparse
import json
import platform
from pathlib import Path
from uuid import uuid4

from phyra_engine.execution.application import RunPlan, execute
from phyra_engine.protocol.request import StudyRequest
from phyra_engine.results.storage import read_cached

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    metadata = json.loads(
        (ROOT / "examples/research-cases.json").read_text(encoding="utf-8")
    )
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "case", nargs="?", choices=[case["id"] for case in metadata["cases"]]
    )
    arguments = parser.parse_args()
    output_root = ROOT / "artifacts" / "research" / uuid4().hex
    records = []
    for case in metadata["cases"]:
        if arguments.case and case["id"] != arguments.case:
            continue
        source = ROOT / "examples" / case["project"]
        # Bundled metadata cannot turn this contributor tool into a file traversal.
        if source.parent != ROOT / "examples" or source.suffix != ".json":
            raise ValueError("Research cases must select a bundled JSON project.")
        for seed in case["seeds"]:
            project = json.loads(source.read_text(encoding="utf-8"))
            project["study"]["solver"]["pinn"].update(seed=seed, device="cpu")
            request = StudyRequest.from_payload(
                {
                    "protocolVersion": 1,
                    "operation": "compare",
                    "jobId": uuid4().hex,
                    "project": project,
                }
            )
            output = output_root / case["id"] / str(seed)
            manifest = execute(RunPlan.prepare(request), output)
            # Exercise the same ownership, training-metadata and field cache checks.
            read_cached(output, project)
            record = {
                "case": case["id"],
                "seed": seed,
                "caseMetadata": case,
                "project": project,
                "platform": platform.platform(),
                "manifest": str(output / "manifest.json"),
                "durationSeconds": manifest["durationSeconds"],
                "versions": manifest["versions"],
                "statistics": manifest["statistics"],
                "comparison": manifest["comparison"],
                "referenceSummary": manifest["summary"],
                "predictionSummary": manifest["pinnSummary"],
                "training": manifest["training"],
                "warnings": manifest["warnings"],
            }
            # The circular-hole case also exercises its independent analytical FEM reference.
            if case["id"] == "energy-hole":
                reference = execute(
                    RunPlan.prepare(
                        StudyRequest.from_payload(
                            {
                                "protocolVersion": 1,
                                "operation": "solve",
                                "jobId": uuid4().hex,
                                "project": project,
                            }
                        )
                    ),
                    output / "reference",
                )
                record["analyticalReference"] = reference.get("reference")
            records.append(record)
            print(f"{case['id']} seed {seed}: {manifest['comparison']}", flush=True)
    output_root.mkdir(parents=True, exist_ok=True)
    evidence = output_root / "measurements.json"
    evidence.write_text(
        json.dumps({"schemaVersion": 1, "records": records}, indent=2, allow_nan=False)
        + "\n",
        encoding="utf-8",
    )
    print(f"Measured evidence: {evidence}")


if __name__ == "__main__":
    main()
