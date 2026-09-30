<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/phyra-wordmark-dark.svg" />
    <img src="assets/phyra-wordmark.svg" alt="Phyra — engineering analysis with Physics ML" width="440" />
  </picture>
</p>

<p align="center"><strong>Prepare a physical problem. Solve locally. Understand the result.</strong></p>

Phyra is an open-source engineering analysis desktop workbench combining classical finite element analysis with experimental Physics ML. The **0.2.0 development build** supports linear static elasticity, with a professional light/dark workspace, contextual engineering help and real FEM/PINN comparison.

<p align="center">
  <a href="assets/media/phyra-introduction.mp4">
    <img src="assets/media/phyra-introduction-poster.jpg" alt="Play the 94-second Phyra product walkthrough" width="100%" />
  </a>
  <br />
  <a href="assets/media/phyra-introduction.mp4">▶ Play the 94-second walkthrough</a>
</p>

**Explore:** [the roadmap](ROADMAP.md) · [built-in examples](examples) · [offline method guide](#learn-the-implemented-method)

The walkthrough uses genuine current application screens, saved CPU reference results and a live capture of the 3D result viewport. Its deformation playback visualizes a static field; it is not a dynamic simulation. The video separates implemented mechanics from planned roadmap work; running a new analysis requires the desktop app.

## What you can do today

- **Prepare and solve:** edit box, cylinder and connected bracket primitives or a 2D rectangle; assign material, component supports, total force and inward pressure; generate a mesh and run classical FEM.
- **Prepare boundaries:** use replace/add/toggle selection and save named boundary sets for reuse in support/load editors. Assignments copy the selected boundaries; later set edits do not move existing conditions.
- **Train from physics:** solve rectangular plane-stress elasticity with a real PyTorch PINN, using equilibrium and boundary conditions without FEM training labels. Inspect training settings, live PDE/boundary losses, device and precision.
- **Compare and inspect:** switch FEM, PINN, absolute and relative differences; probe authoritative values; inspect stress/displacement, reactions and balance. Use standard camera views, fit/reset, boundary isolation and undeformed node/preview-vertex distance measurement.
- **Understand the method:** open offline Workbench help or contextual screen help for workflow, assumptions, physical conditions, mesh quality, interpretation and limitations.
- **Keep ownership:** local isolated workers, cancellation, stale-result detection, versioned `.phyra` save/reopen, definition-only recovery copies and SI CSV exports. Analysis needs no account, API key or network service.

Undo/redo preserves up to 80 definition edits within a 16 MiB session budget. Physical undo restores the inputs and requires a new analysis; it cannot reactivate earlier fields. Project names, display units and named-set metadata leave physical results current. Opening or restoring a project starts a fresh edit history.

![Current Phyra primitive preparation and named boundary sets](public/help/preparation-workbench.jpg)

Current interface · primitive preparation and copied boundary sets; constrained sketching and CAD import remain future work.

![Current Phyra light workspace inspecting a saved CPU structural solution](public/help/solid-workbench.jpg)

Current interface · saved CPU 3D FEM reference · amplified static deformation.

![Current Phyra plane-stress interface inspecting recorded FEM/PINN comparison](public/help/comparison-workbench.jpg)

Current interface · saved CPU FEM/PINN comparison · recorded measurements, not live training.

## Run locally

Install Node **22.12+**, Python **3.12** and Rust **1.94** with rustfmt/clippy. macOS needs Xcode command-line tools; Windows needs Visual Studio C++ Build Tools, Windows SDK and WebView2. Supported launch targets are macOS Apple Silicon, minimum macOS 14, and Windows x64.

```sh
git clone https://github.com/oguzhankir/phyra.git
cd phyra
npm ci
npm run setup
npm run package:engine
npm run dev
```

`setup` preserves an existing `.venv`, prefers official Python on macOS and installs CPU Torch on Windows. Workers start automatically. [CONTRIBUTING.md](CONTRIBUTING.md) contains verification and packaging commands.

For a browser preview after `npm ci`, run `npm run dev:web` and open the local URL. **Inspect 3D reference** and **Inspect 2D comparison** load real saved CPU results, including fields, recorded training history and measured comparison. Changes to physical inputs make those results stale.

For a first desktop study, choose **3D cantilever beam**, review Geometry → Material → Supports/Loads → Mesh → Solver, and run FEM. For Physics ML, choose **2D plane-stress tension**, inspect thickness and supports, then use **Compare FEM / PINN**. Choose **Help** or press **F1** for the current screen’s offline guide.

## Scientific scope

The implemented physics is homogeneous, isotropic, small-strain **linear static elasticity**. 3D uses first-order tetrahedra; rectangular 2D plane stress uses constant-strain triangles and explicit physical thickness. Internal geometry, properties and exports use SI; display-unit changes do not modify the model.

The PINN is **experimental**. Comparison evaluates displacement at the same nodes and stress at the same cell centroids as FEM, reporting unweighted relative L2, maximum absolute differences and measured timings. Undefined zero-reference relative values are explicitly omitted. New runs also measure normalized residuals at independently sampled points after training; those diagnostics are not field-error bounds. Low training loss alone does not establish accuracy or equilibrium; use independent references, balance and mesh convergence.

Idealized corners/restraints may produce stress singularities, and first-order tetrahedra can be stiff in bending. Poisson ratios above 0.45 are rejected. Deformation playback scales a static field; it is not dynamics. Distance measurement uses undeformed mesh nodes or primitive-preview vertices, rather than exact CAD edge/face distances. Projects retain settings, seeds, metrics, fields and provenance, but do not resume trained weights.

Project version 3 persists up to 100 named boundary sets, stamped with their primitive type and study dimension. A type/dimension change preserves the sets for explicit repair. Version 1/2 archives are validated before migration: version 1 caches are discarded with a notice; version 2 fields can survive normal ownership, fingerprint and field validation. Named sets provide copied assignments, rather than associative CAD references.

Desktop recovery preserves valid project definitions after an editing pause; invalid numeric drafts pause recovery. Older valid journals migrate in memory while their original bytes remain intact. Restoring creates an unsaved project without cached fields or trained weights. Recompute and save it explicitly; recovery does not overwrite the original project file.

General CAD import, assemblies, multiple materials, anisotropy/composites/graded and nonlinear materials, contact, transient physics, thermal/flow solvers, reusable learned models and an AI assistant are future work. The [roadmap](ROADMAP.md) sets their dependencies and scientific acceptance gates, including optional framework adapters and a future CPU/Apple/NVIDIA/distributed execution runtime. No external Physics ML framework or distributed runtime is integrated today.

## Learn the implemented method

Start with **2D plane-stress tension**: review units and restraints, run FEM, then run **Compare FEM / PINN**. Inspect field differences, reactions and balance alongside training losses. The offline **Physics ML learning path** explains the steps and links the primary references.

The current PINN uses a neural displacement field and automatic differentiation to evaluate equilibrium and boundary residuals, adapted from [Raissi, Perdikaris and Karniadakis (2019)](https://doi.org/10.1016/j.jcp.2018.10.045). It learns one problem without FEM training labels. [Deep Ritz](https://arxiv.org/abs/1710.00211) minimizes a variational energy, while [FNO](https://arxiv.org/abs/2010.08895) learns a reusable solution mapping; these are future method tracks, not the implemented algorithm. Their papers do not establish Phyra accuracy or speedup.

## Validation and direction

Independent analytical/manufactured references live in [engine tests](engine/tests); typed scientific/project tests live beside [domain logic](src/domain), with interface tests beside [frontend features](src/features); [native tests](src-tauri/src/tests) cover safe files and worker lifecycle.

**Current runtime evidence:** [scientific and packaged verification at `3498f34`](https://github.com/oguzhankir/phyra/actions/runs/36761517423) passed on macOS 15 Apple Silicon and Windows Server 2022 x64. The run covers the current preparation and project-version changes, actual FEM/PINN rendering and comparison, persistence, cancellation and native recovery. That production code is unchanged after integration with the current repository documentation. Representative-user usability remains open.

Minimum macOS 14 execution and manual consumer installation, native dialogs and uninstall remain open. macOS development packages are ad hoc sealed rather than Developer ID signed/notarized; production distribution trust is unfinished on both targets. Source and the current product walkthrough are available; public installers require the redistribution work below.

Phyra's direction is capable engineering preparation combined with validated Physics ML: CAD/sketching and richer physical conditions; thermal/fluid and coupled families; inverse problems, reusable operators, uncertainty and controlled engineering assistance. Contributions should deliver complete, reproducible workflows rather than placeholder modules. See [the roadmap](ROADMAP.md) and [contribution guide](CONTRIBUTING.md).

Built with Tauri 2, React, TypeScript, Three.js, Gmsh, SciPy and PyTorch. Licensed [GPL-3.0-or-later](LICENSE); required upstream notices and target-specific dependency/Corresponding Source obligations are in [notices/THIRD_PARTY.txt](notices/THIRD_PARTY.txt).

## Citation

If you use Phyra in research, cite **Kır, Oğuzhan. Phyra [Computer software]**, [repository](https://github.com/oguzhankir/phyra). [CITATION.cff](CITATION.cff) provides machine-readable metadata. Record the exact code revision and study settings in your methods; a versioned archival DOI and release date will be added only after an actual release.

For vulnerability reporting and current security-support limits, see [SECURITY.md](SECURITY.md).
