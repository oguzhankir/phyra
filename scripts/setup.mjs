import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { python, run } from './common.mjs';

if (!existsSync(python)) {
  if (process.platform === 'win32') {
    const selected = spawnSync('python', [
      '-c',
      'import sys; sys.exit(sys.version_info[:2] != (3, 12))',
    ]);
    if (selected.status === 0) await run('python', ['-m', 'venv', '.venv']);
    else await run('py', ['-3.12', '-m', 'venv', '.venv']);
  } else if (
    process.platform === 'darwin' &&
    existsSync('/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12')
  ) {
    await run('/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12', [
      '-m',
      'venv',
      '.venv',
    ]);
  } else await run('python3.12', ['-m', 'venv', '.venv']);
}
await run(python, [
  '-c',
  'import sys; assert sys.version_info[:2] == (3, 12), "Phyra development requires Python 3.12"',
]);
await run(python, [
  '-m',
  'pip',
  'install',
  '--disable-pip-version-check',
  '--no-input',
  '-r',
  'engine/requirements-dev.txt',
]);
