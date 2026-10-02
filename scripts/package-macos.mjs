import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { root, run } from './common.mjs';

const sourceEngine = path.join(root, 'src-tauri/resources/engine');
const bundleRoot = path.join(root, 'src-tauri/target/release/bundle');
const application = path.join(bundleRoot, 'macos/Phyra.app');
const bundledEngine = path.join(application, 'Contents/Resources/engine');
const executeFile = promisify(execFile);

function requireContained(base, candidate) {
  const relative = path.relative(base, candidate);
  if (
    !relative ||
    relative.startsWith(`..${path.sep}`) ||
    relative === '..' ||
    path.isAbsolute(relative)
  )
    throw new Error(`Path is outside its owned package directory: ${candidate}`);
}

async function ownedDirectory(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (await fs.realpath(directory)) !== directory)
    throw new Error(`Expected an ordinary owned directory: ${directory}`);
}

async function linksWithin(directory) {
  const links = [];
  async function visit(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const filename = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        const target = await fs.readlink(filename);
        if (!target || target.includes('\\') || path.isAbsolute(target))
          throw new Error(`Native dependency link must be relative: ${filename}`);
        requireContained(directory, path.resolve(path.dirname(filename), target));
        requireContained(directory, await fs.realpath(filename));
        links.push({ relative: path.relative(directory, filename), target });
      } else if (entry.isDirectory()) await visit(filename);
      else if (!entry.isFile()) throw new Error(`Unsupported native resource: ${filename}`);
    }
  }
  await visit(directory);
  return links;
}

async function hash(filename) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filename)) digest.update(chunk);
  return digest.digest('hex');
}

async function equalResource(source, destination) {
  requireContained(sourceEngine, await fs.realpath(source));
  requireContained(bundledEngine, await fs.realpath(destination));
  const [original, copied] = await Promise.all([fs.stat(source), fs.stat(destination)]);
  if (original.isFile() && copied.isFile()) {
    if (
      original.size !== copied.size ||
      (original.mode & 0o111) !== (copied.mode & 0o111) ||
      (await hash(source)) !== (await hash(destination))
    )
      throw new Error(`Copied native resource differs from the selected engine: ${destination}`);
  } else if (original.isDirectory() && copied.isDirectory()) {
    const [sourceNames, copiedNames] = await Promise.all([
      fs.readdir(source),
      fs.readdir(destination),
    ]);
    sourceNames.sort();
    copiedNames.sort();
    if (sourceNames.join('\0') !== copiedNames.join('\0'))
      throw new Error(`Copied native resource directory differs: ${destination}`);
    for (const name of sourceNames)
      await equalResource(path.join(source, name), path.join(destination, name));
  } else throw new Error(`Copied native resource type differs: ${destination}`);
}

export async function restoreEngineLinks() {
  if (process.platform !== 'darwin') throw new Error('This package helper requires macOS.');
  await ownedDirectory(sourceEngine);
  await ownedDirectory(application);
  await ownedDirectory(bundledEngine);
  let signature = '';
  try {
    const { stderr } = await executeFile('/usr/bin/codesign', [
      '--display',
      '--verbose=2',
      application,
    ]);
    signature = stderr;
  } catch (error) {
    if (!error.stderr?.includes('code object is not signed at all')) throw error;
  }
  if (signature.includes('Authority='))
    throw new Error('Refusing to modify a signed release app. Build with --no-sign first.');
  let sealed = false;
  try {
    await fs.lstat(path.join(application, 'Contents/_CodeSignature'));
    sealed = true;
    if (!signature.includes('Signature=adhoc'))
      throw new Error('Refusing to modify a resource-sealed app. Build with --no-sign first.');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const originalLinks = await linksWithin(sourceEngine);
  const existingLinks = await linksWithin(bundledEngine);
  const expected = new Map(originalLinks.map((link) => [link.relative, link.target]));
  for (const link of existingLinks)
    if (expected.get(link.relative) !== link.target)
      throw new Error(`Unexpected existing native dependency link: ${link.relative}`);

  // Tauri duplicates file aliases and may omit directory aliases. Verify the actual target first.
  for (const link of originalLinks) {
    const source = path.join(sourceEngine, link.relative);
    const destination = path.join(bundledEngine, link.relative);
    const canonical = path.relative(sourceEngine, await fs.realpath(source));
    await equalResource(source, path.join(bundledEngine, canonical));
    try {
      await fs.lstat(destination);
      await equalResource(source, destination);
    } catch (error) {
      if (error.code !== 'ENOENT' || !(await fs.stat(source)).isDirectory()) throw error;
    }
  }
  let restored = 0;
  for (const link of originalLinks.sort(
    (a, b) => b.relative.split(path.sep).length - a.relative.split(path.sep).length,
  )) {
    const destination = path.join(bundledEngine, link.relative);
    let copied;
    try {
      copied = await fs.lstat(destination);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (copied?.isSymbolicLink()) continue;
    if (sealed)
      throw new Error('Refusing to change resources in a sealed app. Build with --no-sign first.');
    requireContained(bundledEngine, await fs.realpath(path.dirname(destination)));
    if (copied) await fs.rm(destination, { recursive: copied.isDirectory() });
    await fs.symlink(link.target, destination);
    restored++;
  }
  const restoredLinks = await linksWithin(bundledEngine);
  if (restoredLinks.length !== originalLinks.length)
    throw new Error('The packaged engine does not preserve every native dependency alias.');
  console.log(
    `Restored ${restored} native dependency aliases; ${restoredLinks.length} total verified.`,
  );
  return { application, bundledEngine, links: restoredLinks };
}

export async function signMacOSApplication() {
  await ownedDirectory(application);
  const identity = process.env.APPLE_SIGNING_IDENTITY?.trim();
  if (identity && identity !== '-') {
    const { stdout } = await executeFile('/usr/bin/security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ]);
    const identities = Array.from(stdout.matchAll(/\)\s+([A-Fa-f0-9]{40})\s+"([^"]+)"/g));
    const matched = identities.filter((entry) => entry[1] === identity || entry[2] === identity);
    if (matched.length !== 1)
      throw new Error(
        'APPLE_SIGNING_IDENTITY must identify one valid installed code-signing certificate.',
      );
    const fingerprint = matched[0][1];
    const binaries = [],
      frameworks = [];
    async function visit(directory) {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) {
          await visit(filename);
          if (entry.name.endsWith('.framework')) frameworks.push(filename);
        } else if (entry.isFile()) {
          const file = await fs.open(filename, 'r');
          try {
            const header = Buffer.alloc(4);
            const { bytesRead } = await file.read(header, 0, 4, 0);
            // Mach-O and universal Mach-O; do not infer executable code from filenames.
            if (
              bytesRead === 4 &&
              [
                0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf,
                0xbfbafeca,
              ].includes(header.readUInt32BE())
            )
              binaries.push(filename);
          } finally {
            await file.close();
          }
        }
      }
    }
    await visit(application);
    // Sign owned embedded code before its containing bundle. Never use --deep to sign.
    for (const target of [...binaries, ...frameworks, application])
      await run('/usr/bin/codesign', [
        '--force',
        '--sign',
        fingerprint,
        '--timestamp=none',
        target,
      ]);
    console.log(
      'Signed the application and embedded native code with the configured identity. Notarization is separate.',
    );
  } else {
    await run('/usr/bin/codesign', ['--force', '--sign', '-', '--timestamp=none', application]);
    console.log(
      'Development ad hoc signature: Keychain trust may need renewal after each changed build.',
    );
  }
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', application]);
}

export async function packageMacOS() {
  await restoreEngineLinks();
  await signMacOSApplication();
  const config = JSON.parse(
    await fs.readFile(path.join(root, 'src-tauri/tauri.conf.json'), 'utf8'),
  );
  if (config.productName !== 'Phyra' || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(config.version))
    throw new Error('Unexpected application identity or version for the owned macOS package.');
  const binaries = [
    path.join(application, 'Contents/MacOS/phyra'),
    path.join(bundledEngine, 'phyra-engine'),
  ];
  const architectures = [];
  for (const binary of binaries) {
    const { stdout } = await executeFile('/usr/bin/lipo', ['-archs', binary]);
    const values = stdout.trim().split(/\s+/);
    if (values.length !== 1 || !['arm64', 'x86_64'].includes(values[0]))
      throw new Error(`Unsupported native macOS binary architecture: ${binary}: ${stdout.trim()}`);
    architectures.push(values[0]);
  }
  if (architectures[0] !== architectures[1])
    throw new Error('The macOS application and engine must have matching native architectures.');
  const architecture = { arm64: 'aarch64', x86_64: 'x64' }[architectures[0]];
  const outputDirectory = path.join(bundleRoot, 'dmg');
  await fs.mkdir(outputDirectory, { recursive: true });
  await ownedDirectory(outputDirectory);
  const filename = `Phyra_${config.version}_${architecture}.dmg`;
  const artifactDirectory = path.join(root, 'artifacts');
  await fs.mkdir(artifactDirectory, { recursive: true });
  await ownedDirectory(artifactDirectory);
  const staging = await fs.mkdtemp(path.join(artifactDirectory, 'mac-dmg-'));
  const temporaryImage = path.join(outputDirectory, `.${filename}`);
  try {
    await run('/usr/bin/ditto', [application, path.join(staging, 'Phyra.app')]);
    await fs.symlink('/Applications', path.join(staging, 'Applications'));
    const stagedLinks = await linksWithin(
      path.join(staging, 'Phyra.app/Contents/Resources/engine'),
    );
    const sourceLinks = await linksWithin(sourceEngine);
    if (
      stagedLinks.length !== sourceLinks.length ||
      stagedLinks.some(
        (link) =>
          !sourceLinks.some(
            (original) => original.relative === link.relative && original.target === link.target,
          ),
      )
    )
      throw new Error('Disk image staging did not preserve native dependency aliases.');
    await run('/usr/bin/hdiutil', [
      'create',
      '-srcfolder',
      staging,
      '-volname',
      'Phyra',
      '-fs',
      'HFS+',
      '-format',
      'UDZO',
      '-imagekey',
      'zlib-level=9',
      '-ov',
      temporaryImage,
    ]);
    await fs.rename(temporaryImage, path.join(outputDirectory, filename));
    console.log(`Development disk image: ${path.join(outputDirectory, filename)}`);
  } finally {
    await fs.rm(staging, { recursive: true });
    await fs.rm(temporaryImage, { force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await packageMacOS();
