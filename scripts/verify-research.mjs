import path from 'node:path';
import { python, requirePython, root, run } from './common.mjs';

requirePython();
await run(python, ['scripts/verify-research.py', ...process.argv.slice(2)], {
  env: { PYTHONPATH: path.join(root, 'engine') },
});
