import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const arguments_ = process.argv.slice(2);
const only3d = arguments_.includes('--3d-only');
const onlyPhysicsMl = arguments_.includes('--physicsml-only');
const onlyProfile = arguments_.includes('--profile-only');
const onlyEnergy = arguments_.includes('--energy-only');
const onlyCad = arguments_.includes('--cad-only');
if ([only3d, onlyPhysicsMl, onlyProfile, onlyEnergy, onlyCad].filter(Boolean).length > 1)
  throw new Error('Choose one verification mode, or omit the mode flags');
const paths = arguments_.filter((argument) => !argument.startsWith('--'));
if (
  paths.length > 1 ||
  arguments_.some(
    (argument) =>
      argument.startsWith('--') &&
      !['--3d-only', '--physicsml-only', '--profile-only', '--energy-only', '--cad-only'].includes(
        argument,
      ),
  )
)
  throw new Error(
    'Usage: npm run test:desktop -- [executable] [--3d-only|--physicsml-only|--profile-only|--energy-only|--cad-only]',
  );
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

function assertRenderer(renderer, manifest, association, expectedRegion = 'x1') {
  if (
    !renderer ||
    renderer.renderedTriangles !== manifest.statistics.surfaceTriangles ||
    renderer.association !== association ||
    !expectedRegion ||
    renderer.pickedRegion !== expectedRegion ||
    !manifest.regions.some((region) => region.id === expectedRegion) ||
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

function assertPhysicsMl(report, energyMode) {
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
    !report.trainingCancellation ||
    !report.export?.comparisonTables ||
    training.configuration?.formulation !== (energyMode ? 'potential-energy' : 'strong-form')
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
  if (energyMode) {
    const energy = training.energy;
    if (
      report.project.study.solver.pinn.formulation !== 'potential-energy' ||
      training.device !== 'cpu' ||
      training.precision !== 'float64' ||
      !report.persistence.energyMatches ||
      !energy ||
      energy.schemaVersion !== 1 ||
      ['definition', 'trainingQuadrature', 'auditQuadrature'].some(
        (key) => typeof energy[key] !== 'string' || !energy[key].length,
      ) ||
      !Number.isInteger(energy.interiorPoints) ||
      energy.interiorPoints < 1 ||
      !Number.isInteger(energy.boundaryPoints) ||
      energy.boundaryPoints < 1 ||
      !Number.isFinite(energy.physicalScale) ||
      energy.physicalScale <= 0 ||
      !Number.isFinite(energy.relativeIntegrationDifference) ||
      energy.relativeIntegrationDifference < 0 ||
      energy.relativeIntegrationDifference > 0.01 ||
      !Array.isArray(energy.history) ||
      energy.history.length !== training.history.length ||
      !(energy.audit?.potential < 0)
    )
      throw new Error('Energy objective, integration audit or archive provenance was not verified');
    for (const [index, measurement] of [...energy.history, energy.audit].entries()) {
      if (
        !measurement ||
        ['potential', 'strain', 'work'].some((key) => !Number.isFinite(measurement[key])) ||
        measurement.strain < 0 ||
        Math.abs(measurement.potential - (measurement.strain - measurement.work)) >
          16 *
            Number.EPSILON *
            Math.max(Math.abs(measurement.strain), Math.abs(measurement.work), Number.MIN_VALUE) ||
        (index < energy.history.length && measurement.step !== training.history[index].step)
      )
        throw new Error('Energy history does not preserve signed potential and physical work');
    }
    const last = energy.history.at(-1);
    const difference =
      Math.abs(last.potential - energy.audit.potential) /
      Math.max(Math.abs(energy.audit.strain), Math.abs(energy.audit.work), Number.MIN_VALUE);
    assertMaximum(
      energy.relativeIntegrationDifference,
      difference,
      'Energy integration difference',
    );
  }
}

async function verify(mode) {
  const cad = mode === 'cad';
  const energy = mode === '2d-energy';
  const physicsMl = mode === '2d-compare' || energy;
  const profile = mode === '2d-profile';
  const timeoutMs = physicsMl ? 270000 : cad ? 420000 : 90000;
  const child = spawn(
    executable,
    [
      cad
        ? '--verify-cad'
        : profile
          ? '--verify-profile'
          : energy
            ? '--verify-energy'
            : physicsMl
              ? '--verify-physicsml'
              : '--verify-workflow',
    ],
    {
      cwd: tmpdir(),
      env: environment,
    },
  );
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
  const prefix = cad
    ? 'desktop-cad'
    : profile
      ? 'desktop-profile'
      : energy
        ? 'desktop-energy'
        : physicsMl
          ? 'desktop-physicsml'
          : 'desktop';
  await writeFile(`artifacts/${prefix}-runtime.log`, `${output}\n${diagnostic}`);
  const location = output.match(/PHYRA_VERIFICATION (.+)/)?.[1]?.trim();
  if (!location)
    throw new Error(
      `${mode} workflow ${timedOut ? `timed out after ${timeoutMs / 1000} seconds` : `exited ${code}`} without a report: ${output} ${diagnostic}`,
    );
  const report = JSON.parse(await readFile(location, 'utf8'));
  await writeFile(`artifacts/${prefix}-verification.json`, JSON.stringify(report, null, 2));
  if (report.error)
    throw new Error(
      `${mode} workflow failed: ${report.error}; native trace: ${JSON.stringify(report.nativeTrace)}`,
    );
  if (code !== 0) throw new Error(`${mode} workflow exited ${code}: ${output} ${diagnostic}`);
  if (
    !report.manifest ||
    !report.persistence?.projectMatches ||
    !report.persistence?.manifestMatches ||
    !report.persistence?.bufferMatches ||
    !report.workerStopped ||
    !report.repeatedRun ||
    !report.cancellation ||
    !report.staleResultRejected ||
    !report.export?.physicalUnits ||
    !report.export?.provenance
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
    report.engineCapabilities?.schemaVersion !== 2
  )
    throw new Error('Native recovery or implemented-method capability verification failed');
  assertRenderer(
    report.renderer,
    report.manifest,
    'node',
    cad ? report.cad?.expectedPickedRegion : 'x1',
  );
  assertRenderer(
    report.stressRenderer,
    report.manifest,
    'cell',
    cad ? report.cad?.expectedPickedRegion : 'x1',
  );
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
  if (
    profile &&
    (report.project.geometry.kind !== 'profile' ||
      !report.manifest.reference ||
      !report.export.independentReference)
  )
    throw new Error('Profile geometry, independent reference or export was not verified');
  if (physicsMl) assertPhysicsMl(report, energy);
  else if (report.manifest.operation !== 'solve')
    throw new Error('Classical verification did not return a solve');
  if (
    cad &&
    (report.project.geometry.kind !== 'cad' ||
      !report.cad?.emptyStart ||
      !report.cad?.commandInputsBlocked ||
      !report.cad?.commandPreviewIsolated ||
      !report.cad?.commandCancelPreserved ||
      !report.cad?.commandApplyOnce ||
      !report.cad?.openSketchSolved ||
      !report.cad?.evaluated ||
      !report.cad?.sourcePreserved ||
      !report.cad?.unsupportedBlocked ||
      !report.cad?.undoPreserved ||
      !report.cad?.meshGenerated ||
      !report.cad?.inspectionGenerated ||
      !report.cad?.inspectionPreservedCad ||
      !report.cad?.inspectionInvalidated ||
      !report.cad?.inspectionCorrespondence ||
      !report.cad?.inspectionUi ||
      !report.cad?.inspectionSelectionIsolated ||
      !report.cad?.generalPreparation ||
      !report.cad?.generalStaleSourceGate ||
      !report.cad?.generalAssignments ||
      !report.cad?.generalMesh ||
      !report.cad?.generalSolve ||
      report.project.study?.domain?.kind !== 'cad-solid' ||
      !report.cad?.previewRendered ||
      !report.cad?.rendererReused ||
      !report.cad?.exportIntegrity ||
      !report.cad?.advancedPersistence ||
      !Array.isArray(report.cad?.advanced) ||
      report.cad.advanced.length !== 4 ||
      report.cad.advanced.some(
        (item) => !item.rendered || !item.unsupportedBlocked || !Number.isFinite(item.volume),
      ) ||
      report.cad?.cancellation !== true)
  )
    throw new Error(
      'CAD authoring, compatibility, rendering, exact export or worker cancellation verification failed',
    );
  if (report.renderer.viewportPng?.startsWith('data:image/png;base64,')) {
    await writeFile(
      `artifacts/packaged-${cad ? 'cad-' : profile ? 'profile-' : energy ? 'energy-' : physicsMl ? 'physicsml-' : ''}viewport.png`,
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
if (!onlyPhysicsMl && !onlyProfile && !onlyEnergy && !onlyCad) await verify('3d');
if (!only3d && !onlyProfile && !onlyEnergy && !onlyCad) await verify('2d-compare');
if (!only3d && !onlyPhysicsMl && !onlyEnergy && !onlyCad) await verify('2d-profile');
if (!only3d && !onlyPhysicsMl && !onlyProfile && !onlyCad) await verify('2d-energy');
if (!only3d && !onlyPhysicsMl && !onlyProfile && !onlyEnergy) await verify('cad');
