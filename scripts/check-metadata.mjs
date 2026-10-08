import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const packageMetadata = JSON.parse(await readFile('package.json', 'utf8'));
const version = packageMetadata.version;
assert.match(
  version,
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  'Application releases use semantic major.minor.patch versions',
);
const nativeMetadata = JSON.parse(await readFile('src-tauri/tauri.conf.json', 'utf8'));
const rustMetadata = await readFile('src-tauri/Cargo.toml', 'utf8');
const packageLock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const cargoLock = await readFile('src-tauri/Cargo.lock', 'utf8');
const engineMetadata = await readFile('engine/phyra_engine/__init__.py', 'utf8');
const enginePackageMetadata = await readFile('engine/pyproject.toml', 'utf8');
const citation = await readFile('CITATION.cff', 'utf8');
const researchCases = JSON.parse(await readFile('examples/research-cases.json', 'utf8'));
const sourceLicense = await readFile('LICENSE', 'utf8');
const combinedLicense = await readFile('notices/GPL-3.0.txt', 'utf8');
const changelog = await readFile('CHANGELOG.md', 'utf8');
assert.match(changelog, /^# Changelog\r?$/m, 'Canonical changelog must have a title');
assert.match(
  changelog,
  /^## Unreleased\r?$/m,
  'Canonical changelog must retain an Unreleased section',
);
const rustVersion = rustMetadata.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
const lockedRustVersion = cargoLock.match(
  /\[\[package\]\]\nname = "phyra"\nversion = "([^"]+)"/,
)?.[1];
const engineVersion = engineMetadata.match(/^__version__\s*=\s*"([^"]+)"/m)?.[1];
for (const [name, actual] of [
  ['Tauri', nativeMetadata.version],
  ['Rust', rustVersion],
  ['Cargo lockfile', lockedRustVersion],
  ['npm lockfile', packageLock.version],
  ['npm root package lock entry', packageLock.packages?.['']?.version],
  ['engine', engineVersion],
]) {
  assert.equal(actual, version, `${name} version must match package.json`);
}
for (const [name, actual] of [
  ['npm package', packageMetadata.license],
  ['npm root package lock entry', packageLock.packages?.['']?.license],
  ['Rust package', rustMetadata.match(/^license\s*=\s*"([^"]+)"/m)?.[1]],
  ['engine package', enginePackageMetadata.match(/^license\s*=\s*"([^"]+)"/m)?.[1]],
  ['citation', citation.match(/^license:\s*(\S+)/m)?.[1]],
  ['original research cases', researchCases.license],
]) {
  assert.equal(actual, 'Apache-2.0', `${name} must identify the first-party source license`);
}
assert.match(sourceLicense, /^\s*Apache License\r?\n\s*Version 2\.0, January 2004/m);
assert.match(combinedLicense, /^GNU GENERAL PUBLIC LICENSE\r?\nVersion 3, 29 June 2007/m);
assert.equal(
  nativeMetadata.bundle.license,
  'GPL-3.0-only',
  'The combined application must not inherit the first-party Apache package license',
);
assert.equal(nativeMetadata.bundle.licenseFile, '../notices/GPL-3.0.txt');
assert.equal(nativeMetadata.bundle.resources['../NOTICE'], 'NOTICE');
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `v${version}`,
    'Release tag must match application metadata',
  );
}
console.log(`Application metadata agrees: version ${version}, first-party license Apache-2.0`);
