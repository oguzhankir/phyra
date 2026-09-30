# Contributing to Phyra

## Setup and verification

Prerequisites and the GUI sequence are in [README.md](README.md). Run commands from the repository root in macOS Terminal or Windows PowerShell:

```sh
npm ci
npm run setup
npm run package:engine
npm run dev
```

Close the development app before checks or packaging:

```sh
npm run check
npm test
npm run test:native
npm run check:native
npm run test:numerics-slow
npm run package
npm run test:desktop
```

`test:numerics-slow` executes the more expensive bending-convergence and real PINN-convergence references. Focus a headless check with `node scripts/test-engine.mjs -k axial -s`. Tests require no UI imports or solver service. Preserve dependency lockfiles; run `npm run generate` after schema changes.

`package` builds the owned engine, compiled frontend and native current-target application. macOS packaging preserves verified internal library links, seals the development app ad hoc and creates a compressed disk image without Finder automation. Output is `src-tauri/target/release/bundle/macos/Phyra.app` and `src-tauri/target/release/bundle/dmg/`; Windows installers are under `src-tauri/target/release/bundle/nsis/` and `msi/`. Windows packaging must run on Windows. CI is configured for Apple Silicon and Windows x64; no CI result is implied.

`test:desktop` launches the package outside the checkout with developer Python paths removed. It checks real 3D FEM and 2D FEM/PINN fields, rendering, picking/probing, metrics, comparison, persistence, repeated runs and training cancellation. Evidence is ignored under `artifacts/`. Target one workflow with `npm run test:desktop -- --3d-only` or `--physicsml-only`; optionally supply an absolute executable path. Native dialog interaction, old macOS and clean-machine execution remain manual checks.

The macOS inspector rejects a native runtime requiring later than macOS 14 or linking developer libraries. Prefer the official Python 3.12 distribution; recreate a Homebrew environment if it fails this check. MPS capability must be tested outside restrictive execution sandboxes. Windows setup defaults to CPU Torch to avoid an unnecessary GPU runtime; an explicitly installed compatible CUDA build is detected by the engine but has not been verified here.

## Numerical changes

Identify the equations, assumptions and SI units in colocated comments/tests. Provide an independent analytical or manufactured reference, justified tolerances, conservation/constraint checks, and convergence evidence. Preserve existing references; never loosen a tolerance to hide a defect, suppress a warning, add hidden stabilization or substitute presentation data for physical values. For PINNs, verify actual derivatives, boundary behavior, deterministic CPU seeds, loss history, cancellation and same-location comparison. Report measured device/precision and runtime limits.

Project files are safe JSON and typed little-endian buffers; no pickle, executable model serialization or general shell bridge. Version persistence changes explicitly and validate legacy inputs before migration. Preserve stale-result rejection, units, array associations and owned-worker cleanup.

## Repository discipline

Keep human documentation in README, AGENTS, CONTRIBUTING, LICENSE and the single roadmap. Offline contextual help lives in `src/features/help/`; workbench controls, viewport and run views live in their corresponding `src/features/` folders. Shared scientific fields, project contracts and native job lifecycle must retain clear ownership. Add folders for actual capabilities, not speculative future modules. Legal texts, mathematical comments, test fixtures and small community templates have concrete purposes; avoid reports and duplicate instructions. Use English in authored source/text and preserve GPL-3.0-or-later notices. Do not present example properties as certified material data.

The small `public/reference/` fixtures are actual CPU worker results for browser inspection, with exact asset digests and normal field provenance. Regenerate them after setup with `node scripts/generate-reference.mjs`; it validates the caches, physical balances and analytical references before replacing them. Seeds define the numerical runs; execution IDs, timestamps and measured timings remain real.

README media uses real application captures. `node scripts/render-promo.mjs` composes local captures and their `artifacts/promo/scenes.json` manifest into the checked-in MP4/preview; it needs an installed FFmpeg and system font, neither of which is an application dependency. Keep raw captures under ignored `artifacts/` and do not substitute synthetic numerical fields or screenshots.

Keep changes focused and sign off commits using your configured identity (`git commit -s`); DCO is separate from cryptographic signing. Preserve unknown local work. Publishing, pushing, uploading binaries and paid compute require owner authorization. No private security reporting route is configured; do not put secrets in public issues.
