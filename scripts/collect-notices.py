"""Retain notices from the exact distributions incorporated in this build."""

import ast
import decimal
import importlib.metadata
import json
import platform
import pyexpat
import shutil
import ssl
import sysconfig
from pathlib import Path

import tomllib

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
inventory["python"].append(
    {
        "name": "Python",
        "version": platform.python_version(),
        "opensslVersion": ssl.OPENSSL_VERSION,
        "decimalLibraryVersion": decimal.__libmpdec_version__,
        "expatVersion": pyexpat.EXPAT_VERSION,
    }
)
names = [
    "gmsh",
    "numpy",
    "scipy",
    "jsonschema",
    "jsonschema-specifications",
    "attrs",
    "referencing",
    "rpds-py",
    "typing_extensions",
    "pyinstaller",
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
    python_license = Path(sysconfig.get_config_var("base")) / "LICENSE.txt"
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
    analysis = ast.literal_eval(analysis_file.read_text())
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
            receipt = json.loads((keg / "INSTALL_RECEIPT.json").read_text())
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

lock = json.loads((ROOT / "package-lock.json").read_text())
for location, package in lock.get("packages", {}).items():
    if not location or not location.startswith("node_modules/"):
        continue
    source_directory = ROOT / location
    package_json = source_directory / "package.json"
    if not package_json.is_file():
        continue
    metadata = json.loads(package_json.read_text())
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
    for package in tomllib.loads(cargo_lock.read_text()).get("package", []):
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
    json.dumps(inventory, indent=2) + "\n"
)
print(f"Collected resolved notices in {DESTINATION}")
