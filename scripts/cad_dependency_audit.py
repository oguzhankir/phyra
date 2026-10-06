"""Validate the pinned CAD wheel and retained source before packaging notices."""

import hashlib
import importlib.metadata
import json
import platform
import sys
import tarfile
from pathlib import Path


def _digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def collect_cad_audit(root: Path) -> dict[str, str]:
    distribution = importlib.metadata.distribution("cadquery-ocp-novtk")
    version = "8.0.1.1.0"
    if distribution.version != version:
        raise RuntimeError("The CAD dependency version differs from the audited pin.")
    architecture = {"AMD64": "x64", "x86_64": "x64", "aarch64": "arm64"}.get(
        platform.machine(), platform.machine()
    )
    target = f"{sys.platform}-{architecture}"
    result = {
        "name": "OCP/OCCT native dependency audit",
        "version": version,
        "target": target,
    }
    provenance_path = root / "notices" / f"ocp-{version}" / f"{target}-provenance.json"
    if not provenance_path.is_file():
        return {
            **result,
            "auditStatus": "unaudited",
            "exactSourceStatus": "unverified",
            "limitation": "Target-specific native source/license audit is pending; development only.",
        }
    provenance = json.loads(provenance_path.read_text())
    native_root = Path(distribution.locate_file("OCP"))
    actual = {
        str(p.relative_to(native_root))
        for p in native_root.rglob("*")
        if p.suffix in (".so", ".dylib", ".dll", ".pyd")
    }
    pinned = {item["path"] for item in provenance["nativeBinaries"]}
    if actual != pinned:
        raise RuntimeError(
            "CAD native dependency inventory differs from the audited wheel."
        )
    for item in provenance["nativeBinaries"]:
        if _digest(native_root / item["path"]) != item["sha256"]:
            raise RuntimeError(
                f"CAD native binary differs from its audited pin: {item['path']}"
            )
    source_pin = root / "scripts" / "cad-sources.lock.json"
    lock = json.loads(source_pin.read_text())
    base = root / "artifacts" / "cad-sources"
    manifest = json.loads((base / f"{target}-manifest.json").read_text())
    expected_name = f"ocp-{version}-{target}-source.tar.gz"
    source = base / expected_name
    if (
        manifest.get("sourceArchive") != expected_name
        or manifest.get("sourcePinSha256") != _digest(source_pin)
        or manifest.get("sourceArchiveSha256") != _digest(source)
    ):
        raise RuntimeError(
            "The retained CAD source artifact differs from its audited pin."
        )
    with tarfile.open(source) as archive:
        for item in lock["sources"]:
            member = archive.extractfile("source-archives/" + item["filename"])
            if (
                member is None
                or hashlib.sha256(member.read()).hexdigest() != item["sha256"]
            ):
                raise RuntimeError(
                    "The CAD source archive is missing a pinned source component."
                )
        for item in lock["nativePackages"]:
            member = archive.extractfile("native-recipes/" + item["infoFilename"])
            if (
                member is None
                or hashlib.sha256(member.read()).hexdigest() != item["infoSha256"]
            ):
                raise RuntimeError(
                    "The CAD source archive is missing an exact native build recipe."
                )
    return {
        **result,
        "auditStatus": "audited",
        "exactSourceStatus": "unverified",
        "sourceProvenanceLimitation": "Upstream macOS pybind11/RapidJSON header patch versions were wildcard-resolved and cannot be established from wheel metadata; retained pinned header sources are rebuild inputs.",
        "nativeBinaryCount": str(len(pinned)),
        "correspondingSource": expected_name,
        "correspondingSourceSha256": manifest["sourceArchiveSha256"],
    }
