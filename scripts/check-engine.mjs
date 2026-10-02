import { python, requirePython, run } from './common.mjs';

requirePython();
await run(python, ['scripts/check-engine-boundaries.py']);
await run(python, ['-m', 'ruff', 'check', 'engine', 'scripts']);
await run(python, ['-m', 'ruff', 'format', '--check', 'engine', 'scripts']);
await run(python, ['-m', 'mypy', 'engine/phyra_engine']);
