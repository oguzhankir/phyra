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

`package` builds the owned engine, compiled frontend and native current-target application. macOS packaging preserves verified internal library links, seals the development app ad hoc and creates a compressed disk image without Finder automation. Output is `src-tauri/target/release/bundle/macos/Phyra.app` and `src-tauri/target/release/bundle/dmg/`; Windows installers are under `src-tauri/target/release/bundle/nsis/` and `msi/`. Windows packaging must run on Windows. [Hosted verification at runtime commit `d3616d3`](https://github.com/oguzhankir/phyra/actions/runs/36744426687) passed packaging and actual desktop workflows on macOS 15 Apple Silicon and Windows Server 2022 x64. The later test-only commit does not change that production runtime.

`test:desktop` launches the package outside the checkout with developer Python paths removed. It checks real 3D FEM and 2D FEM/PINN fields, rendering, picking/probing, metrics, comparison, persistence, repeated runs and training cancellation. It queries actual method/device capabilities and exercises native definition-only recovery in isolated temporary storage, including active-session protection and interface reload ownership. Evidence is ignored under `artifacts/`. Target one workflow with `npm run test:desktop -- --3d-only` or `--physicsml-only`; optionally supply an absolute executable path. Native dialogs, minimum macOS 14 and consumer clean-machine installation/uninstall remain manual checks; hosted execution does not establish those results.

The macOS inspector rejects a native runtime requiring later than macOS 14 or linking developer libraries. Prefer the official Python 3.12 distribution; recreate a Homebrew environment if it fails this check. MPS capability must be tested outside restrictive execution sandboxes. Windows setup defaults to CPU Torch to avoid an unnecessary GPU runtime; an explicitly installed compatible CUDA build is detected by the engine but has not been verified here.

Linux remains unsupported: its resolved GTK stack contains an open [GLib safety advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and needs an upstream-compatible fix before platform validation. GLib is absent from the macOS and Windows Rust dependency graphs; keep the alert open until a compatible upstream fix is available.

## Numerical changes

Identify the equations, assumptions and SI units in colocated comments/tests. Cite primary methods near their implementation and expose useful references in offline help; distinguish an adapted method from reproduction of a paper's experiments. Provide an independent analytical or manufactured reference, justified tolerances, conservation/constraint checks, and convergence evidence. Preserve existing references; never loosen a tolerance to hide a defect, suppress a warning, add hidden stabilization or substitute presentation data for physical values. For PINNs, verify actual derivatives, boundary behavior, deterministic CPU seeds, loss history, cancellation and same-location comparison. Report measured device/precision and runtime limits.

Project files are safe JSON and typed little-endian buffers; no pickle, executable model serialization or general shell bridge. Version persistence changes explicitly and validate legacy inputs before migration. Preserve stale-result rejection, units, array associations and owned-worker cleanup.

## Repository discipline

Keep human documentation in README, AGENTS, CONTRIBUTING, LICENSE and the single roadmap, with the explicitly requested [citation metadata](CITATION.cff) and [security policy](SECURITY.md). Frontend lifecycle belongs to `src/app/`, scientific/project rules to `src/domain/`, the native bridge to `src/platform/desktop/`, reusable controls to `src/shared/`, and actual screens/help to `src/features/`. Native execution, project/archive/recovery, result/export and platform-file responsibilities live under `src-tauri/src/`; its entry point only wires the application. The engine separates geometry/meshing/materials, numerical methods, study execution, protocol and result validation. Add folders for actual responsibilities, not speculative future modules. Legal texts, mathematical comments, test fixtures and small community templates have concrete purposes; avoid reports and duplicate instructions. Use English in authored source/text and preserve GPL-3.0-or-later notices. Do not present example properties as certified material data.

The small `public/reference/` fixtures are actual CPU worker results for browser inspection, with exact asset digests and normal field provenance. Regenerate them after setup with `node scripts/generate-reference.mjs`; it validates the caches, physical balances and analytical references before replacing them. Seeds define the numerical runs; execution IDs, timestamps and measured timings remain real.

README video uses real application captures from the preceding interface iteration; final video recapture is deferred until product refinement stabilizes. Current README/help images under `public/help/` show the refined interface inspecting actual saved CPU references, with recorded-history captions. `node scripts/render-promo.mjs` composes local captures and their `artifacts/promo/scenes.json` manifest into the checked-in MP4/preview; it needs an installed FFmpeg and system font, neither of which is an application dependency. Keep raw captures under ignored `artifacts/` and do not substitute synthetic numerical fields or screenshots.

Keep changes focused and sign off commits using your configured identity (`git commit -s`); DCO is separate from cryptographic signing. Preserve unknown local work. Publishing, pushing, uploading binaries and paid compute require owner authorization. Follow [SECURITY.md](SECURITY.md) for reporting limitations; do not put secrets in public issues. Update application/package/native/engine versions together for a release, and add citation version/date/DOI only when that release exists.

The [tag workflow](.github/workflows/release.yml) checks matching version metadata and reuses full scientific/package/desktop CI only after the owner's `PHYRA_PUBLIC_DISTRIBUTION_READY=true` repository gate. Verified installers, license/notice files and SHA-256 sums are staged under ignored `artifacts/release/` and attached to an owner-reviewed draft. The gate defaults closed; no tag or publication is authorized by these instructions. Updater artifacts are absent, and configured automation does not establish signing, consumer installation or complete Corresponding Source availability.
