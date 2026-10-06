"""Retain notices from the exact distributions incorporated in this build."""

import ast
import decimal
import hashlib
import importlib.metadata
import json
import platform
import pyexpat
import shutil
import ssl
import sys
import sysconfig
from pathlib import Path

import tomllib
from cad_dependency_audit import collect_cad_audit

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / "src-tauri" / "resources" / "licenses"
if DESTINATION.exists():
    shutil.rmtree(DESTINATION)
DESTINATION.mkdir(parents=True, exist_ok=True)


def copy_file(source: Path, relative: Path) -> None:
    destination = DESTINATION / relative
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, destination)


copy_file(ROOT / "LICENSE", Path("Phyra-GPL-3.0.txt"))
for source in (ROOT / "notices").rglob("*"):
    if source.is_file():
        copy_file(source, Path("phyra") / source.relative_to(ROOT / "notices"))

inventory: dict[str, list[dict[str, str]]] = {
    "python": [],
    "frontend": [],
    "rust": [],
    "native": [],
}
inventory["native"].append(collect_cad_audit(ROOT))
sketch_pin = json.loads((ROOT / "scripts" / "sketch-solver.lock.json").read_text())
architecture = {"aarch64": "arm64", "AMD64": "x64", "x86_64": "x64"}.get(
    platform.machine(), platform.machine()
)
sketch_target = f"{sys.platform}-{architecture}"
sketch_root = ROOT / "artifacts" / "sketch-solver" / sketch_target
sketch_manifest = json.loads((sketch_root / "manifest.json").read_text())
if any(sketch_manifest.get(key) != value for key, value in sketch_pin.items()):
    raise RuntimeError("The packaged sketch solver does not match its pinned source")
if (
    hashlib.sha256((sketch_root / sketch_manifest["filename"]).read_bytes()).hexdigest()
    != sketch_manifest["sha256"]
):
    raise RuntimeError("The packaged sketch solver failed its provenance check")
sketch_source = (
    ROOT
    / "artifacts"
    / "sketch-solver"
    / f"solvespace-{sketch_pin['version']}-{sketch_target}-corresponding-source.tar.gz"
)
if not sketch_source.is_file():
    raise RuntimeError("The sketch solver Corresponding Source artifact is missing")
for source in (sketch_root / "notices").iterdir():
    if source.is_file():
        copy_file(source, Path("native") / "sketch-solver" / source.name)
inventory["native"].append(
    {
        "name": "SolveSpace libslvs with pinned Eigen/mimalloc",
        "version": sketch_pin["version"],
        "revision": sketch_pin["revision"],
        "target": sketch_target,
        "sha256": sketch_manifest["sha256"],
        "correspondingSource": sketch_source.name,
        "correspondingSourceSha256": hashlib.sha256(
            sketch_source.read_bytes()
        ).hexdigest(),
    }
)
inventory["python"].append(
    {
        "name": "Python",
        "version": platform.python_version(),
        "opensslVersion": ssl.OPENSSL_VERSION,
        "decimalLibraryVersion": decimal.__libmpdec_version__,
        "expatVersion": pyexpat.EXPAT_VERSION,
    }
)
# This checked-in asset subset is not a runtime npm dependency.
provider_assets = ROOT / "public" / "providers"
for name in ("LICENSE", "NOTICE"):
    copy_file(
        provider_assets / name, Path("frontend") / "lobehub-provider-icons" / name
    )
inventory["frontend"].append(
    {
        "name": "@lobehub/icons-static-svg (selected assets)",
        "version": "1.95.1",
        "license": "MIT",
    }
)
names = [
    "cadquery-ocp-novtk",
    "cadquery-ocp-proxy",
    "gmsh",
    "numpy",
    "scipy",
    "scikit-fem",
    "jsonschema",
    "jsonschema-specifications",
    "attrs",
    "referencing",
    "rpds-py",
    "typing_extensions",
    "pyinstaller",
    "torch",
    "filelock",
    "fsspec",
    "Jinja2",
    "MarkupSafe",
    "mpmath",
    "networkx",
    "sympy",
]
for name in names:
    distribution = importlib.metadata.distribution(name)
    inventory["python"].append({"name": name, "version": distribution.version})
    for member in distribution.files or []:
        if any(
            token in member.name.upper()
            for token in ("LICENSE", "COPYING", "NOTICE", "CREDITS")
        ):
            source = Path(distribution.locate_file(member)).resolve()
            if source.is_file():
                safe_parts = [part for part in member.parts if part not in ("..", ".")]
                copy_file(source, Path("python") / name / Path(*safe_parts))

python_license = Path(sysconfig.get_path("stdlib")) / "LICENSE.txt"
if not python_license.is_file():
    # Standard python.org Windows installations place the notice by python.exe.
    # A virtual environment's config "base" points to the venv, not the selected
    # underlying interpreter. Keep its original distribution notice unchanged.
    python_license = Path(sys.base_prefix) / "LICENSE.txt"
if not python_license.is_file():
    raise RuntimeError(
        "The selected Python distribution is missing its license notice."
    )
copy_file(python_license, Path("python") / "Python-LICENSE.txt")

# PyInstaller's generated analysis identifies the actual native source files.
# Homebrew Python can pull in additional non-system libraries not represented
# by Python wheel metadata; retain their keg notices and precise versions.
analysis_file = ROOT / "artifacts" / "pyinstaller" / "engine" / "Analysis-00.toc"
if analysis_file.is_file():
    analysis = ast.literal_eval(analysis_file.read_text(encoding="utf-8"))
    copied_kegs = set()
    for section in analysis:
        if not isinstance(section, list):
            continue
        for entry in section:
            if not isinstance(entry, tuple) or len(entry) != 3 or entry[2] != "BINARY":
                continue
            native = Path(entry[1]).resolve()
            keg = next(
                (
                    ancestor
                    for ancestor in native.parents
                    if (ancestor / "INSTALL_RECEIPT.json").is_file()
                ),
                None,
            )
            if keg is None or keg in copied_kegs:
                continue
            copied_kegs.add(keg)
            receipt = json.loads(
                (keg / "INSTALL_RECEIPT.json").read_text(encoding="utf-8")
            )
            name = keg.parent.name
            version = receipt["source"]["versions"]["stable"]
            inventory["native"].append({"name": name, "version": version})
            for notice in keg.iterdir():
                if notice.is_file() and any(
                    token in notice.name.upper()
                    for token in ("LICENSE", "COPYING", "COPYRIGHT", "NOTICE")
                ):
                    copy_file(
                        notice, Path("native") / f"{name}-{version}" / notice.name
                    )

lock = json.loads((ROOT / "package-lock.json").read_text(encoding="utf-8"))
for location, package in lock.get("packages", {}).items():
    if not location or not location.startswith("node_modules/"):
        continue
    source_directory = ROOT / location
    package_json = source_directory / "package.json"
    if not package_json.is_file():
        continue
    metadata = json.loads(package_json.read_text(encoding="utf-8"))
    name = metadata.get("name", location.removeprefix("node_modules/"))
    inventory["frontend"].append(
        {
            "name": name,
            "version": package.get("version", "unknown"),
            "license": str(metadata.get("license", "unrecorded")),
        }
    )
    for source in source_directory.iterdir():
        if source.is_file() and any(
            token in source.name.upper() for token in ("LICENSE", "COPYING", "NOTICE")
        ):
            copy_file(source, Path("frontend") / name / source.name)

cargo_lock = ROOT / "src-tauri" / "Cargo.lock"
if cargo_lock.is_file():
    registry = Path.home() / ".cargo" / "registry" / "src"
    for package in tomllib.loads(cargo_lock.read_text(encoding="utf-8")).get(
        "package", []
    ):
        name, version = package["name"], package["version"]
        if not package.get("source", "").startswith("registry+"):
            continue
        inventory["rust"].append({"name": name, "version": version})
        matches = list(registry.glob(f"*/{name}-{version}"))
        if not matches:
            raise RuntimeError(
                f"Missing resolved Rust source for notices: {name}-{version}"
            )
        for source in matches[0].iterdir():
            if source.is_file() and any(
                token in source.name.upper()
                for token in ("LICENSE", "COPYING", "NOTICE")
            ):
                copy_file(source, Path("rust") / f"{name}-{version}" / source.name)

(DESTINATION / "resolved-dependencies.json").write_text(
    json.dumps(inventory, indent=2) + "\n", encoding="utf-8"
)
print(f"Collected resolved notices in {DESTINATION}")
