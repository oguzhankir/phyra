# Contributing to Phyra

## Sign-off and licensing

Use DCO sign-off on every commit (`git commit -s`). The sign-off certifies that you have the right to submit the change under the project’s terms; it does not grant relicensing rights to Phyra. External contributors must also accept the [Phyra CLA](CLA.md) before their contribution is merged. The CLA grants the Maintainer additional copyright and patent licenses while contributors retain copyright. For external pull requests, comment **“I have read the Phyra CLA and agree to its terms.”** and a maintainer will record and check acceptance before merging. This is a manual repository check; no third-party CLA service is required.

Phyra is publicly distributed under GNU GPL-3.0-or-later. The CLA preserves the option to offer contributions under additional licenses in the future while keeping them available under the project license in effect when submitted. It does not change existing GPL releases or revoke rights already granted to their recipients; it does not make an existing open-source release retroactively proprietary. Contributors retain copyright in their work unless a separate written agreement explicitly states otherwise.

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

`package` builds the owned engine, compiled frontend and native current-target application. macOS packaging preserves verified internal library links, seals the development app ad hoc and creates a compressed disk image without Finder automation. Output is `src-tauri/target/release/bundle/macos/Phyra.app` and `src-tauri/target/release/bundle/dmg/`; Windows installers are under `src-tauri/target/release/bundle/nsis/` and `msi/`. Windows packaging must run on Windows. The [historical verification at runtime commit `3498f34`](https://github.com/oguzhankir/phyra/actions/runs/36761517423) passed on macOS 15 Apple Silicon and Windows Server 2022 x64. It covers that commit only; this PR's CI must verify the newer runtime.

`test:desktop` launches the package outside the checkout with developer Python paths removed. It checks real 3D FEM, rectangular 2D FEM/PINN comparison, and the exact-profile Kirsch SI study: rendering, picking/probing, reference diagnostics, persistence, SI CSV export, stale-result rejection, repeated runs and cancellation. It queries actual method/device capabilities and exercises native definition-only recovery in isolated temporary storage, including active-session protection and interface reload ownership. Evidence is ignored under `artifacts/`. Target one workflow with `npm run test:desktop -- --3d-only`, `--physicsml-only`, or `--profile-only`; optionally supply an absolute executable path. Native dialogs, minimum macOS 14 and consumer clean-machine installation/uninstall remain manual checks; hosted execution does not establish those results.

## Changelog and pull requests

Every pull request that changes user-visible behavior, scientific results or assumptions, project compatibility, persistence, supported platforms or security must update [CHANGELOG.md](CHANGELOG.md) under **Unreleased**. Describe the effect on users in one concise entry under Added, Changed, Fixed, Removed, Deprecated or Security; combine related work and omit empty headings. Reviewers require this entry before merging an applicable change.

Typos, internal refactoring, test-only changes and contributor tooling need no entry when they leave those outcomes unchanged. Record **Changelog: N/A — reason** in the pull request description so the exception is explicit. A dependency change still needs an entry if it changes compatibility, behavior or security. The changelog follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and remains a curated product history rather than a commit log.

## Preparing a release

Plan product outcomes in the [roadmap](ROADMAP.md); assign a version only when the next release scope is selected. To synchronize the app, Tauri, Rust, Python engine and both lockfiles, run:

```sh
npm run release:version -- 0.2.0
```

This edits version metadata only. Move the completed scope from Unreleased in CHANGELOG.md into a section for the selected version; assign a date only when the release actually exists. Review the resulting diff, complete the release checks above, and commit the reviewed changes with DCO sign-off. A version tag uses the `v` prefix and must match all metadata; for example, `v0.2.0`. After the release commit is on the default branch, create and push its tag to start the hosted workflow:

```sh
git tag -a v0.2.0 -m "Phyra v0.2.0"
git push origin v0.2.0
```

Pushing that tag starts `.github/workflows/release.yml`. It runs the full scientific and packaged desktop checks on macOS Apple Silicon and Windows x64, stages installers, license/notice files and SHA-256 checksums, then creates a **draft** GitHub Release. The public-distribution readiness gate must be enabled by the repository owner after the target-specific installation, trust and GPL Corresponding Source review is complete. Review the draft and publish it to make the installers available from [GitHub Releases](https://github.com/oguzhankir/phyra/releases/latest). A published release updates that `latest` download page; Phyra does not yet update an already-installed app automatically.

The macOS inspector rejects a native runtime requiring later than macOS 14 or linking developer libraries. Prefer the official Python 3.12 distribution; recreate a Homebrew environment if it fails this check. MPS capability must be tested outside restrictive execution sandboxes. Windows setup defaults to CPU Torch to avoid an unnecessary GPU runtime; an explicitly installed compatible CUDA build is detected by the engine but has not been verified here.

Linux remains unsupported: its resolved GTK stack contains an open [GLib safety advisory](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) and needs an upstream-compatible fix before platform validation. GLib is absent from the macOS and Windows Rust dependency graphs; keep the alert open until a compatible upstream fix is available.

## Numerical changes

Identify the equations, assumptions and SI units in colocated comments/tests. Cite primary methods near their implementation and expose useful references in offline help; distinguish an adapted method from reproduction of a paper's experiments. Provide an independent analytical or manufactured reference, justified tolerances, conservation/constraint checks, and convergence evidence. Preserve existing references; never loosen a tolerance to hide a defect, suppress a warning, add hidden stabilization or substitute presentation data for physical values. For PINNs, verify actual derivatives, boundary behavior, deterministic CPU seeds, loss history, cancellation and same-location comparison. Report measured device/precision and runtime limits.

Project files are safe JSON and typed little-endian buffers; no pickle, executable model serialization or general shell bridge. Version persistence changes explicitly and validate legacy inputs before migration. Preserve stale-result rejection, units, array associations and owned-worker cleanup.

## Editing and project compatibility

Definition-only undo/redo lives in `src/domain/project/history.ts`; `src/app/` owns its session and lifecycle gates. Retain at most 80 transactions within a 16 MiB serialized-snapshot budget. A physical edit, undo or redo advances the current revision and cannot reactivate old fields. Project-name, display-unit and named-set metadata changes preserve it. Replacement through new/open/reference/recovery resets history; save does not replace its definition snapshots or record a native path. Invalid drafts and active file/compute/modal operations block model-history navigation; text inputs retain native undo.

`contracts/project.schema.json` is version 4. Frozen v1/v2/v3 schemas validate legacy definitions before migration. Version 1 caches are discarded; v2/v3 caches are eligible for reuse only after the worker validates ownership, physical fingerprints and fields. Copied named boundary sets remain outside the physical digest, preserving those versions' cache fingerprints. New profile and traction inputs use the v4 physical fingerprint. Older recovery journals migrate only in memory during read/discovery; their original bytes remain unchanged until an explicit restore/discard action.

Named sets are bounded to 100 and carry geometry-type/dimension stamps. Profile sets use stable boundary IDs; geometry or study-dimension changes retain incompatible sets for explicit repair. Support/load assignments copy their regions and do not follow later set edits. Viewport selection modes, camera orientation, fit/reset and boundary isolation are presentation state; distance measurement reads undeformed SI mesh-node or primitive-preview coordinates. Keep these controls distinct from constrained sketches, associative CAD topology and scientific fields.
Profile plane-stress FEM uses pinned scikit-fem assembly and facet quadrature behind a narrow engine adapter. The former CST element matrices remain only as an independent regression oracle. Run `node scripts/test-engine.mjs -k kirsch -m slow -s` for the three-resolution Kirsch reference and changed-radius/load case. Reference comparisons integrate displacement and tensor stress at matching quadrature locations over the discrete mesh; exact CAD circles still have chord geometry in first-order triangles. The paper and linked code leave physical units and thickness unspecified, so the bundled SI realization and its thickness are explicit Phyra choices.

## Finding and extending the implementation

Start at the owner of the behavior being changed. The headless engine entry point is `execution.application.execute(RunPlan.prepare(StudyRequest.from_payload(payload)), output, ...)`; the desktop worker adds bounded stdio framing around that same execution path.

| Responsibility                                           | Python owner                                                                                            | Frontend owner                                                                                             |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Versioned physical definition and admissibility          | `protocol/request.py`, `studies/project.py`, `studies/validation.py`                                    | `domain/contracts/`, `domain/project/`, `app/useProjectSession.ts`                                         |
| Geometry and discretization                              | `geometry/`, `meshing/`, composed by `studies/mesh.py`                                                  | Project editors; domain region and geometry rules                                                          |
| Equations, material law and physical boundary conditions | `physics/elasticity/`, `materials/`                                                                     | Typed study definition and assignment editors                                                              |
| Classical numerical solution                             | `methods/classical/`                                                                                    | Solver editor and actual runtime capabilities                                                              |
| PINN configuration, sampling and residual objective      | `methods/physicsml/configuration.py`, `normalization.py`, `sampling.py`, `elasticity.py`, `networks.py` | Solver editor; validated configuration contract                                                            |
| Optimization, independent validation and inference       | `methods/physicsml/training.py`, `validation.py`, `evaluation.py`, composed by `plane_stress.py`        | Run views; transported measurements and fields                                                             |
| Execution identity, cancellation and publication         | `execution/application.py`, `execution/registry.py`, `results/storage.py`                               | `app/useExecutionSession.ts`, `app/executionOwnership.ts`; native owned worker                             |
| Physical field checks, comparison and caches             | `results/`                                                                                              | `domain/results/`; viewport and result inspectors                                                          |
| File/recovery and presentation state                     | Native archive/recovery services; definition-only journals                                              | `app/useProjectSession.ts`, `useRecoverySession.ts`, `useWorkbenchView.ts`; composed by `useWorkbench.tsx` |

Pure functions are appropriate for quadrature, constitutive operators, assembly and analytical fields. Use named immutable records for validated requests, run plans, training configuration, collocation batches and measured history; use an explicit state owner for optimizer and worker lifetimes. Frozen records must not retain mutable caller-owned mappings: `StudyRequest` holds validated JSON bytes and supplies an isolated execution definition. Publication checks the original input fingerprint. The canonical JSON schema defines projects; do not duplicate it as a separately maintained Python project model.

For a new implemented method, reuse the study's physical laws and conditions, add its numerical algorithm under `methods/`, register its actual eligibility/capabilities in `execution/registry.py`, and route publication through existing validated field associations. Keep residual or energy objectives separate from sampling, optimization and evaluation. For a new physics family, first add its equations, conditions and independent references under `physics/` and tests, then integrate its concrete study, discretization, method and fields with explicitly versioned contracts where needed. Frontend features consume narrow editor/view models; application session owners compose file, execution and recovery transitions. No feature may acquire a worker or publish a result directly.

The [roadmap](ROADMAP.md) keeps reusable operator learning, datasets/model manifests, additional physics and framework adapters as future work. A single-study residual PINN does not yet define the data or inference contract for FNO/DeepONet/geometry-aware operators. Introduce those boundaries with their first real validated slice; stabilize an SDK after two real integrations establish a shared interface. Do not create empty physics packages, generic plugin loaders, speculative base classes or a second planning document.

`npm run check` runs `scripts/check-boundaries.mjs` and `scripts/check-engine-boundaries.py` alongside TypeScript, Ruff and mypy. The Python gate checks eager, deferred and relative internal imports without importing numerical backends. Geometry/material/meshing/physics kernels cannot reach study execution or transport; methods cannot reach project/file orchestration. Narrow existing exceptions cover shared field algebra, device probing and independent cached-field checks against implemented classical operators. Changes to these rules require a concrete owning responsibility. Headless tests cover input snapshot isolation, cancellation before publication, mutated adapter inputs, stale worker leases, dependency violations and numerical references; packaged desktop workflows verify the composed application. Each desktop run has a caller request UUID as well as its native job ID: transient event envelopes preserve that UUID so an unknown delayed event cannot acquire a later worker lease. Request correlation never enters Python requests, saved manifests or numerical history.

## Repository discipline

Keep human documentation in README, AGENTS, CONTRIBUTING, LICENSE, CHANGELOG and the single roadmap, with the explicitly requested [citation metadata](CITATION.cff) and [security policy](SECURITY.md). Preserve the implementation ownership above and the native execution, project/archive/recovery, result/export and platform-file responsibilities under `src-tauri/src/`; its entry point only wires the application. Add folders for actual responsibilities, not speculative future modules. Legal texts, mathematical comments, test fixtures and small community templates have concrete purposes; avoid reports and duplicate instructions. Use English in authored source/text and preserve GPL-3.0-or-later notices. Do not present example properties as certified material data.

The small `public/reference/` fixtures are actual CPU worker results for browser inspection, with exact asset digests and normal field provenance. Regenerate them after setup with `node scripts/generate-reference.mjs`; it validates the caches, physical balances and analytical references before replacing them. Seeds define the numerical runs; execution IDs, timestamps and measured timings remain real.

The README video and images under `public/help/` record a preceding interface iteration inspecting actual saved CPU references; they are not current interface captures. Final media recapture is deferred until product refinement stabilizes. `node scripts/render-promo.mjs` composes local captures from its scene manifest into the checked-in MP4/preview. It needs FFmpeg and a system font, neither of which is an application dependency. Keep raw captures, audio stems and generated segments under ignored `artifacts/`; do not substitute synthetic numerical fields or screenshots.

Keep changes focused and sign off commits using your configured identity (`git commit -s`); DCO is separate from cryptographic signing. Preserve unknown local work. Publishing, pushing, uploading binaries and paid compute require owner authorization. Follow [SECURITY.md](SECURITY.md) for reporting limitations; do not put secrets in public issues. Update application/package/native/engine versions together for a release, and add citation version/date/DOI only when that release exists.

The [tag workflow](.github/workflows/release.yml) checks matching version metadata and reuses full scientific/package/desktop CI only after the owner's `PHYRA_PUBLIC_DISTRIBUTION_READY=true` repository gate. Verified installers, license/notice files and SHA-256 sums are staged under ignored `artifacts/release/` and attached to an owner-reviewed draft. The gate defaults closed; no tag or publication is authorized by these instructions. Updater artifacts are absent, and configured automation does not establish signing, consumer installation or complete Corresponding Source availability.
