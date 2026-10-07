import { describe, expect, it } from 'vitest';
import { discoverWindowsMsvc, selectWindowsMsvc } from './windows-msvc.mjs';

const capabilities = {
  generators: [
    { name: 'Ninja', platformSupport: false },
    { name: 'Visual Studio 17 2022', platformSupport: true },
    {
      name: 'Visual Studio 18 2026',
      platformSupport: true,
      supportedPlatforms: ['Win32', 'x64', 'ARM64'],
    },
  ],
};
const instance = (
  version = '17.14.100.1',
  directory = 'C:\\Program Files\\Microsoft Visual Studio\\2022\\BuildTools',
) => ({
  installationVersion: version,
  installationPath: directory,
  isComplete: true,
  isLaunchable: true,
});

describe('installed Windows MSVC discovery', () => {
  it('uses the installed VS2022 generator and explicitly fixes MSVC x64 and instance', () => {
    const selected = selectWindowsMsvc(capabilities, [instance()]);
    expect(selected.generator).toBe('Visual Studio 17 2022');
    expect(selected.arguments).toEqual([
      '-G',
      'Visual Studio 17 2022',
      '-A',
      'x64',
      `-DCMAKE_GENERATOR_INSTANCE:STRING=${instance().installationPath}`,
    ]);
  });
  it('uses an advertised newer generator when no VS2022 instance exists', () => {
    const selected = selectWindowsMsvc(capabilities, [instance('18.1.100.1', 'D:\\VS BuildTools')]);
    expect(selected.generator).toBe('Visual Studio 18 2026');
    expect(selected.installationVersion).toBe('18.1.100.1');
  });
  it('retains an older compatible instance when CMake does not support the newest installed VS', () => {
    const selected = selectWindowsMsvc({ generators: capabilities.generators.slice(0, 2) }, [
      instance('18.1.100.1', 'D:\\Newer'),
      instance(),
    ]);
    expect(selected.generator).toBe('Visual Studio 17 2022');
  });
  it('compares actual installation versions numerically and isolates changed build caches', () => {
    const first = instance('17.9.100.1', 'C:\\VS');
    const second = instance('17.10.100.1', 'C:\\VS');
    const selected = selectWindowsMsvc(capabilities, [first, second]);
    expect(selected.installationVersion).toBe('17.10.100.1');
    expect(selected.cacheKey).not.toBe(selectWindowsMsvc(capabilities, [first]).cacheKey);
    expect(selected.cacheKey).toBe(selectWindowsMsvc(capabilities, [second]).cacheKey);
    expect(selected.cacheKey).not.toBe(
      selectWindowsMsvc(capabilities, [instance('17.10.100.1', 'D:\\VS')]).cacheKey,
    );
  });
  it('rejects incomplete instances, unsupported x64 generators and incompatible CMake without guessing', () => {
    for (const installations of [
      [],
      [instance('19.0.100.1')],
      [{ ...instance(), isComplete: false }],
      [{ ...instance(), isPrerelease: true }],
      [instance('17.1', 'relative')],
    ])
      expect(() => selectWindowsMsvc(capabilities, installations)).toThrow(
        'No installed MSVC x64 instance',
      );
    expect(() =>
      selectWindowsMsvc(
        {
          generators: [
            { name: 'Visual Studio 17 2022', platformSupport: true, supportedPlatforms: ['ARM64'] },
          ],
        },
        [instance()],
      ),
    ).toThrow();
    expect(() => selectWindowsMsvc({}, [instance()])).toThrow('invalid metadata');
  });
  it('queries the installed discovery tool with component filtering, all compatible versions and UTF8', async () => {
    const calls = [];
    const selected = await discoverWindowsMsvc(
      async (executable, arguments_, options) => {
        calls.push({ executable, arguments_, options });
        return {
          stdout:
            executable === 'cmake'
              ? JSON.stringify(capabilities)
              : '\uFEFF' + JSON.stringify([instance()]),
        };
      },
      { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    );
    expect(selected.generator).toBe('Visual Studio 17 2022');
    expect(calls[0].arguments_).toEqual(['-E', 'capabilities']);
    expect(calls[1].executable).toBe(
      'C:\\Program Files (x86)\\Microsoft Visual Studio\\Installer\\vswhere.exe',
    );
    expect(calls[1].arguments_).toEqual([
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-format',
      'json',
      '-utf8',
    ]);
    expect(calls[1].options.encoding).toBe('utf8');
  });
  it('uses the known PATH command only when the Installer copy is absent', async () => {
    const calls = [];
    await discoverWindowsMsvc(
      async (executable) => {
        calls.push(executable);
        if (executable.endsWith('Installer\\vswhere.exe'))
          throw Object.assign(new Error('absent'), { code: 'ENOENT' });
        return { stdout: JSON.stringify(executable === 'cmake' ? capabilities : [instance()]) };
      },
      { 'ProgramFiles(x86)': 'C:\\Program Files (x86)' },
    );
    expect(calls).toContain('vswhere.exe');
  });
  it('preserves actual discovery tool failures rather than falling back to a guessed toolchain', async () => {
    await expect(
      discoverWindowsMsvc(async (executable) => {
        if (executable !== 'cmake')
          throw Object.assign(new Error('discovery failed'), { code: 87 });
        return { stdout: JSON.stringify(capabilities) };
      }, {}),
    ).rejects.toThrow('discovery failed');
  });
});
