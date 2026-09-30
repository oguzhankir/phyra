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
if (process.env.GITHUB_REF_TYPE === 'tag') {
  assert.equal(
    process.env.GITHUB_REF_NAME,
    `v${version}`,
    'Release tag must match application metadata',
  );
}
console.log(`Application version metadata agrees: ${version}`);
