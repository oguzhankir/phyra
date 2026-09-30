import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const arguments_ = process.argv.slice(2);
const only3d = arguments_.includes('--3d-only');
const onlyPhysicsMl = arguments_.includes('--physicsml-only');
if (only3d && onlyPhysicsMl) throw new Error('Choose one verification mode, or omit both flags');
const paths = arguments_.filter((argument) => !argument.startsWith('--'));
if (
  paths.length > 1 ||
  arguments_.some(
    (argument) =>
      argument.startsWith('--') && !['--3d-only', '--physicsml-only'].includes(argument),
  )
)
  throw new Error('Usage: npm run test:desktop -- [executable] [--3d-only|--physicsml-only]');
const executable = path.resolve(
  paths[0] ??
    (process.platform === 'win32'
      ? 'src-tauri/target/release/phyra.exe'
      : 'src-tauri/target/release/bundle/macos/Phyra.app/Contents/MacOS/phyra'),
);
const environment = { ...process.env };
delete environment.PYTHONPATH;
delete environment.PYTHONHOME;
delete environment.VIRTUAL_ENV;
environment.PATH =
  process.platform === 'win32'
    ? `${process.env.WINDIR}\\System32;${process.env.WINDIR}`
    : '/usr/bin:/bin:/usr/sbin:/sbin';

function assertRenderer(renderer, manifest, association) {
  if (
    !renderer ||
    renderer.renderedTriangles !== manifest.statistics.surfaceTriangles ||
    renderer.association !== association ||
    renderer.pickedRegion !== 'x1' ||
    !Number.isFinite(renderer.probedValue) ||
    !Number.isInteger(renderer.probedIndex) ||
    renderer.probedIndex < 0 ||
    !renderer.drawingBuffer?.every((value) => Number.isFinite(value) && value > 0) ||
    !Number.isFinite(renderer.fieldMaximum) ||
    renderer.fieldMaximum < 0 ||
    renderer.deformationScale !== 1
  )
    throw new Error(
      `Actual renderer/field/picking verification failed: ${JSON.stringify(renderer)}`,
    );
}

function assertMaximum(actual, expected, description) {
  if (
    !Number.isFinite(expected) ||
    Math.abs(actual - expected) > 1e-12 * Math.max(Math.abs(expected), Number.MIN_VALUE)
  )
    throw new Error(`${description} does not match the authoritative result`);
}

function assertPhysicsMl(report) {
  const manifest = report.manifest;
  if (
    manifest.operation !== 'compare' ||
    manifest.dimension !== '2d' ||
    manifest.formulation !== 'plane-stress' ||
    manifest.cellType !== 'triangle3'
  )
    throw new Error('Packaged Physics ML did not return the requested planar comparison');
  assertRenderer(report.pinnRenderer, manifest, 'node');
  assertRenderer(report.differenceRenderer, manifest, 'node');
  const training = manifest.training;
  const metrics = report.metrics;
  if (
    !training ||
    !Array.isArray(training.history) ||
    training.history.length < 2 ||
    !metrics ||
    !Number.isInteger(metrics.count) ||
    metrics.count < 2 ||
    metrics.first?.jobId !== manifest.jobId ||
    metrics.last?.jobId !== manifest.jobId ||
    metrics.last?.step !== report.project.study.solver.pinn.steps ||
    !report.trainingCancellation
  )
    throw new Error(
      'Real training metrics, final step, or running-training cancellation was not verified',
    );
  let previousStep = -1;
  let previousElapsed = -1;
  for (const metric of training.history) {
    if (
      !Number.isInteger(metric.step) ||
      metric.step <= previousStep ||
      metric.step > report.project.study.solver.pinn.steps ||
      !Number.isFinite(metric.elapsed) ||
      metric.elapsed < previousElapsed ||
      ['total', 'pde', 'boundary'].some(
        (name) => !Number.isFinite(metric[name]) || metric[name] < 0,
      ) ||
      metric.device !== training.device
    )
      throw new Error('Stored training history has invalid losses, elapsed time, steps, or device');
    previousStep = metric.step;
    previousElapsed = metric.elapsed;
  }
  if (
    previousStep !== metrics.last.step ||
    !['cpu', 'mps', 'cuda'].includes(training.device) ||
    !['float64', 'float32'].includes(training.precision)
  )
    throw new Error('Stored and streamed training provenance disagree');
  const comparison = manifest.comparison;
  if (
    !comparison ||
    typeof comparison.mapping !== 'string' ||
    !comparison.mapping ||
    comparison.device !== training.device
  )
    throw new Error('Missing measured comparison mapping and device');
  for (const name of ['displacement', 'stress', 'vonMises']) {
    const metric = comparison[name];
    if (
      !metric ||
      !Number.isFinite(metric.maxAbsolute) ||
      metric.maxAbsolute < 0 ||
      !Number.isFinite(metric.referenceNorm) ||
      metric.referenceNorm < 0 ||
      (metric.relativeL2 !== null && (!Number.isFinite(metric.relativeL2) || metric.relativeL2 < 0))
    )
      throw new Error(`Invalid measured ${name} comparison`);
  }
  assertMaximum(
    report.differenceRenderer.fieldMaximum,
    comparison.displacement.maxAbsolute,
    'Mapped displacement difference maximum',
  );
  for (const name of ['femSeconds', 'trainingSeconds', 'inferenceSeconds'])
    if (!Number.isFinite(comparison[name]) || comparison[name] < 0)
      throw new Error('Invalid measured solver timings');
}

async function verify(mode) {
  const physicsMl = mode === '2d-compare';
  const timeoutMs = physicsMl ? 270000 : 90000;
  const child = spawn(executable, [physicsMl ? '--verify-physicsml' : '--verify-workflow'], {
    cwd: tmpdir(),
    env: environment,
  });
  let output = '';
  let diagnostic = '';
  let timedOut = false;
  child.stdout.on('data', (bytes) => {
    output += bytes.toString();
    process.stdout.write(bytes);
  });
  child.stderr.on('data', (bytes) => {
    diagnostic += bytes.toString();
    process.stderr.write(bytes);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, timeoutMs);
  const code = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', resolve);
  }).finally(() => clearTimeout(timer));
  const prefix = physicsMl ? 'desktop-physicsml' : 'desktop';
  await writeFile(`artifacts/${prefix}-runtime.log`, `${output}\n${diagnostic}`);
  const location = output.match(/PHYRA_VERIFICATION (.+)/)?.[1]?.trim();
  if (!location)
    throw new Error(
      `${mode} workflow ${timedOut ? `timed out after ${timeoutMs / 1000} seconds` : `exited ${code}`} without a report: ${output} ${diagnostic}`,
    );
  const report = JSON.parse(await readFile(location, 'utf8'));
  if (report.error) throw new Error(`${mode} workflow failed: ${report.error}`);
  if (code !== 0) throw new Error(`${mode} workflow exited ${code}: ${output} ${diagnostic}`);
  if (
    !report.manifest ||
    !report.persistence?.projectMatches ||
    !report.persistence?.manifestMatches ||
    !report.persistence?.bufferMatches ||
    !report.workerStopped ||
    !report.repeatedRun ||
    !report.cancellation
  )
    throw new Error('Native persistence or owned-worker verification failed');
  if (
    !report.recovery?.projectMatches ||
    !report.recovery?.activeSessionProtected ||
    !report.recovery?.closedSessionOffered ||
    !report.recovery?.lateWriteRejected ||
    !report.recovery?.reloadSessionOffered ||
    !report.recovery?.supersededRequestsRejected ||
    !report.recovery?.newClientSequenceAccepted ||
    report.recovery?.resultsIncluded !== false ||
    report.engineCapabilities?.schemaVersion !== 1
  )
    throw new Error('Native recovery or implemented-method capability verification failed');
  assertRenderer(report.renderer, report.manifest, 'node');
  assertRenderer(report.stressRenderer, report.manifest, 'cell');
  assertMaximum(
    report.renderer.fieldMaximum,
    report.manifest.summary.maxDisplacement,
    'Displacement maximum',
  );
  assertMaximum(
    report.stressRenderer.fieldMaximum,
    report.manifest.summary.maxVonMises,
    'Stress maximum',
  );
  if (physicsMl) assertPhysicsMl(report);
  else if (report.manifest.operation !== 'solve')
    throw new Error('Classical verification did not return a solve');
  if (report.renderer.viewportPng?.startsWith('data:image/png;base64,')) {
    await writeFile(
      `artifacts/packaged-${physicsMl ? 'physicsml-' : ''}viewport.png`,
      Buffer.from(report.renderer.viewportPng.split(',')[1], 'base64'),
    );
    delete report.renderer.viewportPng;
  }
  await writeFile(`artifacts/${prefix}-verification.json`, JSON.stringify(report, null, 2));
  console.log(
    `${mode} desktop workflow passed: ${report.manifest.statistics.nodes} nodes, ${report.manifest.statistics.cells} cells; actual renderer, native save/reopen and owned-worker cleanup passed.`,
  );
}

await mkdir('artifacts', { recursive: true });
if (!onlyPhysicsMl) await verify('3d');
if (!only3d) await verify('2d-compare');
