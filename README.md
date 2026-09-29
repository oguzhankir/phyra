# Phyra

A local CPU desktop workbench for **3D linear static structural analysis**, built with Tauri 2, React, TypeScript, Three.js, Gmsh, and a headless SciPy engine. No account, hosted solver, discrete GPU, or model download is required. Installed analysis runs offline.

Create dimensioned boxes, cylinders, and connected L brackets; select boundary regions; edit elastic materials, component displacement supports, total surface forces, and inward pressure; mesh, solve, inspect fields, and save a reproducible project. Displacements and reactions are nodal; six stress components and von Mises stress are unsmoothed cell values. SI is canonical; changing displayed metres/millimetres preserves the physical problem.

## Try the application

`npm run package` creates `src-tauri/target/release/bundle/macos/Phyra.app` and a disk image under `src-tauri/target/release/bundle/dmg/`. Open the application bundle or copy it from the disk image to Applications. Development packages have no Developer ID signature or notarization. End users do not need Python, Node, Rust, or a terminal.

The Apple Silicon package passed real solve, displacement/stress rendering, picking/probing, save/reopen, repeated jobs, and cancellation checks outside the checkout on macOS 27. Its native binaries were inspected for architecture, a macOS 14 minimum and absence of developer-library paths. Older-system and clean-machine behavior remain unverified.

Windows x64 installer configuration and native CI are included. A Windows build must be produced on Windows; this checkout has not been executed on a Windows machine. NSIS uses a bundled offline WebView2 installer, increasing the installer size so prerequisites can be installed without an internet connection. Runtime analysis remains offline.

1. Choose **Cantilever beam**, **Axial cylinder**, **L bracket**, or **Prescribed extension** from **Examples**, or start a new project.
2. Edit dimensions and material. Mesh the solid and inspect node/cell counts and the defined tetrahedral quality metric.
3. Select boundaries in the viewport or region list; use the support/load editors to create, edit, or delete assignments. A vector force is one total over all selected faces. Positive pressure acts inward.
4. Click **Solve**; inspect displacement, cell stress, reactions, equilibrium, legend, and surface probes. Compare **Actual scale · ×1** and amplified deformation independently of the contour field.
5. Change a load to make the old solution stale, then solve again. Save, close, reopen, and use **Export physical fields** for SI CSV tables with units and entity associations. During a longer run, exercise **Cancel**; close the application to check worker cleanup.

See [CONTRIBUTING.md](CONTRIBUTING.md) for exact local setup, test, development, and package commands on macOS and Windows.

## Numerical scope and verification

One connected homogeneous isotropic solid, small displacement/strain, first-order tetrahedra, float64 sparse elasticity. Supports can prescribe nonzero displacements and leave components free. Under-constraint, conflicting supports, invalid meshes/materials, nonfinite values, and resource limits fail explicitly. Reactions use the original equilibrium equations. Results carry input, mesh, study, and execution provenance; altered or stale cache data is rejected.

| Evidence | Location |
| --- | --- |
| Affine patch, independent axial solution, nonzero supports, force/moment balance, rigid modes | [engine/tests/test_mechanics.py](engine/tests/test_mechanics.py) |
| Three primitive volume meshes and rejected inputs | [engine/tests/test_mesh_validation.py](engine/tests/test_mesh_validation.py) |
| Versioned worker protocol, binary cache integrity and stale-result rejection | [engine/tests/test_protocol.py](engine/tests/test_protocol.py) |
| Field mapping, units, constant contours, deformation scaling | [src/fields.test.ts](src/fields.test.ts) |
| Atomic project round trips and archive rejection | [src-tauri/src/main.rs](src-tauri/src/main.rs) |
| Packaged renderer, picking/probing, solve, native save/reopen and worker cleanup | [scripts/test-desktop.mjs](scripts/test-desktop.mjs) (passed on macOS 27 Apple Silicon) |

References, assumptions, and tolerances live beside the tests. Numerical verification does not constitute experimental validation or engineering certification. Linear tetrahedra can be stiff in bending; run a mesh study. Poisson ratios above 0.45 are rejected. Curved surfaces are piecewise planar in the analysis mesh. Stress peaks near idealized restraints and bracket corners can be singular. General CAD import, multiple materials/bodies, contact, nonlinear physics, and ML are outside the implemented scope.

## License and future work

Phyra uses [GPL-3.0-or-later](LICENSE), matching the combined Gmsh distribution. Required upstream texts live in `notices/` and are bundled with the application. Public redistribution still requires the target-specific dependency/source obligations described in [notices/THIRD_PARTY.txt](notices/THIRD_PARTY.txt); local build success does not complete that legal audit.

The architecture distinguishes projects, physics studies, executions, and fields. Future contributions may extend thermal, fluid, multiphysics, and Physics ML methods; these are directions, not current features or promised dates.
