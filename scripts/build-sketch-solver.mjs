import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { root, run, python, requirePython } from './common.mjs';
import { discoverWindowsMsvc } from './windows-msvc.mjs';

// Build only the constraint C ABI. No GUI, CAD scripting interpreter, system
// Eigen, OpenMP runtime or user-selected executable enters the application.
const execute = promisify(execFile);
const pinPath = path.join(root, 'scripts/sketch-solver.lock.json');
const pin = JSON.parse(await fs.readFile(pinPath, 'utf8'));
const targets = {
  'darwin-arm64': 'libslvs.3.2.dylib',
  'win32-x64': 'slvs.dll',
  'linux-x64': 'libslvs.so.3.2',
};
const target = `${process.platform}-${process.arch}`;
const filename = targets[target];
if (!filename) throw new Error(`No managed sketch solver build is defined for ${target}.`);
requirePython();
const base = path.join(root, 'artifacts/sketch-solver');
const source = path.join(base, 'source');
const windows = process.platform === 'win32' ? await discoverWindowsMsvc(execute) : null;
const build = path.join(base, `build-${target}${windows ? `-vs-${windows.cacheKey}` : ''}`);
const output = path.join(base, target);
await fs.mkdir(base, { recursive: true });

async function git(args, cwd = source) {
  return (await execute('git', args, { cwd, maxBuffer: 8 * 1024 * 1024 })).stdout.trim();
}
async function exists(filename) {
  try {
    await fs.access(filename);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
if (!(await exists(source))) {
  await run('git', [
    'clone',
    '--no-checkout',
    '--depth',
    '1',
    '--branch',
    `v${pin.version}`,
    pin.repository,
    source,
  ]);
  await run('git', ['checkout', '--detach', pin.revision], { cwd: source });
}
if ((await git(['rev-parse', 'HEAD'])) !== pin.revision)
  throw new Error(
    'Managed SolveSpace source has a different revision. Preserve it and move it aside before rebuilding.',
  );
if (await git(['status', '--porcelain', '--untracked-files=no']))
  throw new Error(
    'Managed SolveSpace source has local changes. Preserve them and move the source aside before rebuilding.',
  );
for (const submodule of pin.submodules) {
  if ((await git(['rev-parse', `HEAD:${submodule.path}`])) !== submodule.revision)
    throw new Error(`SolveSpace source pin disagrees with ${submodule.path}.`);
}
await run(
  'git',
  ['submodule', 'update', '--init', '--depth', '1', ...pin.submodules.map((item) => item.path)],
  { cwd: source },
);
for (const submodule of pin.submodules) {
  const directory = path.join(source, submodule.path);
  if (
    (await git(['rev-parse', 'HEAD'], directory)) !== submodule.revision ||
    (await git(['status', '--porcelain', '--untracked-files=no'], directory))
  )
    throw new Error(`Managed ${submodule.path} source is not the exact clean pin.`);
}

const arguments_ = [
  '-S',
  source,
  '-B',
  build,
  '-DCMAKE_BUILD_TYPE=Release',
  '-DENABLE_GUI=OFF',
  '-DENABLE_CLI=OFF',
  '-DENABLE_TESTS=OFF',
  '-DENABLE_PYTHON_LIB=OFF',
  '-DENABLE_OPENMP=OFF',
  '-DENABLE_LTO=OFF',
  '-DFORCE_VENDORED_Eigen3=ON',
  '-DMI_OPT_ARCH=OFF',
  '-DMI_NO_OPT_ARCH=ON',
];
if (process.platform === 'darwin')
  arguments_.push(
    `-DCMAKE_OSX_ARCHITECTURES=${process.arch}`,
    `-DCMAKE_OSX_DEPLOYMENT_TARGET=${pin.macosMinimum}`,
  );
if (windows) arguments_.push(...windows.arguments);
await run('cmake', arguments_, { cwd: source });
await run(
  'cmake',
  ['--build', build, '--target', 'slvs', '--config', 'Release', '--parallel', '4'],
  { cwd: source },
);
const binary = path.join(
  build,
  'bin',
  ...(process.platform === 'win32' ? ['Release'] : []),
  filename,
);
if (process.platform === 'darwin') {
  const [buildInfo, dependencies] = await Promise.all([
    execute('xcrun', ['vtool', '-show-build', binary]),
    execute('otool', ['-L', binary]),
  ]);
  if (!buildInfo.stdout.includes(`minos ${pin.macosMinimum}`))
    throw new Error('Sketch library does not declare the pinned macOS minimum.');
  const linked = dependencies.stdout
    .split('\n')
    .slice(1)
    .filter((line) => line.trim())
    .map((line) => line.trim().split(' (')[0]);
  if (
    linked.some(
      (name) =>
        name !== '@rpath/libslvs.1.dylib' &&
        !name.startsWith('/usr/lib/') &&
        !name.startsWith('/System/Library/'),
    )
  )
    throw new Error(`Sketch library links an unbundled developer dependency: ${linked.join(', ')}`);
}
await fs.mkdir(output, { recursive: true });
await fs.copyFile(binary, path.join(output, filename));
const digest = createHash('sha256')
  .update(await fs.readFile(path.join(output, filename)))
  .digest('hex');
const manifest = { ...pin, target, filename, sha256: digest };
await fs.writeFile(path.join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

// A distributable source artifact contains full pinned source trees, upstream
// notices and a documented revision-stamp patch so it rebuilds without Git.
const exported = await fs.mkdtemp(path.join(base, `corresponding-source-${target}-`));
for (const item of [{ path: '.', revision: pin.revision }, ...pin.submodules]) {
  const tar = path.join(base, `${item.path.replaceAll('/', '-')}-source.tar`);
  await run('git', ['archive', '--format=tar', '-o', tar, item.revision], {
    cwd: path.join(source, item.path),
  });
  const destination = path.join(exported, item.path);
  await fs.mkdir(destination, { recursive: true });
  await run(python, [
    '-c',
    'import pathlib,sys,tarfile; destination=pathlib.Path(sys.argv[2]); archive=tarfile.open(sys.argv[1]); archive.extractall(destination, filter="data")',
    tar,
    destination,
  ]);
  await fs.unlink(tar);
}
const cmakeFile = path.join(exported, 'CMakeLists.txt');
const cmake = await fs.readFile(cmakeFile, 'utf8');
if (!cmake.includes('include(GetGitCommitHash)'))
  throw new Error('Pinned source revision-stamp location changed.');
await fs.writeFile(
  cmakeFile,
  cmake.replace('include(GetGitCommitHash)', `set(GIT_COMMIT_HASH ${pin.revision})`),
);
await fs.copyFile(pinPath, path.join(exported, 'PHYRA-SOURCE-PIN.json'));
await fs.copyFile(
  path.join(root, 'scripts/build-sketch-solver.mjs'),
  path.join(exported, 'PHYRA-build-sketch-solver.mjs'),
);
await fs.copyFile(path.join(root, 'scripts/common.mjs'), path.join(exported, 'common.mjs'));
await fs.copyFile(
  path.join(root, 'scripts/windows-msvc.mjs'),
  path.join(exported, 'windows-msvc.mjs'),
);
await fs.writeFile(
  path.join(exported, 'PHYRA-REBUILD.txt'),
  `This artifact contains the complete SolveSpace ${pin.version} source and the exact Eigen and mimalloc submodule sources used for ${target}.\n` +
    `Original SolveSpace commit: ${pin.revision}\n` +
    'Export-only modification: CMakeLists.txt replaces include(GetGitCommitHash) with its exact revision constant. No numerical source was modified.\n' +
    'PHYRA-build-sketch-solver.mjs and its helper files record Phyra’s repository build pipeline. Use the CMake commands below to rebuild this standalone source tree.\n' +
    (windows
      ? `Windows build selected ${windows.generator}; Visual Studio installation version ${windows.installationVersion}, MSVC x64 components.\n`
      : '') +
    'With CMake >=3.18 and a C/C++ compiler, configure this directory using:\n' +
    `cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DENABLE_GUI=OFF -DENABLE_CLI=OFF -DENABLE_TESTS=OFF -DENABLE_PYTHON_LIB=OFF -DENABLE_OPENMP=OFF -DENABLE_LTO=OFF -DFORCE_VENDORED_Eigen3=ON -DMI_OPT_ARCH=OFF -DMI_NO_OPT_ARCH=ON${process.platform === 'darwin' ? ' -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=14.0' : windows ? ` -G "${windows.generator}" -A x64` : ''}\n` +
    'cmake --build build --target slvs --config Release --parallel 4\n' +
    'Retain COPYING.txt and all extlib notice files when redistributing this source or its binary. Phyra source and the ctypes adapter are provided separately with the application source.\n',
);
await fs.copyFile(
  path.join(output, 'manifest.json'),
  path.join(exported, 'PHYRA-BUILD-MANIFEST.json'),
);
const archive = path.join(base, `solvespace-${pin.version}-${target}-corresponding-source.tar.gz`);
await run(python, [
  '-c',
  'import sys,tarfile; archive=tarfile.open(sys.argv[1],"w:gz"); archive.add(sys.argv[2],arcname="solvespace-source"); archive.close()',
  archive,
  exported,
]);
const noticeDirectory = path.join(output, 'notices');
await fs.mkdir(noticeDirectory, { recursive: true });
for (const [from, to] of [
  ['COPYING.txt', 'SolveSpace-COPYING.txt'],
  ['extlib/mimalloc/LICENSE', 'mimalloc-LICENSE.txt'],
  ['extlib/eigen/COPYING.README', 'Eigen-COPYING.README'],
  ['extlib/eigen/COPYING.MPL2', 'Eigen-COPYING.MPL2'],
  ['extlib/eigen/COPYING.BSD', 'Eigen-COPYING.BSD'],
  ['extlib/eigen/COPYING.APACHE', 'Eigen-COPYING.APACHE'],
  ['extlib/eigen/COPYING.MINPACK', 'Eigen-COPYING.MINPACK'],
  ['extlib/eigen/COPYING.LGPL', 'Eigen-COPYING.LGPL'],
  ['extlib/eigen/COPYING.GPL', 'Eigen-COPYING.GPL'],
])
  await fs.copyFile(path.join(source, from), path.join(noticeDirectory, to));
await fs.copyFile(
  path.join(output, 'manifest.json'),
  path.join(noticeDirectory, 'build-manifest.json'),
);
console.log(`Built managed sketch solver: ${path.join(output, filename)}`);
console.log(`Corresponding Source: ${archive}`);
