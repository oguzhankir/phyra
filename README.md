# Phyra

Phyra is an **AI-native engineering analysis desktop workbench** combining classical FEM and experimental Physics ML. The implemented physics is homogeneous, isotropic, small-strain linear static elasticity: 3D solids and true 2D rectangular plane stress. Analysis runs locally and offline through isolated workers, with no account or model download.

Built with Tauri 2, React, TypeScript, Three.js, Gmsh, SciPy and PyTorch. Internal coordinates, loads, material properties and exported fields use SI. Displayed metres/millimetres change presentation only.

## Run locally

Install Node 22.12+, Python 3.12 and Rust 1.94 with rustfmt/clippy. macOS needs Xcode command-line tools; Windows needs Visual Studio C++ Build Tools, Windows SDK and WebView2. The macOS target is Apple Silicon, minimum macOS 14; Windows targets x64.

```sh
npm ci
npm run setup
npm run package:engine
npm run dev
```

`setup` preserves an existing `.venv`, prefers official Python on macOS, and installs the portable CPU Torch wheel on Windows. Workers start automatically. See [CONTRIBUTING.md](CONTRIBUTING.md) for verification and packaging.

## Test the workflow

1. Open a 3D example, edit dimensions/material, mesh, and run **Classical FEM**. Select boundary faces and edit component supports, total forces or inward pressure.
2. Open **Plane stress · tension**. Inspect the explicit thickness and independent X/Y supports. Run FEM, choose **Physics ML · PINN**, inspect network/training settings, then train or **Compare FEM / PINN**.
3. Inspect actual total/PDE/boundary loss, training step, elapsed time and device. Auto chooses CPU float64 for stable small jobs. MPS uses float32 after a derivative/backpropagation capability check; CUDA appears only when the installed runtime and hardware support it. An unavailable explicit device fails with its reason.
4. Switch FEM/PINN/absolute/relative difference contours, inspect the legend and probes, and compare actual/amplified deformation. **Play** cycles a static solution from zero to maximum and back; it is a visualization, not a dynamics simulation.
5. Change an input to make results stale. Save/reopen a `.phyra` project and export SI CSV fields. Cancel a longer training job; closing the app also stops its owned worker. Exercise native file dialogs and paths containing spaces/non-ASCII characters.

The PINN learns displacement from plane-stress equilibrium and boundary conditions without FEM labels. Stresses are evaluated at the same cell centroids and displacements at the same nodes as FEM. Comparison reports the unweighted relative L2 norm `||PINN − FEM||₂ / ||FEM||₂`, maximum absolute differences and actual timings. A zero reference norm has no relative result. Per-location relative contours omit undefined zero references.

## Scope and limits

3D uses first-order tetrahedra; 2D uses constant-strain triangles with physical thickness. Nonzero component supports and free components are explicit. Reactions, force/moment balance, field associations and input/mesh/run provenance are retained. Invalid, conflicting, under-constrained, oversized or nonfinite inputs fail explicitly. Projects save configuration, measurements, fields and provenance; training restarts from its seed and does not resume saved model weights. Version 1 projects migrate to version 2 with an explicit old-cache discard notice.

PINN results remain experimental: a small loss does not guarantee accuracy or equilibrium. Inspect FEM differences, measured reaction imbalance and mesh convergence. Idealized restraints/corners can cause stress singularities; linear tetrahedra can be stiff in bending. Poisson ratios above 0.45 are rejected. Only rectangular 2D plane stress is implemented; general CAD, multiple materials/bodies, plane strain, contact, nonlinear physics, thermal and fluid studies are outside the current scope.

Analytical/manufactured references and tolerances live beside [engine tests](engine/tests); field/unit/study tests live in [src](src); [native tests](src-tauri/src/main.rs) cover files and worker safety. The packaged workflow check launches actual FEM and PINN comparison outside the checkout. Windows build configuration and CI are included; Windows execution and clean-machine/older-macOS behavior remain unverified. macOS development packages are ad hoc sealed, without a Developer ID signature or notarization.

Phyra is [GPL-3.0-or-later](LICENSE). Required upstream notices are bundled. Public redistribution still requires the target-specific dependency and Corresponding Source obligations in [notices/THIRD_PARTY.txt](notices/THIRD_PARTY.txt).
