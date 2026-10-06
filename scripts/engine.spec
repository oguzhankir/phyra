# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path
import sys

import gmsh
from PyInstaller.utils.hooks import (
    collect_data_files,
    collect_dynamic_libs,
    copy_metadata,
)

root = Path(SPECPATH).parent
target = {"darwin": "darwin", "win32": "win32", "linux": "linux"}[sys.platform]
machine = __import__("platform").machine().lower()
architecture = "arm64" if machine in ("arm64", "aarch64") else "x64"
library = (
    "slvs.dll"
    if target == "win32"
    else "libslvs.3.2.dylib"
    if target == "darwin"
    else "libslvs.so.3.2"
)
sketch_solver = (
    root / "artifacts" / "sketch-solver" / f"{target}-{architecture}" / library
)
if not sketch_solver.is_file():
    raise RuntimeError(
        "Run npm run setup to build the pinned sketch solver before packaging"
    )
analysis = Analysis(
    [str(root / "engine" / "entry.py")],
    pathex=[str(root / "engine")],
    binaries=[(gmsh.libpath, "."), (str(sketch_solver), "sketch_solver")]
    + collect_dynamic_libs("OCP"),
    datas=[(str(root / "contracts"), "contracts")]
    + collect_data_files("jsonschema_specifications")
    + copy_metadata("cadquery-ocp-novtk"),
    # The adapter imports its scikit-fem API statically. Optional IO, supermesh
    # and visualization modules are not collected as runtime capabilities.
    hiddenimports=["OCP.OCP"],
    excludes=["tkinter", "matplotlib", "IPython", "pytest"],
    noarchive=False,
)
archive = PYZ(analysis.pure)
executable = EXE(
    archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name="phyra-engine",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)
bundle = COLLECT(
    executable, analysis.binaries, analysis.datas, strip=False, upx=False, name="engine"
)
