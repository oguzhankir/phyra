import { createHash } from 'node:crypto';
import path from 'node:path';

// CMake advertises the generators it actually supports; vswhere filters for
// installed MSVC x86/x64 tools. Do not infer a toolset from a runner's OS name.
// https://cmake.org/cmake/help/latest/manual/cmake.1.html#cmdoption-cmake-E-arg-capabilities
// https://github.com/microsoft/vswhere/wiki/Find-VC
export function selectWindowsMsvc(capabilities, installations) {
  if (!Array.isArray(capabilities?.generators) || !Array.isArray(installations))
    throw new Error('CMake or Visual Studio discovery returned invalid metadata.');
  const generators = new Map();
  for (const generator of capabilities.generators) {
    const match = /^Visual Studio (\d+) \d{4}$/.exec(generator?.name ?? '');
    if (
      match &&
      generator.platformSupport === true &&
      (generator.supportedPlatforms === undefined ||
        (Array.isArray(generator.supportedPlatforms) &&
          generator.supportedPlatforms.includes('x64')))
    )
      generators.set(Number(match[1]), generator.name);
  }
  const matches = [];
  for (const installation of installations) {
    const version = installation?.installationVersion;
    const directory = installation?.installationPath;
    if (
      typeof version !== 'string' ||
      !/^\d+(?:\.\d+){1,3}$/.test(version) ||
      typeof directory !== 'string' ||
      !path.win32.isAbsolute(directory) ||
      /[\0\r\n,]/.test(directory) ||
      installation.isComplete === false ||
      installation.isLaunchable === false ||
      installation.isPrerelease === true
    )
      continue;
    const parts = version.split('.').map(Number);
    const generator = generators.get(parts[0]);
    if (generator && parts.every(Number.isSafeInteger))
      matches.push({ generator, installationPath: directory, installationVersion: version, parts });
  }
  matches.sort((first, second) => {
    for (let index = 0; index < 4; index++) {
      const difference = (second.parts[index] ?? 0) - (first.parts[index] ?? 0);
      if (difference) return difference;
    }
    const firstPath = first.installationPath.toLowerCase();
    const secondPath = second.installationPath.toLowerCase();
    return firstPath < secondPath ? -1 : firstPath > secondPath ? 1 : 0;
  });
  if (!matches.length)
    throw new Error(
      'No installed MSVC x64 instance matches a Visual Studio generator supported by this CMake. Install the MSVC x86/x64 build tools and use a CMake version that supports the installed Visual Studio.',
    );
  const { parts: _, ...selected } = matches[0];
  // A generator/instance cannot safely change within an existing CMake cache.
  // Preserve earlier build trees and isolate every discovered installation.
  // https://cmake.org/cmake/help/latest/variable/CMAKE_GENERATOR_INSTANCE.html
  const cacheKey = createHash('sha256')
    .update(
      JSON.stringify([
        selected.generator,
        selected.installationPath.toLowerCase(),
        selected.installationVersion,
      ]),
    )
    .digest('hex')
    .slice(0, 16);
  return {
    ...selected,
    cacheKey,
    arguments: [
      '-G',
      selected.generator,
      '-A',
      'x64',
      `-DCMAKE_GENERATOR_INSTANCE:STRING=${selected.installationPath}`,
    ],
  };
}

export async function discoverWindowsMsvc(execute, environment = process.env) {
  const candidates = [
    ...new Set(
      [environment['ProgramFiles(x86)'], environment.ProgramFiles]
        .filter((directory) => typeof directory === 'string' && path.win32.isAbsolute(directory))
        .map((directory) =>
          path.win32.join(directory, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe'),
        ),
    ),
  ];
  candidates.push('vswhere.exe');
  const options = { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 };
  const arguments_ = [
    '-products',
    '*',
    '-requires',
    'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
    '-format',
    'json',
    '-utf8',
  ];
  const instances = async () => {
    for (const executable of candidates) {
      try {
        return await execute(executable, arguments_, options);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    throw new Error(
      'Visual Studio discovery requires the installed vswhere.exe from Visual Studio Installer.',
    );
  };
  const [capabilities, installations] = await Promise.all([
    execute('cmake', ['-E', 'capabilities'], options),
    instances(),
  ]);
  const json = (output) => JSON.parse(output.stdout.replace(/^\uFEFF/, ''));
  return selectWindowsMsvc(json(capabilities), json(installations));
}
