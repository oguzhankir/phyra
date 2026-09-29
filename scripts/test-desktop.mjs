import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const executable = path.resolve(
  process.argv[2] ??
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
const child = spawn(executable, ['--verify-workflow'], {
  cwd: process.env.TEMP ?? '/tmp',
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
}, 90000);
const code = await new Promise((resolve, reject) => {
  child.on('error', reject);
  child.on('exit', resolve);
}).finally(() => clearTimeout(timer));
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/desktop-runtime.log', `${output}\n${diagnostic}`);
const location = output.match(/PHYRA_VERIFICATION (.+)/)?.[1]?.trim();
if (!location)
  throw new Error(
    `Desktop workflow ${timedOut ? 'timed out after 90 seconds' : `exited ${code}`} without a report: ${output} ${diagnostic}`,
  );
const report = JSON.parse(await readFile(location, 'utf8'));
if (report.error) throw new Error(`Desktop workflow failed: ${report.error}`);
if (code !== 0) throw new Error(`Desktop workflow exited ${code}: ${output} ${diagnostic}`);
const renderer = report.renderer;
if (
  !renderer ||
  renderer.renderedTriangles !== report.manifest?.statistics.surfaceTriangles ||
  renderer.pickedRegion !== 'x1' ||
  !Number.isFinite(renderer.probedValue) ||
  renderer.probedIndex < 0 ||
  !renderer.drawingBuffer?.every((value) => value > 0) ||
  Math.abs(renderer.fieldMaximum - report.manifest.summary.maxDisplacement) >
    1e-12 * report.manifest.summary.maxDisplacement
) {
  throw new Error(`Actual renderer/field/picking verification failed: ${JSON.stringify(renderer)}`);
}
const stress = report.stressRenderer;
if (
  !stress ||
  stress.association !== 'cell' ||
  stress.pickedRegion !== 'x1' ||
  !Number.isFinite(stress.probedValue) ||
  stress.deformationScale !== renderer.deformationScale ||
  renderer.deformationScale !== 1 ||
  Math.abs(stress.fieldMaximum - report.manifest.summary.maxVonMises) >
    1e-12 * report.manifest.summary.maxVonMises
)
  throw new Error('Actual cell stress mapping or independent deformation scale failed');
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
if (renderer.viewportPng?.startsWith('data:image/png;base64,')) {
  await writeFile(
    'artifacts/packaged-viewport.png',
    Buffer.from(renderer.viewportPng.split(',')[1], 'base64'),
  );
  delete renderer.viewportPng;
}
await writeFile('artifacts/desktop-verification.json', JSON.stringify(report, null, 2));
console.log(
  `Desktop workflow passed: ${report.manifest.statistics.nodes} nodes, ${report.manifest.statistics.cells} cells; renderer ${JSON.stringify(report.renderer ?? report.viewport ?? {})}; native save/reopen and worker cleanup passed.`,
);
