import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Called only after the packaged workflow checks. Outputs stay ignored; the
// tag workflow separately gates redistribution and creates an owner-reviewed draft.
const metadata = JSON.parse(await readFile('package.json', 'utf8'));
assert.equal(process.env.GITHUB_REF_TYPE, 'tag', 'Release staging requires a semantic tag');
assert.equal(process.env.GITHUB_REF_NAME, `v${metadata.version}`, 'Tag/version mismatch');
const target =
  process.platform === 'darwin' && process.arch === 'arm64'
    ? 'macos-aarch64'
    : process.platform === 'win32' && process.arch === 'x64'
      ? 'windows-x64'
      : null;
assert.ok(target, 'Only verified release target architectures may stage installers');
const dependencies = JSON.parse(
  await readFile('src-tauri/resources/licenses/resolved-dependencies.json', 'utf8'),
);
const cadAudit = dependencies.native?.find(
  (item) => item.name === 'OCP/OCCT native dependency audit',
);
assert.equal(
  cadAudit?.auditStatus,
  'audited',
  'Installer staging requires a target-specific native CAD dependency audit; development builds remain available',
);
assert.equal(
  cadAudit?.exactSourceStatus,
  'verified',
  `Public installer staging requires exact CAD source provenance: ${cadAudit?.sourceProvenanceLimitation ?? 'target source review is incomplete'}`,
);
const destination = path.resolve('artifacts/release');
await mkdir(destination, { recursive: true });
assert.equal((await readdir(destination)).length, 0, 'Release staging directory must be empty');
const prefix = `phyra-v${metadata.version}-${target}`;
const assets = [];
for (const [folder, extension, suffix] of target === 'macos-aarch64'
  ? [['dmg', '.dmg', '.dmg']]
  : [
      ['nsis', '.exe', '-setup.exe'],
      ['msi', '.msi', '-installer.msi'],
    ]) {
  const directory = path.join('src-tauri/target/release/bundle', folder);
  const matches = (await readdir(directory)).filter((name) => name.endsWith(extension));
  assert.equal(matches.length, 1, `Expected exactly one current ${folder} installer`);
  const name = `${prefix}${suffix}`;
  await copyFile(path.join(directory, matches[0]), path.join(destination, name));
  assets.push(name);
}
for (const [source, suffix] of [
  ['LICENSE', '-LICENSE.txt'],
  ['NOTICE', '-NOTICE.txt'],
  ['notices/GPL-3.0.txt', '-COMBINED-GPL-3.0.txt'],
  ['notices/THIRD_PARTY.txt', '-THIRD_PARTY.txt'],
]) {
  const name = `${prefix}${suffix}`;
  await copyFile(source, path.join(destination, name));
  assets.push(name);
}
const checksums = [];
for (const name of assets.sort()) {
  const digest = createHash('sha256')
    .update(await readFile(path.join(destination, name)))
    .digest('hex');
  checksums.push(`${digest}  ${name}`);
}
await writeFile(path.join(destination, `${prefix}-SHA256SUMS.txt`), `${checksums.join('\n')}\n`);
console.log(`Staged verified ${target} installers and SHA-256 checksums in artifacts/release`);
