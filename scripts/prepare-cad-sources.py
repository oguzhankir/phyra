"""Prepare source-pinned CAD redistribution artifacts during contributor setup."""

import gzip
import hashlib
import io
import json
import platform
import sys
import tarfile
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PIN_PATH = ROOT / "scripts" / "cad-sources.lock.json"
PIN = json.loads(PIN_PATH.read_text())
TARGET = f"{sys.platform}-{platform.machine()}"
if TARGET != PIN["target"]:
    print(
        f"CAD native redistribution source audit is pending for {TARGET}; development remains enabled."
    )
    sys.exit(0)

BASE = ROOT / "artifacts" / "cad-sources"
DOWNLOADS = BASE / "downloads"
DOWNLOADS.mkdir(parents=True, exist_ok=True)


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def obtain(item: dict[str, str]) -> tuple[dict[str, str], Path]:
    destination = DOWNLOADS / item["filename"]
    if not destination.is_file():
        request = urllib.request.Request(
            item["url"], headers={"User-Agent": "Phyra-source-build"}
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(128 * 1024 * 1024 + 1)
        if len(data) > 128 * 1024 * 1024 or digest(data) != item["sha256"]:
            raise RuntimeError(
                f"CAD source download differs from its pin: {item['filename']}"
            )
        destination.write_bytes(data)
    if digest(destination.read_bytes()) != item["sha256"]:
        raise RuntimeError(
            f"Preserve and move aside the changed managed source: {destination}"
        )
    return item, destination


def add_bytes(archive: tarfile.TarFile, name: str, data: bytes) -> None:
    member = tarfile.TarInfo(name)
    member.size, member.mode, member.mtime = len(data), 0o644, 0
    archive.addfile(member, io.BytesIO(data))


with ThreadPoolExecutor(4) as source_downloads:
    inputs = list(
        source_downloads.map(obtain, [*PIN["sources"], *PIN["nativePackages"]])
    )
archive_name = f"ocp-{PIN['version']}-{TARGET}-source.tar.gz"
destination = BASE / archive_name
temporary = destination.with_suffix(".tmp")
with (
    temporary.open("wb") as raw,
    gzip.GzipFile(filename="", fileobj=raw, mode="wb", mtime=0) as compressed,
    tarfile.open(fileobj=compressed, mode="w") as archive,
):
    for item, source in inputs:
        if "infoFilename" in item:
            # Preserve the original complete recipes (patches, CMake files and
            # headers), without embedding conda's unrelated executable payload.
            with zipfile.ZipFile(source) as package:
                data = package.read(item["infoFilename"])
            if digest(data) != item["infoSha256"]:
                raise RuntimeError("The native dependency recipe differs from its pin.")
            add_bytes(archive, "native-recipes/" + item["infoFilename"], data)
        else:
            add_bytes(
                archive, "source-archives/" + item["filename"], source.read_bytes()
            )
    add_bytes(archive, "PHYRA-SOURCE-PIN.json", PIN_PATH.read_bytes())
    add_bytes(
        archive,
        "PHYRA-REBUILD.txt",
        (
            b"This artifact retains OCCT 8.0.1, OCP 8.0.1.1 generator/configuration sources and "
            b"the official generated macOS C++ bindings, exact build-system recipes, "
            b"FreeImage 3.18.0 and LibRaw 0.22.2 sources, and all 20 matching conda native recipes.\n"
            b"Extract source-archives with tar/unzip and native-recipes with tar --zstd "
            b"(or zstd followed by tar). Recipe info/recipe contains original build scripts, "
            b"CMake files, configuration headers and every upstream patch.\n"
            b"Use ocp-build-system .github/actions/build-occt-sdk/action.yml and "
            b"build-ocp/action.yml with use-vtk=novtk and Python 3.12. The OCCT source patch "
            b"is under patches/occt-8.0.1. FreeImage and LibRaw use their matching native "
            b"recipes, including FreeImage's unbundling patches and LibRaw-cmake source.\n"
            b"The upstream macOS recipe did not pin patch versions of pybind11/rapidjson "
            b"headers. Included pybind11 2.13.6 and RapidJSON 1.1.0 are pinned rebuild inputs; "
            b"their exact use in the upstream binary cannot be established from wheel metadata.\n"
            b"Other native recipes retain upstream source URLs and hashes. LLVM libc++ is a "
            b"separate Apache-2.0 WITH LLVM-exception compiler runtime. Binary/text matches "
            b"and original notices are in notices/ocp-8.0.1.1.0 of the Phyra application source.\n"
            b"The upstream CAD numerical sources are retained unchanged; recipes record upstream build patches. "
            b"Complete Phyra source and build scripts accompany application redistribution. "
            b"Users may modify/rebuild the libraries and application under the included licenses.\n"
        ),
    )
temporary.replace(destination)
manifest = {
    "version": PIN["version"],
    "target": TARGET,
    "sourceArchive": archive_name,
    "sourceArchiveSha256": digest(destination.read_bytes()),
    "sourcePinSha256": digest(PIN_PATH.read_bytes()),
}
(BASE / f"{TARGET}-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Prepared CAD source artifact: {destination}")
