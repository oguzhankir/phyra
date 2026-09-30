import path from 'node:path';
import { root, run } from './common.mjs';
import { packageMacOS } from './package-macos.mjs';

await run(process.execPath, [path.join(root, 'scripts/package-engine.mjs')]);
const tauri = path.join(root, 'node_modules/@tauri-apps/cli/tauri.js');
if (process.platform === 'darwin') {
  // Restore native dependency aliases before making the development disk image.
  await run(process.execPath, [tauri, 'build', '--ci', '--bundles', 'app', '--no-sign']);
  await packageMacOS();
} else await run(process.execPath, [tauri, 'build', '--ci']);
