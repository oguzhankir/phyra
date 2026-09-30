import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { python, requirePython, root, run } from './common.mjs';

// Real local CPU results for the read-only browser viewer. Seeds reproduce
// numerical fields; execution identities, timestamps and timings remain real.
requirePython();
const limit = 1024 * 1024;
const destination = path.join(root, 'public/reference');
await mkdir(path.join(root, 'artifacts'), { recursive: true });
const staging = await mkdtemp(path.join(root, 'artifacts/reference-'));
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function worker(operation, project, directory, jobId) {
  const request = { protocolVersion: 1, operation, jobId, project };
  const frames = await new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, 'engine/entry.py'), '--output', directory], {
      cwd: root,
      env: {
        ...process.env,
        OMP_NUM_THREADS: '1',
        OPENBLAS_NUM_THREADS: '1',
        MKL_NUM_THREADS: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let failure;
    const timer = setTimeout(() => {
      failure = new Error('Reference worker exceeded its three-minute budget.');
      child.kill();
    }, 180000);
    child.stdout.on('data', (bytes) => {
      stdout += bytes.toString();
      if (Buffer.byteLength(stdout) > 4 * limit) {
        failure = new Error('Reference worker exceeded its bounded protocol output.');
        child.kill();
      }
    });
    child.stderr.on('data', (bytes) => {
      stderr = (stderr + bytes.toString()).slice(-262144);
    });
    child.on('error', reject);
    child.stdin.on('error', reject);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        if (failure) throw failure;
        const events = stdout.trim().split('\n').map(JSON.parse);
        const error = events.find((event) => event.type === 'error');
        if (code !== 0 || error)
          throw new Error(error?.message || 'Reference worker failed: ' + stderr);
        if (events.length > 2048) throw new Error('Too many reference protocol frames.');
        for (const event of events)
          if (event.type !== 'complete' && event.jobId !== jobId)
            throw new Error('Reference progress has the wrong execution owner.');
        const completed = events.filter((event) => event.type === 'complete');
        if (completed.length !== 1 || events.at(-1).type !== 'complete')
          throw new Error('Reference worker did not complete once.');
        resolve(completed[0].manifest);
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
  if (
    frames.projectId !== project.id ||
    frames.studyId !== project.study.id ||
    frames.revision !== project.revision ||
    frames.status !== 'succeeded' ||
    (operation !== 'validate' && frames.jobId !== jobId)
  )
    throw new Error('Reference result does not belong to its immutable project.');
  return frames;
}

try {
  const records = {};
  const files = [];
  for (const [key, name, example, operation] of [
    ['3d', 'three-dimensional', 'cantilever', 'solve'],
    ['2d-compare', 'plane-stress-comparison', 'plane-stress-tension', 'compare'],
  ]) {
    const project = JSON.parse(await readFile(path.join(root, 'examples', example + '.json')));
    if (operation === 'compare') {
      project.study.solver.kind = 'pinn';
      Object.assign(project.study.solver.pinn, {
        layers: 2,
        width: 16,
        steps: 2000,
        interiorPoints: 128,
        boundaryPoints: 32,
        device: 'cpu',
      });
    }
    const projectBytes = Buffer.from(JSON.stringify(project, null, 2) + '\n');
    const directory = path.join(staging, name);
    await mkdir(directory);
    await writeFile(path.join(directory, 'project.json'), projectBytes);
    const manifest = await worker(operation, project, directory, randomUUID());
    await worker('validate', project, directory, randomUUID());
    const manifestBytes = await readFile(path.join(directory, 'manifest.json'));
    const buffer = await readFile(path.join(directory, 'buffer.bin'));
    if (
      manifest.device !== 'cpu' ||
      manifest.byteLength !== buffer.length ||
      manifest.bufferHash !== digest(buffer) ||
      (operation === 'compare' && manifest.training.precision !== 'float64')
    )
      throw new Error('Reference data is not validated CPU float64 output.');
    const record = { sha256: {} };
    for (const [kind, suffix, bytes] of [
      ['project', '.project.json', projectBytes],
      ['manifest', '.manifest.json', manifestBytes],
      ['buffer', '.bin', buffer],
    ]) {
      const filename = name + suffix;
      record[kind] = '/reference/' + filename;
      record.sha256[kind] = digest(bytes);
      files.push({ filename, bytes });
    }
    records[key] = record;
    console.log(
      name +
        ': real CPU float64 ' +
        operation +
        ', ' +
        manifest.statistics.nodes +
        ' nodes, ' +
        manifest.statistics.cells +
        ' cells; cache validated.',
    );
  }
  // Independent analytical axial reference, physical balances and typed-buffer
  // bounds complement the production cache validator; no training labels.
  const physicalChecks = [
    'import importlib.util, json, math, pathlib, sys',
    'p = pathlib.Path(sys.argv[1])',
    'spec = importlib.util.spec_from_file_location("smoke", p / "scripts/smoke-engine.py")',
    'checks = importlib.util.module_from_spec(spec); spec.loader.exec_module(checks)',
    'stage = pathlib.Path(sys.argv[2])',
    'a = stage / "three-dimensional"',
    'm = json.loads((a / "manifest.json").read_text())',
    'checks.read_arrays(m, a)',
    's = m["summary"]',
    'assert all(s[k] <= 1e-8 for k in ("relativeResidual", "relativeForceBalance", "relativeMomentBalance"))',
    'assert max(abs(v-e) for v,e in zip(s["totalForce"], [0,0,-100])) < 1e-8',
    'assert max(abs(v-e) for v,e in zip(s["totalReaction"], [0,0,100])) < 1e-8',
    'b = stage / "plane-stress-comparison"',
    'm = json.loads((b / "manifest.json").read_text())',
    'project = json.loads((b / "project.json").read_text())',
    'errors = checks.check_2d_fields(m, b, project, "compare")',
    'assert errors["displacement"] < 1e-10 and errors["stress"] < 1e-10',
    'assert all(errors[k] < 0.008 for k in ("pinnDisplacement", "pinnStress", "pinnMaxDisplacement"))',
    'assert m["training"]["history"][-1]["step"] == 2000',
    'assert m["training"]["history"][-1]["total"] < m["training"]["history"][0]["total"]',
    'print("Analytical 2D field errors:", json.dumps(errors, sort_keys=True))',
  ].join('\n');
  await run(python, ['-c', physicalChecks, root, staging]);
  const index = Buffer.from(JSON.stringify(records, null, 2) + '\n');
  const total = files.reduce((sum, file) => sum + file.bytes.length, index.length);
  if (total >= limit) throw new Error('Reference assets exceed the cumulative 1 MiB limit.');
  await mkdir(destination, { recursive: true });
  for (const { filename, bytes } of files) await writeFile(path.join(destination, filename), bytes);
  await writeFile(path.join(destination, 'index.json'), index);
  console.log('Validated reference assets: ' + total + ' bytes in public/reference.');
} finally {
  await rm(staging, { recursive: true, force: true });
}
