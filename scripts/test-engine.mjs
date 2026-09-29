import { python, requirePython, run } from './common.mjs';

requirePython();
const args = process.argv.slice(2);
if (!args.includes('-m')) args.unshift('-m', 'not slow');
await run(python, ['-m', 'pytest', '-c', 'engine/pyproject.toml', 'engine/tests', ...args]);
