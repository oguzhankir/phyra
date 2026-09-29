import path from 'node:path';
import { root, run } from './common.mjs';

await run(process.execPath, [path.join(root, 'scripts/package-engine.mjs')]);
await run(
  process.execPath,
  [path.join(root, 'node_modules/@tauri-apps/cli/tauri.js'), 'build', '--ci'],
  {
    // Noninteractive DMG creation avoids Finder automation in terminal/CI builds.
    env: process.platform === 'darwin' ? { ...process.env, CI: 'true' } : process.env,
  },
);
