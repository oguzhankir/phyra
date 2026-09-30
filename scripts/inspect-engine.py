"""Inspect bundled Mach-O deployment versions and developer-path dependencies."""

import argparse
import json
import platform
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINE = ROOT / "src-tauri" / "resources" / "engine"


def inspect() -> dict:
    if sys.platform != "darwin":
        return {"platform": sys.platform, "minimumMacOS": None}
    highest = (0, 0)
    seen = set()
    binaries = []
    magic = {
        b"\xfe\xed\xfa\xce",
        b"\xce\xfa\xed\xfe",
        b"\xfe\xed\xfa\xcf",
        b"\xcf\xfa\xed\xfe",
        b"\xca\xfe\xba\xbe",
        b"\xbe\xba\xfe\xca",
    }
    for path in ENGINE.rglob("*"):
        if not path.is_file() or path.resolve() in seen:
            continue
        seen.add(path.resolve())
        with path.open("rb") as source:
            if source.read(4) not in magic:
                continue
        build = subprocess.run(
            ["/usr/bin/vtool", "-show-build", str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
        versions = re.findall(r"\bminos\s+(\d+(?:\.\d+)+)", build.stdout)
        if not versions:
            raise RuntimeError(
                f"Cannot inspect deployment minimum: {path.relative_to(ENGINE)}"
            )
        minimum = max(
            tuple(int(part) for part in version.split(".")) for version in versions
        )
        highest = max(highest, minimum)
        libraries = subprocess.run(
            ["/usr/bin/otool", "-L", str(path)],
            capture_output=True,
            text=True,
            check=True,
        )
        for line in libraries.stdout.splitlines()[1:]:
            dependency = line.strip().split(" (compatibility", 1)[0]
            if dependency.startswith("/") and not dependency.startswith(
                ("/System/", "/usr/lib/")
            ):
                raise RuntimeError(
                    f"Bundle retains external developer dependency: {dependency}"
                )
        architectures = subprocess.run(
            ["/usr/bin/lipo", "-archs", str(path)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.split()
        if platform.machine() not in architectures:
            raise RuntimeError(
                f"Bundle lacks {platform.machine()} architecture: {path.relative_to(ENGINE)}"
            )
        binaries.append(
            {
                "path": str(path.relative_to(ENGINE)),
                "minimumMacOS": ".".join(map(str, minimum)),
                "architectures": architectures,
            }
        )
    if not binaries:
        raise RuntimeError("No bundled Mach-O engine binaries were found.")
    return {
        "platform": "darwin",
        "minimumMacOS": ".".join(map(str, highest)),
        "binaries": binaries,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--max-macos-version")
    arguments = parser.parse_args()
    report = inspect()
    if report["minimumMacOS"] and arguments.max_macos_version:
        actual = tuple(map(int, report["minimumMacOS"].split(".")))
        limit = tuple(map(int, arguments.max_macos_version.split(".")))
        if actual + (0,) * (3 - len(actual)) > limit + (0,) * (3 - len(limit)):
            raise RuntimeError(
                f"Bundled runtime requires macOS {report['minimumMacOS']}; "
                f"the configured target is {arguments.max_macos_version}. "
                "Recreate .venv using the official Python 3.12 distribution."
            )
    artifact = ROOT / "artifacts" / "engine-platform.json"
    artifact.parent.mkdir(parents=True, exist_ok=True)
    artifact.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "platform": report["platform"],
                "minimumMacOS": report["minimumMacOS"],
                "inspectedBinaries": len(report.get("binaries", [])),
            }
        )
    )
