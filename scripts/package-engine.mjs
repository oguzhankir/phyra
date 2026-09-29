import path from 'node:path';
import { python, requirePython, root, run } from './common.mjs';

requirePython();
await run('cargo', ['fetch', '--manifest-path', 'src-tauri/Cargo.toml', '--locked']);
await run(
  python,
  [
    '-m',
    'PyInstaller',
    '--noconfirm',
    '--clean',
    '--distpath',
    'src-tauri/resources',
    '--workpath',
    'artifacts/pyinstaller',
    'scripts/engine.spec',
  ],
  {
    env: { ...process.env, PYINSTALLER_CONFIG_DIR: path.join(root, 'artifacts/pyinstaller-cache') },
  },
);
await run(python, ['scripts/inspect-engine.py', '--max-macos-version', '14.0']);
await run(python, ['scripts/collect-notices.py']);
await run(python, ['scripts/smoke-engine.py']);
