import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

const nextVersion = process.argv[2];
assert.match(
  nextVersion ?? '',
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/,
  'Pass a stable major.minor.patch version, for example: npm run release:version -- 0.2.0',
);

const paths = {
  package: 'package.json',
  tauri: 'src-tauri/tauri.conf.json',
  cargo: 'src-tauri/Cargo.toml',
  cargoLock: 'src-tauri/Cargo.lock',
  packageLock: 'package-lock.json',
  engine: 'engine/phyra_engine/__init__.py',
};
const source = Object.fromEntries(
  await Promise.all(
    Object.entries(paths).map(async ([key, path]) => [key, await readFile(path, 'utf8')]),
  ),
);
const packageMetadata = JSON.parse(source.package);
const currentVersion = packageMetadata.version;
const versionParts = (version) => version.split('.').map(Number);
const compareVersions = (left, right) => {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
};

assert.equal(
  compareVersions(nextVersion, currentVersion) > 0,
  true,
  `New version must be later than ${currentVersion}`,
);

const tauriMetadata = JSON.parse(source.tauri);
const cargoVersion = source.cargo.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
const lockedCargoVersion = source.cargoLock.match(
  /\[\[package\]\]\nname = "phyra"\nversion = "([^"]+)"/,
)?.[1];
const packageLock = JSON.parse(source.packageLock);
const engineVersion = source.engine.match(/^__version__\s*=\s*"([^"]+)"/m)?.[1];
for (const [name, actual] of [
  ['Tauri', tauriMetadata.version],
  ['Cargo.toml', cargoVersion],
  ['Cargo.lock', lockedCargoVersion],
  ['package-lock.json', packageLock.version],
  ['package-lock.json root package', packageLock.packages?.['']?.version],
  ['Python engine', engineVersion],
]) {
  assert.equal(
    actual,
    currentVersion,
    `${name} is ${actual}; expected the current version ${currentVersion}`,
  );
}

packageMetadata.version = nextVersion;
tauriMetadata.version = nextVersion;
packageLock.version = nextVersion;
packageLock.packages[''].version = nextVersion;
const updates = [
  [paths.package, `${JSON.stringify(packageMetadata, null, 2)}\n`],
  [paths.tauri, `${JSON.stringify(tauriMetadata, null, 2)}\n`],
  [paths.cargo, source.cargo.replace(/^version\s*=\s*"[^"]+"/m, `version = "${nextVersion}"`)],
  [
    paths.cargoLock,
    source.cargoLock.replace(
      /(\[\[package\]\]\nname = "phyra"\nversion = ")[^"]+("\n)/,
      `$1${nextVersion}$2`,
    ),
  ],
  [paths.packageLock, `${JSON.stringify(packageLock, null, 2)}\n`],
  [
    paths.engine,
    source.engine.replace(/(^__version__\s*=\s*")[^"]+("\s*$)/m, `$1${nextVersion}$2`),
  ],
];

for (const [path, content] of updates) await writeFile(path, content);
console.log(
  `Updated Phyra version ${currentVersion} → ${nextVersion} across package, native, engine, and lockfile metadata.`,
);
console.log(
  'This only edits version metadata; it does not create or push a Git tag or publish a release.',
);
