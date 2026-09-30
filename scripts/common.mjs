import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const python = path.join(
  root,
  '.venv',
  process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python',
);

export function requirePython() {
  if (!existsSync(python))
    throw new Error('Run npm run setup first to install the managed development engine.');
}

export function pythonEnvironment(environment = {}) {
  return { ...process.env, ...environment, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

export function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: root,
      stdio: 'inherit',
      ...options,
      env: pythonEnvironment(options.env),
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(executable)} exited ${signal ?? code}`));
    });
  });
}
