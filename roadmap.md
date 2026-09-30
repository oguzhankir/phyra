# Phyra — Product Vision and Roadmap

**Reviewed:** 30 September 2026

This is the single product roadmap for Phyra. It records the implemented foundation, the intended engineering scope, and the evidence required to expand that scope. Future capabilities are proposals, not availability claims. Horizons depend on maintainers, research results, funding, licensing and platform evidence; they are not delivery dates.

**Contents**

1. [Product vision](#1-product-vision)
2. [Verified starting point](#2-verified-starting-point)
3. [Development programme](#3-development-programme)
4. [Geometry, CAD and meshing](#4-engineering-preparation-geometry-cad-and-meshing)
5. [Physics and physical conditions](#5-physics-and-physical-condition-coverage)
6. [Physics ML methods](#6-physics-ml-method-strategy)
7. [Engineering assistant and BYOK](#7-engineering-assistant-byok-and-agent-workflows)
8. [Professional interface and explanation](#8-professional-interface-explanation-and-presentation)
9. [Acceptance gates](#9-scientific-and-product-acceptance-gates)
10. [Architecture, platforms and scale](#10-architecture-platforms-and-scale)
11. [Community and ownership](#11-community-and-sustainable-ownership)
12. [First execution priorities](#12-first-execution-priorities)
13. [Risks and revision policy](#13-risks-decisions-and-revision-policy)

## 1. Product vision

**Phyra will help engineers and researchers prepare complete physical problems, solve and investigate PDEs through validated Physics ML methods, and work with an intelligent assistant that can explain, inspect and improve their studies under their control.**

The long-term ambition is a professional engineering workbench with capable geometry, assemblies, materials, loads, boundary conditions, meshing and scientific postprocessing. Users should be able to describe a real engineering problem without reducing it to the few cases convenient for a neural network demonstration.

The principal differentiation is the combination of engineering preparation with Physics ML: learning solution operators, identifying unknown parameters, accelerating repeated studies, building physics-consistent hybrid methods, and supporting informed design decisions. Classical methods remain essential for independent references, dataset generation, correction and fallback. The desktop is the engineering workbench; the long-term engine is an execution layer for bounded numerical methods and externally supplied models, rather than a requirement to reimplement every neural architecture. The roadmap does not assume that Phyra can quickly reproduce the accumulated solver breadth of mature engineering suites.

Two AI layers have distinct responsibilities:

| Layer                 | Responsibility                                                                                                     | Evidence of success                                                                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| Numerical Physics ML  | Approximate or help solve a defined physical problem; learn reusable mappings; estimate parameters and uncertainty | Independent physical references, field and quantity-of-interest errors, conservation, applicability and measured cost |
| Engineering assistant | Explain the product, inspect studies, propose changes and coordinate permitted numerical tools                     | Grounded answers, correct units, reviewable changes, enforced permissions and traceable tool results                  |

An assistant's fluent answer cannot certify a numerical solution. A small training loss cannot establish engineering accuracy. Both layers must reveal their assumptions and limits.

### Five product principles

1. **Complete problem preparation.** Geometry, material assignments, constraints and physical conditions are first-class capabilities. Their scope must grow alongside the numerical methods.
2. **Physics ML with a purpose.** Choose methods for the problem family and intended benefit. Per-problem training, reusable operators and hybrid acceleration are different products with different costs.
3. **Evidence before promotion.** A research prototype becomes a supported feature only after scientific, workflow and target-platform validation.
4. **Engineering clarity.** The interface should help users understand what is being modeled, why a method applies, and whether a result is current and trustworthy.
5. **Open, local and composable.** Local analysis remains useful without an account or API key. Research integrations and optional remote compute should extend the workbench through explicit contracts.

### The experience this roadmap aims to enable

**A mechanical design study:** an engineer imports a STEP assembly, repairs a small gap, preserves named mounting surfaces, assigns materials and connections, and defines multiple load cases. Phyra explains available formulations and missing capabilities. A validated Physics ML model accelerates a bounded design family; independent checks and classical correction remain available. A geometry edit that breaks a boundary assignment produces an explicit repair task.

**A cooling-system investigation:** an engineer prepares solid and fluid domains, defines heat sources and inlet/outlet conditions, and evaluates temperature and pressure drop. The assistant helps diagnose missing conditions and coordinates a bounded parameter sweep. The numerical methods report energy and mass balance, model applicability and uncertainty. Conjugate heat transfer becomes available only after its component solvers and conservative coupling are validated.

**A research-to-product contribution:** a researcher adds a weak-form or geometry-aware method against an existing benchmark contract. Other contributors reproduce its accuracy, failure cases and cost on supported hardware. Users can inspect its method card and examples before choosing it. A published paper alone does not change its product status.

## 2. Verified starting point

“Completed” below means implemented and verified within the stated scope. It does not mean comprehensive industrial coverage. “Experimental” means a real numerical implementation whose engineering applicability remains restricted. “Partial” means an existing foundation still has a material product or verification gap. Everything in later sections is planned or research unless explicitly listed here.

| Capability                                      | Status                                 | Verified scope and remaining limit                                                                                                                                                                                                           |
| ----------------------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop and owned numerical workers             | Completed                              | Tauri 2, React/TypeScript and Three.js; isolated local Python jobs, cancellation and cleanup                                                                                                                                                 |
| Basic geometry-to-results workflow              | Completed, limited                     | Parametric box, cylinder and connected bracket solids; rectangular 2D domains; no general sketcher or imported CAD                                                                                                                           |
| 3D classical elasticity FEM                     | Completed, limited                     | Homogeneous isotropic, small-strain linear static solids with first-order tetrahedra                                                                                                                                                         |
| True 2D classical elasticity FEM                | Completed, limited                     | Rectangular plane stress, constant-strain triangles and physical thickness                                                                                                                                                                   |
| Basic supports and loading                      | Completed, limited                     | Component restraints, nonzero prescribed displacement, total force and inward pressure on supported boundaries                                                                                                                               |
| 2D elasticity PINN                              | Experimental, implemented              | Rectangle-only plane stress; real PyTorch/autograd PDE/boundary terms, seeded training and measured losses; new independent-point residual diagnostics without a field-error guarantee                                                       |
| FEM/PINN comparison                             | Completed, limited                     | Same nodes and cell centroids; unweighted relative L2 and maximum differences; absolute/relative comparison fields                                                                                                                           |
| Result inspection                               | Completed, limited                     | Displacement/stress fields, probes, units, deformation and undeformed overlay; animation scales a static solution and is not dynamics                                                                                                        |
| Run ownership and persistence                   | Completed                              | Input fingerprints, stale-result rejection, run metadata, safe versioned `.phyra` archives, migration and SI CSV exports                                                                                                                     |
| Browser result preview                          | Completed, limited                     | Inspect actual saved CPU FEM/2D comparison fields, recorded history and provenance; new computations and native project files require the desktop app                                                                                        |
| Primitive preparation controls                  | Completed, limited                     | Replace/add/toggle selection, standard cameras, fit/reset and boundary isolation; distance between undeformed mesh nodes or primitive-preview vertices; no exact CAD measurement |
| Copied named boundary sets                      | Completed, limited                     | Up to 100 persisted sets with primitive/dimension stamps; explicit orphan repair; support/load copies remain independent of later set edits; no associative CAD links |
| Session definition undo/redo                    | Completed, bounded                     | Up to 80 transactions within 16 MiB; physical undo/redo advances the current revision and cannot reactivate old fields; replacements reset session history |
| Definition-only recovery                        | Completed, limited                     | Debounced validated dirty definitions, invalid-draft pausing and restore/discard; hosted packaged checks verify native journal isolation and reload ownership. Restored projects have no original file association, result arrays or weights |
| Training persistence                            | Partial                                | Settings, seeds, measurements and results persist; trained weights and resumable checkpoints do not                                                                                                                                          |
| Device support                                  | Partial                                | CPU float64 reference; measured MPS float32 capability on available hardware; CUDA execution remains unverified and Windows setup defaults to CPU                                                                                            |
| macOS distribution                              | Partial                                | Apple Silicon package and actual workflows verified locally and on hosted macOS 15; minimum macOS 14, manual consumer installation/dialogs/uninstall and production signing/notarization remain open                                         |
| Windows distribution                            | Partial                                | Hosted Windows Server 2022 x64 package and actual rendering, FEM/PINN, persistence and cancellation verified; manual consumer installation/dialogs/uninstall, hardware coverage and production distribution trust remain open                |
| Professional workflow, identity and help        | Implemented; usability validation open | Workflow navigation, model tree/inspector, neutral light/charcoal themes, finalized vector identity, offline searchable/contextual method and task guides                                                                                    |
| CAD import, assemblies and advanced preparation | Planned                                | No neutral/native CAD import, general sketching, multiple materials/bodies, contact or advanced mesh families                                                                                                                                |
| Broader physics, operators and uncertainty      | Planned / research                     | No thermal, fluid, nonlinear, dynamic, electromagnetic or acoustic solver; no learned operators or calibrated uncertainty                                                                                                                    |
| BYOK chat and engineering agents                | Planned                                | No provider adapters, API-key storage, in-product chat or tool-using assistant                                                                                                                                                               |

Baseline evidence is in the numerical and workflow implementation, [independent engine references](engine/tests), [frontend domain/feature tests](src/domain), [native lifecycle/persistence tests](src-tauri/src/tests) and [packaged workflow verifier](scripts/test-desktop.mjs). **Current runtime evidence:** [verification at `3498f34`](https://github.com/oguzhankir/phyra/actions/runs/36761517423) passed 168 frontend, 234 quick Python, 3 slow numerical and 38 macOS/37 Windows native tests. Both macOS 15 Apple Silicon and Windows Server 2022 x64 passed packaging and actual FEM/PINN, rendering, save/reopen, cancellation, recovery and method/device workflows. This covers the current preparation and project-version implementation, whose production code is unchanged after integrating the current repository documentation. It does not establish representative-user usability, minimum macOS 14 execution or manual consumer installation.

Project version 3 adds copied boundary-set metadata. Legacy definitions are validated against frozen v1/v2 schemas before migration: v1 caches are discarded, while v2 caches can remain only after normal ownership, physical-fingerprint and field validation. The physical digest retains its v2 representation because named sets do not change the equations or assignments. Older recovery journals migrate in memory, preserving the original bytes during discovery/read.

Current safety limits include 12,000 nodes, 50,000 cells, 100,000 surface triangles, a 64 MiB binary-buffer limit and a 1 MiB JSON limit, plus 100 named sets and an 80-transaction/16 MiB edit-history budget. Scaling beyond them requires measured memory, rendering, persistence and numerical behavior. Increasing a constant is not a scalability milestone.

## 3. Development programme

Work proceeds across parallel tracks: product experience, engineering preparation, numerical methods, AI assistance, and platform/community infrastructure. A phase describes a demonstrable product outcome, not a requirement to finish every earlier wishlist item. Individual physics capabilities retain their own dependencies and acceptance gates.

| Horizon                                                | Intended outcome                                                                                                     | Main phases                                                |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Near term; roughly the next year if adequately staffed | A comprehensible, dependable desktop workbench; honest capabilities; first complete imported-part workflow           | P1 and the first P2 slice; bounded P3 research in parallel |
| Medium term; roughly 1–3 years                         | Substantial engineering preparation, selected thermal/fluid problems, inverse studies and reusable Physics ML models | P2–P4, delivered by validated problem family               |
| Long term; roughly 3–5+ years                          | Geometry-aware learning, richer materials/connections, advanced workflows and selected coupled problems              | P4–P5 and a sustainable contributor ecosystem              |
| Continuing research horizon                            | Wider industrial preparation coverage and new physical/method families where evidence supports them                  | P6; revised as the field evolves                           |

### P0 — Establish the local scientific foundation

**Status: completed within the limited baseline; PINN remains experimental.**

The existing geometry → mesh → FEM/PINN → comparison → save/reopen loop is the starting point. Preserve its independent references, units, cancellation and result ownership throughout later work. Broader physics, representative-user usability and consumer distribution are not part of this completion claim.

### P1 — Make the current product understandable and dependable

**Status: partially delivered in v0.1.0. Minimum-version, consumer distribution and representative-user validation remain open.**

The first launch slice delivers the workspace, scientific palette, identity, offline Workbench help, contextual F1 help and an inspectable browser reference preview using actual CPU solution data. README and help screenshots show the current interface inspecting saved CPU references; the unchanged video records the preceding interface and final recapture is deferred. New computations remain native desktop jobs. Current UI features are organized under `src/features/`; application lifecycle, domain rules, native bridge and reusable controls have separate ownership. This is implementation evidence, not a claim of the usability acceptance rate below.

- **Delivered, bounded to current studies:** workflow navigation, a grouped model tree, clear study/result context, replace/add/toggle boundary selection and actionable input/stale-result diagnostics. More granular entity filters and command search remain future improvements.
- **Delivered for current capabilities:** offline method cards, runnable examples and contextual explanations of every currently available input, screen, limitation and result.
- **Delivered:** establish the neutral light theme, restrained dark theme and professional identity described in section 8.
- **Delivered on hosted targets:** macOS 15 Apple Silicon and Windows Server 2022 x64 packaged workflows. Verify minimum macOS 14 and manual consumer installation/dialogs/uninstall on both targets; resolve distribution obligations before public binaries.
- **Deferred beyond the first launch:** introduce optional BYOK, native provider adapters and read-only, study-grounded chat. This release implements no assistant or provider integration; numerical analysis remains usable offline.
- Improve existing PINN evaluation, nondimensionalization and multi-seed reporting before widening its advertised applicability.

**Exit gate:** representative new users can configure, solve, interpret and reopen an existing supported study without critical unit, boundary-selection or stale-result mistakes. Both primary platforms complete packaged solve/cancel/save/reopen workflows. Help accurately describes the running release.

**Later assistant extension gate:** numerical values shown by the assistant are traceable to identified tool results; a declared grounded-answer/adversarial evaluation passes published failure criteria. Credential isolation and leak tests pass.

### P2 — Complete the first imported engineering problem

**Status: the limited primitive-preparation slice is completed; the imported-part outcome remains planned. Depends on stable geometry identity, units and capability contracts.**

The delivered slice combines model-tree/inspector selection, copied persisted boundary sets, explicit topology/dimension repair, bounded definition undo/redo, standard camera tools and undeformed node/preview-vertex measurement. These controls prepare the existing primitives; they do not establish a CAD kernel, constrained sketcher, associative topology or imported-part capability. Current [domain tests](src/domain/project), [viewport tests](src/features/viewport) and [native archive/recovery tests](src-tauri/src) cover the corresponding boundaries; the current runtime also passes hosted packaged workflows on both primary targets.

- Select a CAD-kernel integration and a separate sketch-constraint approach through working prototypes and redistribution review.
- Deliver STEP-first part import, inspectable healing, geometric named selections and reliable remeshing; add basic constrained sketching and extend definition history to validated CAD feature history.
- Introduce parts, instances and body-specific materials without silently merging assemblies. Extend linear elasticity to documented general domains and selected formulations.
- Add load cases, local coordinate systems and selected structural conditions from the coverage catalogue.
- Add supported mesh families/order only with numerical and field validation; expose mesh-quality diagnostics and convergence studies.
- Extend result tools with sections, paths, integrals and controlled comparison. Allow the assistant to propose typed model changes and execute specifically authorized bounded tools.

**Exit gate:** a reference imported part can be modified, assigned physical conditions, remeshed, solved and reopened on both platforms. Unit conversion, geometry validity and force/moment balance pass independent checks. Ambiguous geometry references block solving until repaired. Unsupported combinations are rejected before execution.

### P3 — Deliver validated Physics ML for selected PDE families

**Status: planned, with research evaluations.**

- Mature the existing PINN on several independent elasticity references; compare strong-form, variational/weak-form and adaptive sampling approaches.
- Add steady heat conduction first, then transient conduction with independent energy and time-convergence checks. Pilot conductivity/source identification from measurements.
- Establish Stokes and bounded laminar incompressible-flow cases with a stable velocity–pressure formulation, appropriate pressure reference and mass balance. Validate inf-sup compatibility or justified stabilization in the reference discretization.
- Add measurement import, noise models, parameter bounds and identifiability checks for small inverse studies.
- Evaluate differentiable classical components and learned initial guesses/corrections. Keep conventional numerical correction available where appropriate.
- Introduce safe model checkpoints and experiment provenance; separate “train this problem” from “apply an existing model.”

**Exit gate:** each released problem family publishes its equations, conditions, references, error measures, failures, supported devices and applicability. Numerical benefits are demonstrated beyond a low training loss. Thermal and fluid branches can advance independently; unsupported regimes remain unavailable.

### P4 — Make Physics ML reusable across engineering studies

**Status: planned. Depends on reliable datasets and P3 family-level evidence.**

- Build reproducible parameter-study generation, licensed dataset manifests and simulation-level train/validation/test splits.
- Pilot FNO/DeepONet on bounded parameter families, followed by mesh/graph and geometry-aware operators where representations are validated.
- Provide training, validation, inference and model-selection workflows with explicit compatibility checks for geometry, conditions, materials and parameter ranges.
- Add calibrated uncertainty, applicability detection, reference correction and active-learning loops.
- Deliver budgeted assistant workflows for parameter sweeps, comparison, diagnosis and optimization candidate generation.
- Publish end-to-end cost and reuse break-even measurements against optimized classical baselines.

**Exit gate:** models demonstrate useful accuracy and benefit on held-out physical instances. Geometry generalization is tested separately from new parameter values. Out-of-scope requests abstain or use an available reference route; they do not silently return plausible fields.

### P5 — Expand to advanced engineering and coupled systems

**Status: planned / research, by problem family.**

- Extend structural formulations, dynamics, material behavior, connections and contact through their individual validation gates.
- Expand thermal/fluid preparation and supported regimes; evaluate learned closures and multiscale methods against appropriate references.
- Introduce thermal–structural coupling first where suitable, then conjugate heat transfer and fluid–structure interaction after component and interface validation.
- Add selected electrostatic and acoustic problems before full electromagnetic/wave families; support complex fields and frequency studies explicitly.
- Evaluate shape/topology optimization, sensitivity, reduced models and calibrated material surrogates on declared domains.
- Support larger studies, optional workstation/cluster execution and independently developed method integrations.

**Exit gate:** coupled studies preserve interface flux/work and demonstrate stable mesh/time refinement. Contact and history-dependent materials pass dedicated references. Every advanced workflow is usable from preparation through interpretation, not merely callable from a research script.

### P6 — Grow a durable open engineering ecosystem

**Status: long-term direction and research portfolio.**

Extend preparation coverage systematically toward the needs of mature multidisciplinary analysis workflows. Develop domain maintainers, reproducible benchmark collections, stable extension interfaces and a clear experimental-feature lifecycle. Evaluate difficult regimes such as turbulent/compressible/multiphase flow, fracture, fatigue, composites, manufacturing processes and full electromagnetic systems when domain expertise and evidence exist.

The ambition is broad coverage without a permanent catalogue of unfinished modules. A method may remain experimental, be replaced, or be retired if its accuracy, robustness, usability or cost does not justify product support.

## 4. Engineering preparation: geometry, CAD and meshing

Mature workbenches combine geometry preparation, many physical formulations and postprocessing; this breadth informs the target, rather than implying current parity. The [SIMULIA multidisciplinary portfolio](https://www.3ds.com/products/simulia/3dexperience-simulia) illustrates this scope. CAD foundations must distinguish a modeling kernel from sketch constraints, feature history, assemblies and a complete user workflow; see [FreeCAD's feature overview](https://www.freecad.org/features.php) and [OCCT's technical overview](https://occt3d.com/dev/doc/overview/html/index.html).

### Geometry and interoperability catalogue

The current CAD-07 preparation slice is limited to copied boundary groups on supported primitives. Remeshing preserves those region identifiers; primitive/dimension changes keep incompatible sets visible for explicit repair. General point/edge/face/body queries, reimport mappings and associative condition updates remain planned.

| ID     | Intended capability                                                                                                                 | Acceptance boundary                                                                                                                                              |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CAD-01 | Lines, arcs, circles, polylines; dimensions; coincident, parallel, perpendicular, tangent and concentric sketch constraints         | Show under/fully/over-constrained states; explain conflicts; dimensions, undo/redo and reopen reproduce geometry                                                 |
| CAD-02 | Extrude, revolve, sweep, loft; Boolean operations; holes, patterns, fillets, chamfers and datum systems                             | Validated B-rep operations and dependency history; failed edits preserve the previous model                                                                      |
| CAD-03 | Parts, instances, placements, assemblies, suppression and body assignments                                                          | Instance identity survives transformations; separate, bonded and contact behavior is explicit                                                                    |
| CAD-04 | STEP first; IGES for appropriate legacy exchange; STL/OBJ as discrete surfaces; DXF for supported 2D entities                       | Test units, shape validity, body count and metadata; faceted data is not presented as editable solid history                                                     |
| CAD-05 | Parasolid and native CAD adapters; drawing exchange including evaluated DWG routes; connectors for established mechanical CAD tools | Format/version/platform/licensing matrix and actual file corpus; independent import, linked update and bidirectional parameter editing are separate capabilities |
| CAD-06 | Healing, stitching, small-feature removal, simplification; later midsurfaces and idealization                                       | Show tolerances and geometry changes; preserve the original; do not silently accept major volume/area changes                                                    |
| CAD-07 | Named point/edge/face/body selections, geometric queries and reimport mappings                                                      | Remesh preserves valid selections; split/merge ambiguity produces orphan/repair diagnostics, never silently moved conditions                                     |
| CAD-08 | Fluid-volume extraction, enclosure/far-field creation and domain partitioning                                                       | Watertightness, connectivity, orientation and solid/fluid/interface ownership are verified                                                                       |

Neutral geometry exchange does not promise original feature history, assembly mates or every metadata field. Native CAD and live connectors may need licensed translators, an installed source application or platform-specific components. Evaluate access and redistribution separately; an isolated worker does not by itself establish GPL compatibility. These distinctions are documented in [supported CAD format/platform tables](https://www.comsol.com/support/learning-center/article/supported-file-formats-76161), [CAD repair and associative import workflows](https://www.comsol.com/cad-import-module) and the [Parasolid component offering](https://www.siemens.com/en-us/products/plm-components/parasolid/).

### Discretization catalogue

| ID      | Intended capability                                                                                      | Acceptance boundary                                                                                                                 |
| ------- | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| MESH-01 | Global/local sizing, curvature/proximity refinement, edge divisions and structured/unstructured controls | Preview intended controls; report quality and failed regions; preserve physical groups                                              |
| MESH-02 | Triangle/quad/tet/hex/prism/pyramid and appropriate higher-order families                                | Version cell blocks and node ordering; accept only families supported by the chosen formulation and result pipeline                 |
| MESH-03 | Swept meshes, transitions and fluid boundary layers                                                      | State supported domains; verify layer thickness/growth, wall resolution, signed Jacobians, inversions and higher-order cell quality |
| MESH-04 | Error-driven h/p refinement and convergence studies                                                      | Use a justified estimator and target quantity; preserve field-transfer provenance and demonstrate error reduction                   |
| MESH-05 | Collocation, quadrature, boundary samples and operator query representations                             | Associate samples with geometry/conditions; check integration and coverage independently of training                                |

The mesher's capability is not solver support. In particular, Gmsh's `BoundaryLayer` size field is a 2D facility; general 3D layers require separately validated extrusion/decomposition routes. See the [Gmsh reference manual](https://gmsh.info/doc/texinfo/gmsh.html). A mesh-free learning method still needs reliable geometry, normals, interfaces, integration and physical-condition ownership.

## 5. Physics and physical-condition coverage

The long-term objective is comprehensive preparation within each declared physics family. Track coverage through a finite, versioned matrix rather than claiming “all boundary conditions.” Each entry specifies equation/formulation, entity dimension, degrees of freedom, coordinate frame, units, time dependence, material/contact compatibility, numerical method, output fields and reference tests. An input widget or schema field is not support evidence.

### Structural preparation catalogue

- **Formulations:** general plane stress, plane strain, axisymmetry and 3D solids; beams, trusses, plates, shells, membranes and appropriate transitions. Rotational degrees of freedom appear only for formulations that possess them.
- **Conditions:** prescribed components, normal/tangential rollers, symmetry, periodicity, multipoint constraints, rigid/deformable remote coupling, springs/dampers, joints and tied interfaces.
- **Loading:** total force versus traction, pressure, edge/point/body loads, gravity, moments, temperature-induced strain, preload and bolt pretension; later centrifugal/rotating-frame, moving and follower loads with the necessary formulations.
- **Materials:** body-specific isotropic, orthotropic and anisotropic properties/orientations; then composites, hyperelasticity, plasticity, viscoelasticity, temperature dependence and history variables.
- **Connections:** bonded interfaces first; frictionless contact, then friction, finite sliding and appropriate fastener/joint idealizations. Evaluate action–reaction, penetration, dissipation and convergence independently.
- **Studies:** load cases and combinations; modal, harmonic and transient response; geometric/material nonlinearity, buckling and postbuckling; later fatigue, fracture, damage and rotordynamics with specialized evidence.

These are separate capability classes, informed by the [structural mechanics taxonomy](https://www.comsol.com/structural-mechanics-module). They must not be exposed as working Physics ML features until the corresponding physical and numerical contracts pass validation.

Use feature-specific references: rotated roller/symmetry equivalence; analytical gravity-loaded bars and spring stiffness; periodic uniform-strain cells; remote-force/torque balance; free and restrained thermal expansion; contact opening/closure followed by Hertz-type and stick/slip cases. Linear load combinations and result superposition require compatible linear studies. Nonlinear, contact and history-dependent cases require solving the actual combined loading path.

### Engineering materials programme

Current support is one homogeneous isotropic linear elastic material per study. Every capability below is planned. A material editor, library label or external framework does not establish a constitutive implementation. Extend materials together with geometry assignment, formulation, state persistence, physical outputs and independent reference tests.

| ID     | Material capability                                                    | Necessary definition and dependencies                                                                                                                                                                         | Scientific promotion gate                                                                                                                                                  |
| ------ | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MAT-01 | Multiple materials and traceable property records                      | Stable body/region assignment; SI dimensions; property source, revision, test conditions and applicability. Density, thermal coefficients and strength are accepted only when a formulation uses them         | Two-material interface/manufactured cases; assignment survives remesh/reopen; example values remain separate from certified data                                           |
| MAT-02 | Orthotropic, transversely isotropic and general anisotropic elasticity | Explicit right-handed material axes and spatial orientation; declared tensor/shear convention; reciprocal compliance and positive-definite elastic energy                                                     | Rotated material-frame equivalence, patch tests, independent directional loading and energy checks; reject physically inadmissible matrices                                |
| MAT-03 | Laminated and layered composites                                       | Ply material, thickness, orientation, stacking direction and reference surface; compatible shell/plate or resolved solid formulation; membrane/bending coupling and thermal expansion                         | Independent laminate stiffness/resultants, symmetric/unsymmetric layups, thickness/orientation changes and convergence; distinguish ply, laminate and interlaminar outputs |
| MAT-04 | Functionally graded materials and heterogeneous coefficients           | Versioned spatial property laws, coordinates and length scales; integration-point evaluation; phase fractions and homogenization assumptions where used; positive admissible properties throughout the domain | Graded analytical/manufactured cases and quadrature/refinement studies; resolved interface checks for discontinuities; PINN residuals include coefficient variation        |
| MAT-05 | Hyperelasticity and finite deformation                                 | Strain-energy law, compatible finite-strain kinematics/stress measures and constitutive tangent; volumetric treatment and mixed formulations where necessary                                                  | Objectivity, energy/stress/tangent derivative checks, uniaxial/shear/volumetric references and large-deformation convergence                                               |
| MAT-06 | Plasticity and rate-dependent inelasticity                             | Yield surface, flow rule, hardening, local integration, consistent tangent and bounded increments; state variables belong to integration points                                                               | Yield onset, loading/unloading, multiaxial paths, dissipation and step convergence; exact restart state rather than a fresh model                                          |
| MAT-07 | Viscoelasticity and creep                                              | Relaxation/retardation or other calibrated law, time/temperature conventions and internal memory; compatible transient or frequency formulation                                                               | Relaxation, creep/recovery, time-step and long-duration references; consistent frequency/time behavior where both are offered                                              |
| MAT-08 | Damage, failure, fracture and fatigue                                  | Distinct initiation/propagation laws, regularization and length scales, calibrated strengths and load-history requirements; cohesive/interface or fracture formulation when needed                            | Mesh-objective energy/dissipation, benchmark crack/interface evolution and independent failure data; an index alone is not life prediction                                 |
| MAT-09 | Learned and data-driven constitutive models                            | Declared stress/strain measures, state, training paths, units, data rights and admissible domain; symmetry/objectivity and thermodynamic constraints appropriate to the law                                   | Held-out material/load paths, tangent checks, cyclic/irreversible behavior, stability inside a solver and explicit rejection outside applicability                         |

Material data and constitutive algorithms should have separate versions. Changing a property law, orientation or assignment invalidates dependent results and model compatibility. The material contract must distinguish reversible elastic parameters from path-dependent internal state; a scalar property dictionary cannot safely represent both. Coordinate transforms, engineering-shear factors and unit conversions are authoritative scientific operations with their own tests.

For laminates, classical plate theory supplies a bounded reference for extensional, coupling and bending stiffness. It does not establish interlaminar failure or a complete strength model. Start with lamina axes and independently calculated laminate resultants before adding shell integration, ply-level recovery or failure criteria. [NASA RP-1351, Basic mechanics of laminated composite plates](https://ntrs.nasa.gov/citations/19950009349), provides a primary constitutive reference and explicitly excludes strength prediction.

For graded materials, preserve the physical spatial law instead of disguising it as a nonphysical temperature field. Nodal interpolation, piecewise-constant coefficients and integration-point evaluation are different approximations and need explicit quadrature and convergence evidence. [Martínez-Pañeda's FGM implementation study](https://arxiv.org/abs/1901.05738) documents why these choices can change results. Discontinuous material interfaces additionally require displacement/traction or other physics-specific continuity conditions; a smooth single-network residual is not automatically valid across them.

Learned constitutive models are not interchangeable with learned solution operators. They must be exercised within the actual increment/integration loop, under unseen loading paths, and checked for numerical stability, physically admissible work and tangent consistency. Saving model weights alone cannot reproduce a history-dependent study: integration-point state, loading path and solver settings must also be versioned and recoverable.

### Complete solid-mechanics vertical slices

Preparation must advance with the solver. Prioritize imported connected solids with persistent selections and body-specific materials, followed by validated bonded assemblies and then appropriate shell/beam transitions. Contact, finite sliding, preload, follower loading and geometric nonlinearity need a compatible incremental formulation; dynamics requires mass, damping, initial conditions and time integration. Modal and buckling eigenproblems need distinct operators, normalization and prestress definitions. Optimization needs declared design variables, constraints, valid sensitivities and independent reanalysis of the proposed design.

Lattice/architected structures and aerospace-scale assemblies are long-term preparation and scaling targets. Their thin members, repeated topology, anisotropy, connections and instability must survive geometry, meshing, model reduction and field inspection. A visually elaborate part is not a verified simulation. Admission gates include connectedness and feature resolution, local/global buckling where applicable, material/connection ownership, mesh convergence and measured memory/runtime limits.

### Physics expansion matrix

| Family and intended sequence               | Preparation and outputs that must accompany it                                                                                         | Candidate Physics ML value                                                                 | Independent promotion evidence                                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Linear elasticity → broader formulations   | Materials/orientations, supports, tractions/body loads, displacement, stress, strain, reactions and energy                             | Weak/energy methods, parameter inference, bounded solution operators and hybrid correction | Patch/manufactured references, balance and mesh refinement                                                                                  |
| Steady → transient heat conduction         | Temperature, flux, sources, Robin exchange, initial temperature, capacity, conductivity and interface resistance                       | Inverse conductivity/source estimation; thermal operators                                  | Analytical conduction/transient cases, energy and time convergence                                                                          |
| Stokes → laminar incompressible flow       | Velocity/flow-rate inlet, pressure/outflow, walls/slip/symmetry, pressure reference, density/viscosity, initial fields                 | Bounded pressure/velocity operators, initial guesses and correction                        | Channel/cavity references, continuity, pressure drop, force and transient stability                                                         |
| Richer thermal/fluid regimes               | Convection, radiation, buoyancy, conjugate domains; compressibility, shocks, turbulence/wall treatment and rotating domains separately | Validated closures, multiscale operators and regime-specific surrogates                    | Regime-specific conservation, wall/mesh/time resolution and independent data                                                                |
| Multiphase, porous and transport problems  | Phase/interface conditions, permeability, species/concentration, diffusion/reaction, source terms and initial states                   | Bounded transport operators and inverse coefficients                                       | Mass/species balance, interface motion and reaction/front benchmarks                                                                        |
| Nonlinear structures and dynamics          | Load/time increments, constitutive states, contact, inertia/damping and consistent stress/strain measures                              | Material calibration, energy-consistent surrogates, reduced dynamics and hybrid predictors | Objectivity and consistent constitutive tangents; loading/unloading, contact, modal/time and energy references                              |
| Electrostatics → selected electromagnetics | Potential/charge/current, grounding, material interfaces; later curl/div-compatible fields, sources and absorbing boundaries           | Parameter inference and constrained operator families                                      | Charge/energy checks; appropriate analytic/interface/frequency references                                                                   |
| Acoustics and waves                        | Pressure/displacement excitation, impedance, radiation/absorbing conditions, complex fields and frequency/time definitions             | Bounded-band operators and inverse impedance/material studies                              | Amplitude, phase, reflection, resonance and energy errors                                                                                   |
| Coupled systems                            | Thermal–structural → conjugate heat transfer → FSI; later selected electrothermal/piezoelectric and other couplings                    | Coupling predictors, calibrated reduced models and optimization                            | Verified components and conservative transfer; transient FSI additionally requires synchronized time steps and coupled/added-mass stability |

Thermal and fluid preparation should retain the breadth of [heat-transfer modes and interfaces](https://www.comsol.com/heat-transfer-module) and [flow-regime/closure distinctions](https://www.comsol.com/cfd-module), even when only a small subset is initially solvable. Full electromagnetic and acoustic families require additional field representations; coupled analysis requires more than combining two independent predictions.

Custom PDE work belongs to a later validated research interface: declared unknowns, units, residual/weak form, coefficients, initial/boundary/interface conditions and references. Start with reviewed, typed definitions. Do not imply that an arbitrary equation entered by a user or generated by a chatbot is automatically well posed or reliably solvable.

## 6. Physics ML method strategy

Physics ML is a portfolio, not a synonym for PINNs. Current frameworks encompass operators, graph models and hybrid approaches as well as residual-based training; the [PhysicsNeMo overview](https://docs.nvidia.com/physicsnemo/latest/overview.html) is one implementation reference, not a required dependency or proof of Phyra support.

| Method track                                  | Intended role and prerequisites                                                                                          | Promotion gate                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| Strong-form PINNs                             | Per-problem forward/inverse solutions; verified derivatives, scaling, conditions and sampling                            | Hold-out field/physical errors across multiple seeds; boundary and difficult-case performance; explicit failure reporting |
| Variational, energy and weak-form methods     | Suitable elasticity/Poisson families; admissible trial fields, correct energy/weak form and integration                  | Compare against strong-form and independent references; distinguish quadrature error from optimization error              |
| Domain decomposition and multilevel methods   | Multiscale/localized problems after a single-domain benchmark; interface/coarse-level information                        | Subdomain/interface errors, refinement behavior and actual communication/runtime costs                                    |
| Differentiable and hybrid numerics            | Sensitivity, initial guesses, learned corrections/preconditioners or constitutive components                             | Gradient verification; corrected solution reaches the physical tolerance; fallback remains reliable                       |
| FNO and DeepONet                              | Reusable mappings over defined parameter/input families; trustworthy training data or physics-constrained operator setup | Simulation-level held-out accuracy, preprocessing compatibility and total reuse cost                                      |
| Mesh/graph and geometry-aware operators       | Varying domains/meshes with topology, normals, condition labels and geometry representations                             | New geometry/remesh tests; interface preservation; thin features and disconnected bodies; no hidden leakage               |
| Reduced and multiscale models                 | Fast repeated studies and time evolution within declared regimes                                                         | Quantity-of-interest and long-rollout stability; reconstruction and conservation errors                                   |
| Inverse problems and experimental calibration | Measurement schema, noise model, parameter bounds and identifiable observations                                          | Synthetic recovery, noise sensitivity and independent measurements; report non-identifiability                            |
| Uncertainty and active learning               | A reliable predictive family, calibration data and defined distribution shifts                                           | Interval coverage and sharpness, subgroup/OOD checks; compare data acquisition at equal reference budget                  |

The current residual/autograd method is informed by [Raissi, Perdikaris and Karniadakis's original PINN work](https://doi.org/10.1016/j.jcp.2018.10.045), adapted to the implemented plane-stress problem; Phyra does not reproduce every experiment in that paper. Research foundations for future tracks include [PINN failure-mode analysis](https://papers.neurips.cc/paper_files/paper/2021/hash/df438e5206f31600e6ae4af72f2725f1-Abstract.html), [Deep Ritz](https://arxiv.org/abs/1710.00211), [multilevel domain decomposition](https://arxiv.org/abs/2306.05486), [FNO](https://arxiv.org/abs/2010.08895), [the original DeepONet paper](https://doi.org/10.1038/s42256-021-00302-5), [GINO](https://arxiv.org/abs/2309.00583), [Solver-in-the-Loop](https://arxiv.org/abs/2007.00016) and [Bayesian PINNs](https://arxiv.org/abs/2003.06097). Their reported results are problem-specific. Geometry generalization, robust uncertainty and universal solver superiority do not follow from adopting a paper or library.

### Research frontier to reassess, not precommit

Evaluate cross-physics pretraining and transferable scientific models as a later extension of the reusable-model track. Transformer backbones, few-data adaptation and physics-constrained generative ensembles may reduce repeated training or support experiment design. Their admission criteria include data/model rights, adaptation cost, long-rollout behavior, physical checks and held-out regimes. [Multiple Physics Pretraining](https://papers.neurips.cc/paper_files/paper/2024/file/d7cb9db5ade2db7814fbd01ee59f4c7b-Paper-Conference.pdf) demonstrates transfer research on fluid-oriented benchmarks; it does not establish a universal industrial solver.

Also investigate learning missing constitutive/transport laws inside differentiable solvers, multi-fidelity learning and models that preserve symmetry, conservation or thermodynamic constraints. The [missing-physics discovery preprint, revised in 2026](https://arxiv.org/abs/2507.15787), explores the distinction between learning a solution and learning an unknown physical law. Require independent constitutive/experimental checks and identifiable measurements before transferring such laws between configurations. These tracks belong to P4–P6 research and must earn the same promotion gates as simpler methods.

### Training, inference and applicability

Users should be able to choose explicitly between training a problem-specific model, training a reusable model family and applying an existing model. Model records need equations, assumptions, geometry/parameter/condition ranges, material laws, preprocessing, dataset rights, validation results, version, precision and device constraints. Query compatibility is checked before prediction.

The experiment system should preserve seeds, optimizer settings, sampling/quadrature rules, data splits, checkpoints and model provenance in safe, versioned formats. Support interruption and resume only when optimizer/model state is genuinely restored. Existing archives do not provide this capability.

Nondimensionalization, adaptive sampling, boundary enforcement, optimizer comparisons and weak formulations are hypotheses to evaluate, not automatic fixes. Plasticity, friction, shocks and interfaces need appropriate specialized formulations. The current Gmsh/SciPy chain is not automatically differentiable; converting an array to a tensor does not create a derivative through geometry or meshing.

For inverse studies, inspect identifiability before training. A single tensile measurement may determine a load/modulus ratio without identifying both values separately. Additional experiments or prior information may be necessary; low loss does not resolve that ambiguity.

### What “faster” must mean

Report meshing, reference-data generation, preprocessing, training, validation, inference, query checks, memory and available classical cache/factorization separately. Compare at a justified accuracy and against a competent classical baseline.

For comparable repeated queries, an illustrative break-even estimate is:

```text
N_break_even = (T_data + T_training + T_validation)
               / (T_reference_query - T_prediction - T_query_checks)
```

If the denominator is nonpositive, the measured scenario has no time-amortization advantage. Preview speed, experiment design or candidate screening may still be useful, but those benefits must be measured separately. No speedup number is a roadmap promise.

## 7. Engineering assistant, BYOK and agent workflows

### Provider independence with honest capability support

Offer bring-your-own-key connections without a mandatory Phyra account or gateway. Start with native Anthropic Messages and OpenAI Responses adapters, plus a separately tested Chat Completions-compatible adapter. Expand to native Gemini and other providers as maintained adapters become available. Allow user-managed local model servers, such as Ollama or vLLM, through tested endpoint contracts.

The goal is broad model choice, including user-specified model identifiers and endpoints, rather than a fixed list of favored models. Any valid credential still depends on provider authorization, protocol support and the chosen model's capabilities.

Track streaming, tools, structured-output guarantees, image/document input, context limits, cancellation and usage reporting per endpoint/model. Hide or explain unavailable actions; never silently downgrade a workflow. Compatibility layers have differences: see [Anthropic's documented limitations](https://platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk), [Gemini compatibility](https://ai.google.dev/gemini-api/docs/openai) and [Ollama compatibility](https://docs.ollama.com/api/openai-compatibility). Native adapters should preserve provider-specific features behind a shared internal event contract.

A gateway can be an optional connection managed by a user or organization, including an independently evaluated future Phyra-hosted option. It must have explicit data destinations, authentication, retention and cost behavior. Direct and local routes remain supported. No silent cloud fallback, automatic model download or mandatory hosted solver is implied by this roadmap.

### Progressive assistant capabilities

| Level                           | User value                                                                                | Required controls                                                                                                     |
| ------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A1 — Explain                    | Search offline product help; explain available methods, inputs, errors and actual results | Ground answers in versioned product content and selected study/run evidence; separate unknowns from measured values   |
| A2 — Inspect                    | Check missing materials/conditions, units, mesh quality and run applicability             | Deterministic engineering validators; read-only tools; cite affected objects and run identifiers                      |
| A3 — Propose and edit           | Suggest conditions, geometry parameters or study settings; apply authorized changes       | Typed SI-aware patch, visible diff, current-input precondition, undo and scoped authorization                         |
| A4 — Coordinate studies         | Execute a bounded sweep, comparison or convergence investigation                          | Explicit run/compute/API budgets, cancellation, checkpoints, partial failures and per-run provenance                  |
| A5 — Assist design and research | Plan inverse/optimization/active-learning experiments and compare supported methods       | Verified sensitivity/uncertainty, engineering constraints and independent acceptance checks; auditable tool decisions |

Numerical fields, convergence and physical quantities must come from numerical tools. The assistant may describe them, propose a method or reject unsupported requests; it must not manufacture results. It should be useful for expert workflows as well as onboarding, without occupying the main modeling workspace unnecessarily.

### Keys, data and actions

Store credentials in native OS facilities such as macOS Keychain and Windows credential storage, outside projects, logs and exports. Provide add/test/remove/reconnect flows and redacted diagnostics. Remote connections require authenticated HTTPS; deliberately selected loopback endpoints have separate rules.

Show the context leaving the machine: selected study metadata, run summaries and any specifically authorized geometry, fields, images or documents. Local files are not implicitly provider input. Changing a provider/gateway changes the data destination and may require a new authorization scope.

Start with narrow tools such as reading studies/metrics and proposing patches. A model's tool request is only a proposal: native code enforces schema, units, permission, current-project fingerprint and resource limits. Support reusable authorization for a bounded workflow, so users do not repeatedly approve the same permitted action. General shell, unrestricted file access and arbitrary network execution are not default assistant tools.

Treat imported documents, CAD metadata and tool outputs as untrusted data. Evaluate prompt-injection, malformed streams, authentication/rate-limit errors, stale changes and unauthorized actions. Provider strict-output support does not establish physical correctness or action permission; see the [official tool-calling contract](https://developers.openai.com/api/docs/guides/function-calling) and [agent safety guidance](https://developers.openai.com/api/docs/guides/agent-builder-safety).

Display API usage/cost estimates and numerical compute budgets separately; report unknown cost when usage/pricing evidence is unavailable. Cancellation stops future work but cannot promise reversal of already incurred provider charges. Audit accepted changes, model/adapter versions, context hashes and run references without storing credentials or hidden reasoning traces.

## 8. Professional interface, explanation and presentation

The interface must become a precise engineering tool. Visual polish and understandable interaction are part of P1, not a cosmetic phase postponed until every solver exists.

The current primitive workbench implements replace/add/toggle selection, synchronized model-tree/inspector boundaries, standard camera orientation, fit/reset, boundary isolation and node/preview-vertex distance inspection. Definition undo/redo is bounded and session-only; physical restoration requires recomputation. Constrained drawing, exact CAD measurements, feature history and advanced postprocessing remain separate milestones.

- **Workspace:** a predictable model tree, viewport and property inspector; clear study/result context; stable menus, command search, contextual actions, keyboard shortcuts, selection modes and undo/redo. Show missing assignments and the object that needs correction.
- **Light theme:** white and neutral tonal surfaces by default, disciplined typography, restrained emphasis and sufficient separation of model, mesh, selections and analysis fields. Reserve strong colors for data and meaningful status.
- **Dark theme:** deep neutral graphite/charcoal surfaces with readable boundaries and muted accents. Preserve contour readability and avoid saturated dashboard backgrounds.
- **Identity:** v0.1.0 finalizes a vector Phi mark, matching native app icons and a compact wordmark. Preserve legibility at small sizes and verify future changes in both themes and native desktop contexts.
- **Scientific color:** choose sequential maps for ordered magnitudes and diverging maps centered on zero for signed differences. Provide units, explicit fixed/shared ranges, clipping, zero/undefined handling and accessible alternatives. Theme changes must not alter data or hide failures.
- **Platform quality:** keyboard access, focus states, accessible contrast, high-DPI/multiple-display behavior, resizing and expected macOS/Windows conventions. Evaluate dense real studies, not only an empty landing screen.

Postprocessing should grow to sections/clipping, body isolation, vectors/tensors/principal quantities, path probes, surface/volume integrals, time/frequency navigation and consistent comparison. Preserve node/cell/integration-point associations. Make smoothing or projection explicit; do not silently average discontinuous materials or hide singularities. The [ParaView color-mapping reference](https://docs.paraview.org/en/latest/ReferenceManual/colorMapping.html) illustrates the separation of field/component selection, transfer functions and legend control.

### Product documentation that answers engineering questions

Every available study/method needs an offline card covering equations, assumptions, supported geometry/conditions/materials, units, discretization/training approach, outputs, validation references and known failures. Each screen needs task-oriented help: what to do next, why an input matters, how to choose a value and how to repair an error.

Provide a searchable supported-capability catalogue, boundary-condition glossary and guided examples that produce real results. Start with axial loading, bending and manufactured elasticity, then follow released thermal/fluid families. Distinguish examples from certified material data and research demonstrations from supported engineering use.

The README includes genuine current-interface screenshots inspecting saved CPU references and a short workflow video from the preceding interface iteration, links directly to runnable examples and local setup, and states the current scope. Final video recapture is deferred until the current refinement stabilizes. Label historical captures and keep new help screenshots tied to actual saved-reference or desktop workflows. Keep lightweight assets and accessibility text; avoid duplicate manuals and a sprawling documentation tree. This roadmap remains the single planning document, while operational instructions remain in README/CONTRIBUTING and explanations live with the product capabilities they describe.

## 9. Scientific and product acceptance gates

Each new capability follows **research → reproducible prototype → validated bounded pilot → packaged supported feature**. Publish its status and supported combinations. Promotion requires the following evidence; thresholds are selected and justified per benchmark before evaluating the chosen method.

| Gate                          | Evidence required                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Mathematical definition       | Equations, unknowns, assumptions, units, formulation and boundary/initial/interface semantics                                                          |
| Independent correctness       | Analytical/manufactured cases and, where appropriate, independent numerical or experimental references; existing tolerances remain intact              |
| Physical checks               | Constraints and force/moment, mass, energy, charge or interface-work balance appropriate to the family                                                 |
| Refinement and error          | Mesh/time/quadrature convergence; area/volume-weighted field errors and engineering quantities; documented singularity evaluation                      |
| Learning robustness           | Multiple seeds, unseen validation points, failures and optimization sensitivity; training loss distinguished from accuracy                             |
| Generalization                | For reusable models, split by independent simulation, geometry, material and regime; nodes of one solution cannot establish new-problem generalization |
| Applicability and uncertainty | Defined scope, calibrated interval coverage where offered, distribution-shift tests and explicit abstention/correction behavior                        |
| Performance                   | End-to-end timings, memory, model/data generation cost, hardware/precision and optimized reference baseline                                            |
| Workflow safety               | Correct persistence/migration, cancellation, stale-result ownership, invalid-input rejection and recovery from partial failure                         |
| Product usability             | Representative users complete preparation and interpretation tasks; no critical misreading of units, boundaries, method scope or result currency       |
| Target distribution           | Packaged macOS and Windows workflows on declared supported environments; dependency/redistribution and credential checks                               |

For early evaluation, use at least five independently seeded runs per learning benchmark and separate nominal cases from deliberately difficult cases. This is a proposed screening floor, not a measured reliability guarantee or a sufficient sample for high-percentile/failure-rate claims. Justify sample counts and statistical uncertainty for those claims separately. Each family must justify error and balance thresholds for its intended use; one universal percentage is inappropriate across displacement, drag, temperature, resonance and fracture.

Per-problem PINNs may evaluate residuals at independent points of the same PDE instance; label that evidence as within-instance residual validation, not a field-error bound. Field accuracy additionally requires independent physical references. Reusable-model generalization requires held-out physical instances. Uncertainty calibration uses data separate from training and final evaluation, and distinguishes pointwise interval coverage from simultaneous whole-field coverage.

Track median and high-percentile error, failure rate and target quantities alongside L2. Report reactions/compliance for mechanics, heat flux for thermal problems, pressure drop/drag for flow, and phase/energy for waves. A raw corner stress maximum may not converge; explain the evaluation region and quantity rather than silently removing difficult points.

Before shipping a major workflow, set a task-based usability target with representative engineers and new users. An initial proposed target is at least 90% successful completion of the declared reference task with no critical modeling/result-interpretation error. Record time to a first correct study, diagnostic recovery and help effectiveness; revise the target through evidence rather than presenting it as current performance.

## 10. Architecture, platforms and scale

Preserve the separation between project definition, geometry, discretization/sampling, study, execution and fields. Introduce explicit contracts only when a real capability needs them. The UI should select a physical problem and inspect solver applicability; it should not encode a different physical problem for each algorithm.

Extension contracts should eventually cover physics definitions, material laws, discretizations, numerical methods, model/data manifests, result associations and AI provider/tool adapters. Stabilize an SDK after at least two real integrations demonstrate the shared interface. Use reviewed extensions and owned workers; preserve the current safe serialization and migration principles.

### Physics ML execution runtime and framework adapters

The intended separation is **desktop workbench → immutable study/execution request → reviewed method or model adapter → owned runtime → validated fields and provenance**. The workbench owns engineering intent, assignments and interpretation; an execution backend owns a numerical implementation, resources and model lifecycle. Frameworks supply capabilities, not permission to change the physical problem or silently reinterpret material/boundary data. Current local FEM and PyTorch PINN implementations justify these boundaries; new adapter interfaces should be introduced only with a real vertical slice.

| Track                      | Current or proposed responsibility                                                                                            | Admission gate                                                                                                                                                             |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing CPU mechanics     | Current Gmsh/SciPy meshing and classical references; bounded local process execution                                          | Preserve analytical references, resource limits, fields, cancellation and persistence while refactoring                                                                    |
| PyTorch numerical methods  | Current per-problem elasticity PINN; future reusable/hybrid/model-family methods                                              | Per-operation derivatives, precision, seeded references and actual framework/device metadata                                                                               |
| NVIDIA PhysicsNeMo adapter | Proposed selected model/provider or training backend; optional curated dependencies and compatible tensor/mesh/sample mapping | One end-to-end physical benchmark through the normal study/run/field pipeline; compare native framework output, units, derivatives, boundaries, cost and failure behavior  |
| JAX or equivalent adapters | Proposed differentiated kernels or model families when they add demonstrated value                                            | Verified derivative/transformation semantics, precision configuration, platform installation and identical physical references; no assumed interchangeability with PyTorch |
| Local multi-GPU execution  | Proposed distributed data/model/domain strategies for sufficiently large workloads                                            | Single-device equivalence within justified tolerances; weighted metrics, all-rank cancellation, partial-failure recovery and measured scaling                              |
| User-managed HPC execution | Later proposed workstation/cluster/scheduler adapters                                                                         | Explicit data/credential permissions, fixed launch definitions, quotas, job identity, checkpoint transfer and provenance; local offline execution remains independent      |

[PhysicsNeMo's current installation documentation](https://docs.nvidia.com/physicsnemo/latest/getting-started/installation.html) distinguishes pip environments, containers and optional extras. Symbolic PDE/residual functionality now resides in `physicsnemo.sym`; Phyra must pin and test an adapter against a selected framework release rather than rely on older standalone-package assumptions. Installation, importing a model and completing a physical workflow are separate gates. Optional framework runtimes should not inflate the default desktop bundle or force GPU/container dependencies on CPU users.

Maintain a capability matrix by **framework version × method × operation × platform × device × precision**. CPU, Apple GPU and NVIDIA GPU are separate validation targets. Test actual forward, derivative/backward, training, field evaluation and cancellation operations rather than merely enumerating hardware. Do not infer PhysicsNeMo support on Apple GPU from PyTorch MPS support, or CUDA support from an installed device driver. [PhysicsNeMo system requirements](https://docs.nvidia.com/physicsnemo/latest/getting-started/system_requirements.html) and [JAX's platform/backend installation matrix](https://docs.jax.dev/en/latest/installation.html) are upstream constraints to check, not Phyra support statements. CPU remains a reproducible reference route; an unsupported operation produces an explicit limitation or disclosed fallback.

### Dataset → training → validation → model → inference

The reusable-model lifecycle requires artifacts distinct from a project-specific result:

1. **Dataset:** identify equations, geometry/material/condition ranges, sample and mesh associations, SI units, reference solver/settings, data rights, checksums and quality checks. Keep train/validation/test splits grouped by independent physical instance; record generator failures and exclusions.
2. **Training execution:** retain dataset/split hashes, preprocessing and normalization, model architecture/version, optimizer/sampling settings, random seeds, actual device/precision, framework/runtime versions, metrics and resource budgets. No user-supplied executable code is admitted through a data manifest.
3. **Held-out validation:** reserve final physical instances and unseen query points as appropriate; measure field and quantity errors, conservation, hard cases and failure rate across justified seeds. Tune neither thresholds nor test instances after viewing the final result.
4. **Model version:** promote an immutable, inspectable record containing architecture and safe tensor state, applicability envelope, references, validation evidence, data/model rights and compatible runtime versions. A digest establishes identity, not scientific accuracy or trust in executable code.
5. **Inference execution:** check query/material/geometry/condition compatibility, load the declared preprocessing, return fields at declared locations and units, and attach model/dataset/execution provenance. Reject or explicitly abstain outside scope; compare or correct through a reference method when that route has been validated.
6. **Update or resume:** a new dataset, material law, preprocessing rule or model state creates a new version. Resume restores validated model/optimizer/sampler state in a safe format and reports any reproducibility limits; retraining from settings is not resume.

Current `.phyra` archives store per-problem settings, metrics and evaluated fields; they do not store reusable model datasets or trained checkpoints. Do not overload the existing result cache with an executable model archive. Artifact import needs cumulative size/dimension/index/finite-value checks and schema migration just as project import does. Learned constitutive state additionally follows integration-point and load-history ownership.

### Multi-GPU and distributed correctness

Start with independent bounded studies or data-parallel training when the workload warrants it; introduce parameter/optimizer sharding or spatial/domain partitioning only for demonstrated memory or scaling needs. [PhysicsNeMo's distributed guide](https://docs.nvidia.com/physicsnemo/latest/user-guide/distributed_training.html) distinguishes these strategies. [Its ShardTensor contract](https://docs.nvidia.com/physicsnemo/latest/physicsnemo/api/physicsnemo.domain_parallel.html) supports domain sharding alongside DDP/FSDP2, but requires compatible operations, layouts, gradient synchronization and checkpoint handling. These framework facilities do not automatically define a physically correct subdomain interface.

For uneven sample/mesh partitions, reduce weighted sums and counts so losses, field norms and conservation match the global problem; averaging rank-local means can change the objective. Preserve unique entity ownership, boundary labels, normals and interface exchange. PINN domain decomposition requires the chosen continuity/flux formulation, and transient solvers require consistent time/state transfer. Compare distributed and single-device physical results within preselected numerical tolerances; bitwise equality across devices is not promised.

The future scheduler needs explicit queued/running/cancelling/terminal states, bounded concurrency and memory, owned ranks, aggregate progress, heartbeats and recovery from a lost rank or interrupted host. Cancellation must retire the entire owned job and prevent any late rank from publishing current results. Checkpoint/restart must preserve partition and state provenance. No general shell or arbitrary executable path is added to the desktop bridge.

Measure strong and weak scaling, peak host/device memory, communication, data loading, preprocessing and checkpoint overhead. A faster training kernel may still lose end-to-end on small studies. Establish reproducible single-GPU workloads before multi-GPU, then multi-node/HPC gates; cross-platform desktop support is independent of a specialized compute host. Public cloud, accounts, billing and hosted execution remain outside this iteration and require separate user-controlled architecture and distribution decisions.

### macOS and Windows are primary targets

- Verify clean-machine installation, offline solve, cancellation, recovery, save/reopen, Unicode/space-containing paths and uninstall on both targets. Distinguish configuration, build, package inspection, launch and numerical execution evidence.
- Measure startup, package size, peak memory, interaction latency and large-field rendering. Reduce unnecessary bundled dependencies with reproducible target-specific packaging rather than removing numerical support invisibly.
- Test CPU, MPS and CUDA by algorithm, operation and precision. FFT, scatter, complex arithmetic and higher-order autograd support require their own checks. A hardware/device probe is not blanket solver support.
- Establish production signing/notarization and appropriate Windows distribution trust; version update/migration policy, crash recovery and dependency/Corresponding Source compliance precede public release claims.
- Keep CPU execution useful. Optional GPU runtimes and accelerators need explicit installation, availability, compatibility and fallback behavior; never advertise CUDA execution based only on detection code.

Larger meshes and models require chunked/streamed field handling, bounded GPU buffers, cancellation at useful boundaries and measured quality of service. Bulk arrays remain outside ordinary reactive JSON state. Scalability includes save/load, probing and comparison as well as solve time.

Optional remote execution should progress from user-managed workstation/SSH or scheduler adapters to separately evaluated multi-node training. Include job ownership, authentication, quotas, checkpoint transfer, data permissions and result provenance. Local solving remains independent of a public service. Hosted compute, gateways or paid infrastructure require separate architecture, licensing, security and business decisions before implementation.

### Release and compatibility gates

Semantic tags such as `v0.x.y` identify one synchronized application/package/native/engine version and a reviewed source revision. The configured [tag workflow](.github/workflows/release.yml) checks metadata and requires the owner's explicit `PHYRA_PUBLIC_DISTRIBUTION_READY=true` repository variable before reusing the full scientific and packaged desktop CI. Successful target jobs stage DMG or Windows installers, SHA-256 checksums and license/notice files under ignored `artifacts/release/`; the workflow prepares a draft for owner review. The gate defaults closed, and this configured flow has not established release execution, consumer installation, signing or complete Corresponding Source readiness.

Updater metadata and credentials remain absent until an update path is implemented and validated. Do not commit build products to the normal source tree or equate a draft/uploaded artifact with publication authorization or redistribution readiness.

Preserve previous supported project schemas, explicitly migrate or discard incompatible caches, and test recovery/rollback before release. Record target architecture, OS/runtime minimums and actual launch/solve evidence. Security-reporting intake, dependency review and a supported-version policy are prerequisites to a serious public launch; [SECURITY.md](SECURITY.md) states the current reporting limitation rather than inventing a private route.

## 11. Community and sustainable ownership

The roadmap should be feasible for a growing community over years, without depending indefinitely on one contributor. Establish maintained domains for geometry/mesh, physical formulations, Physics ML, contracts/persistence, native lifecycle, visualization/UX, AI integration and platform distribution.

As participation grows, aim for at least two active reviewers per critical domain. This is an organizational target, not an assertion that those maintainers already exist. Numerical contributions require independent references; persistence changes require migration evidence; AI integrations require protocol, injection and permission tests; distribution changes require target evidence.

Discuss major changes through concise proposals stating the problem, alternatives, dependencies, maintenance cost and acceptance gate. Preserve GPL-3.0-or-later and DCO practice. Track model/dataset/media rights independently from code licenses, and review commercial CAD component compatibility before adoption.

Create reproducible benchmark tasks and appropriately licensed small fixtures that new contributors can run locally. Define experimental-feature promotion, deprecation, supported-version policy and a private security-reporting route before broad distribution. Expand governance and release coordination as real contributors arrive; avoid speculative organizational bureaucracy.

Funding priorities should protect maintenance and validation: domain expertise, Windows/macOS test access, benchmark/data stewardship and reproducible compute. A large contributor count is useful only if it increases supported capability and review capacity.

## 12. First execution priorities

These work packages record the first launch slice and the recommended next outcomes. They refine the phases into reviewable outcomes without pretending the multi-year programme is one release.

| Order                                              | Work package                                                                 | Concrete completion evidence                                                                                                                         |
| -------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 — implemented; user validation open              | Existing-workflow usability and capability audit                             | Tested task flow; unsupported/experimental labels; screen and method-help inventory tied to current behavior                                         |
| 2 — hosted workflows verified; distribution open   | Consumer installation and minimum-version distribution validation            | Hosted macOS/Windows package/FEM/PINN/cancel/save/reopen passed; manual installation/dialogs/uninstall, minimum macOS and redistribution gaps remain |
| 3 — implementation delivered; user validation open | Professional workspace, help, themes and identity                            | Representative-user workflow acceptance; offline help; readable scientific colors; reviewed logo/icon assets                                         |
| 4 — limited preparation slice completed            | Primitive selection, copied boundary sets and safe definition history         | Bounded/stale-safe undo; persisted stamps and explicit repair; camera/isolation and undeformed node/preview-vertex measurement; current hosted packaged workflows passed |
| Later; deferred from launch                        | Read-only BYOK assistant                                                     | Native Anthropic/OpenAI adapters, credential protection, endpoint contract tests and run-grounded answers                                            |
| 5                                                  | Geometry/condition contract and kernel prototypes, alongside ongoing UX work | Stable body/region identity; SI semantics; supported-combination matrix; reproducible kernel/sketch/licensing evaluation                             |
| 6                                                  | STEP imported-part vertical slice                                            | Import → repair → named selections → material/conditions → mesh → validated linear solve → reopen                                                    |
| 7, after material-region identity                  | Multiple-material and orthotropic solid slice                                | Body assignments, tensor axes/units, independent patch/interface references and safe reopen; laminate/FGM/nonlinear work retains its separate gates  |
| Parallel research                                  | PINN reliability and first thermal/inverse pilot                             | Independent references, multi-seed errors, energy/balance checks, identifiability and declared scope                                                 |
| 8                                                  | Bounded studies and reusable-model pilot                                     | Dataset manifests, held-out physical instances, immutable model compatibility and measured accuracy/cost                                             |
| 9, after execution and model contracts             | One optional framework/runtime adapter                                       | Pinned dependency and license closure; actual train/validate/infer/cancel path on CPU and one verified accelerator; no default cloud dependency      |
| Later, after single-device scientific validation   | Distributed execution pilot                                                  | Weighted reductions, partition/interface references, rank failure/cancel/restart and measured strong/weak scaling; no assumed hardware coverage      |

The first physics expansion should be chosen for independently demonstrable value and available maintainers. Steady thermal/inverse problems are promising early candidates; general turbulent CFD and unrestricted multiphysics should not displace the foundation.

## 13. Risks, decisions and revision policy

| Risk or unresolved decision                                              | Required response                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Physics ML fails or costs more than a reference method                   | Retain bounded applicability, publish failures, compare alternatives and use correction/reference routes where available    |
| Native CAD formats have incompatible licenses or uneven platform support | Prefer neutral exchange; complete translator/version/platform/redistribution evaluation before making promises              |
| Geometry edits invalidate physical assignments                           | Preserve identity where proven; require repair of ambiguous references; block unsafe solving                                |
| Training data is expensive, biased or restricted                         | Record rights/provenance; validate generation; split by physical instance; measure acquisition cost and coverage            |
| GPU differences invalidate numerical assumptions                         | Test each algorithm/precision; expose unsupported devices and preserve a verified reference route                           |
| AI gives misleading advice or exceeds authority                          | Ground answers; enforce typed native tools, budgets and scopes; test adversarial input; retain review/undo                  |
| Scope grows faster than maintenance capacity                             | Deliver complete problem families; defer isolated UI placeholders; secure domain reviewers before support commitments       |
| Research progress changes the best method                                | Keep method interfaces composable; reassess accuracy/cost and retire weak approaches without rewriting the physical problem |

Review this roadmap at major capability gates and at least quarterly while development is active. Reassess user evidence, scientific results, dependencies, licenses and available ownership. Mark an item completed only with linked implementation and acceptance evidence; keep restricted or experimental status visible.

The stable commitment is the product direction: **capable engineering preparation, validated Physics ML and intelligent user-controlled workflows**. The sequence and selected methods should evolve as the evidence improves.
