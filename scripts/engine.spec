# SPDX-License-Identifier: GPL-3.0-or-later
from pathlib import Path

import gmsh
from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH).parent
analysis = Analysis(
    [str(root / 'engine' / 'entry.py')],
    pathex=[str(root / 'engine')],
    binaries=[(gmsh.libpath, '.')],
    datas=[(str(root / 'contracts'), 'contracts')] + collect_data_files('jsonschema_specifications'),
    # The adapter imports its scikit-fem API statically. Optional IO, supermesh
    # and visualization modules are not collected as runtime capabilities.
    hiddenimports=[],
    excludes=['tkinter', 'matplotlib', 'IPython', 'pytest'],
    noarchive=False,
)
archive = PYZ(analysis.pure)
executable = EXE(
    archive,
    analysis.scripts,
    [],
    exclude_binaries=True,
    name='phyra-engine',
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
bundle = COLLECT(executable, analysis.binaries, analysis.datas, strip=False, upx=False, name='engine')
