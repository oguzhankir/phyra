# Contributing to Phyra

## Local setup

Use Node.js 22.12 or later, Python **3.12**, and the pinned Rust 1.94.0 toolchain with rustfmt and clippy. For macOS Apple Silicon desktop builds, install Xcode command-line tools and the official Python distribution; the configured minimum is macOS 14. Windows x64 desktop builds require Visual Studio Build Tools with Desktop development with C++, the Windows SDK, and WebView2. End-user packages manage the engine and WebView2 prerequisite themselves. Numerical-only contributions need Node and Python; they can omit the desktop toolchains and packaging steps.

Run these commands from the repository root, in Terminal on macOS or PowerShell on Windows:

```sh
npm ci
npm run setup
npm run package:engine
npm run dev
```

Use the README's GUI sequence, then close the application and stop the development session before running the checks and release packaging below.

`setup` creates `.venv` and installs pinned dependencies. On macOS it prefers the official interpreter at `/Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12`, falling back to `python3.12`. Windows uses an active Python 3.12, then `py -3.12`. An existing `.venv` is preserved. Packaging rejects native runtime dependencies requiring macOS later than 14; if a Homebrew-based environment fails that check, recreate `.venv` with the official interpreter. The current inspected package uses official Python 3.12.8. The desktop starts its own workers; no solver service needs manual startup.

```sh
npm run check
npm test
npm run test:native
npm run check:native
npm run test:numerics-slow
npm run package
npm run test:desktop
```

`package` builds the engine and compiled UI, then Tauri packages the current native target. macOS output is `src-tauri/target/release/bundle/macos/Phyra.app` and `src-tauri/target/release/bundle/dmg/`. Windows installers are under `src-tauri/target/release/bundle/nsis/` and `src-tauri/target/release/bundle/msi/`. Windows setup/build/run commands are configured but have not been exercised here. CI is configured for Apple Silicon and Windows x64; no CI result or public release is claimed. Preserve lockfiles and run `npm run generate` after schema changes.

`test:desktop`, implemented in [scripts/test-desktop.mjs](scripts/test-desktop.mjs), launches the built application outside the checkout with developer Python paths removed. It checks the actual renderer, region picking, probing, solve, native persistence, repeated jobs and cancellation, writing ignored evidence under `artifacts/`. The release bundle passed on macOS 27 Apple Silicon from a path containing spaces and Unicode. Native dialog clicking remains a manual check. The default executable is the macOS application bundle or the Windows release executable; a specific built executable can be supplied with `npm run test:desktop -- "absolute path to executable"`.

Follow the GUI sequence in README, including selection, changed loads, solve, fields/deformation, stale inputs, save/reopen, and cancel/close during a job. Exercise saved paths with spaces and non-ASCII characters. Native binary inspection establishes a macOS 14 deployment minimum, while the available host is macOS 27; older-system and clean-machine tests remain outstanding. Development packages have no Developer ID signature or notarization. Do not report platform, signing or clean-machine verification without evidence.

## Numerical contributions

The engine needs no UI import or display server. Run a focused test with:

```sh
node scripts/test-engine.mjs -k axial -s
```

Contribute analytical references, verification-only cases, failure reports, meshing improvements, or mechanics changes. For a numerical change:

1. Identify equations, assumptions, units, supported regimes, and primary references.
2. Add a reproducible independent analytical/manufactured reference and justify tolerances.
3. Check constraints, conservation/equilibrium, moment balance, mesh convergence, and failure cases.
4. Measure runtime/memory consequences; use ordinary local CPUs.
5. Preserve units, boundary/field associations, and project compatibility, or version changes explicitly.
6. State limitations and update the concise supported scope when it changes.

Never loosen a reference tolerance merely to pass, hide warnings, add secret stabilization, or replace numerical values with presentation-derived data. Do not present generic example properties as certified material data.

## Pull requests and repository discipline

Keep changes focused, explain actual behavior and executed verification, and sign off commits with your correctly configured identity (`git commit -s`). DCO sign-off is separate from cryptographic signing. Preserve unknown local work. Publishing, pushing, uploading binaries, and spending money require owner authorization.

Keep human documentation in README, AGENTS, CONTRIBUTING, and LICENSE. Put mathematical details and reference provenance beside implementation/tests. Legal notices are required distribution artifacts. Do not add plans, status reports, architecture collections, placeholder physics modules, or duplicate documentation. Use English in source and repository text. Bug and physics proposal forms are provided. No private security reporting route is configured; do not put secrets in public issues.
