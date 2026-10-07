# Phyra — Product Vision and Roadmap

**Reviewed:** 7 October 2026

This is Phyra's single product roadmap. It describes the current foundation, the product destination, and the evidence required before capabilities are presented as supported. It is organized by reusable engineering capabilities and dependency order, not by intermediate release promises or delivery dates.

The roadmap describes a capable local-first mechanical engineering workbench: users can create and edit useful 2D and 3D mechanical geometry, define real engineering studies, solve selected structural and thermal problems with established numerical methods, reproduce representative Physics ML research workflows, and use an AI assistant under their control. The target is broad and coherent, not a claim that every possible CAD or solver function is finished.

## Contents

1. [Product direction](#1-product-direction)
2. [Verified starting point](#2-verified-starting-point)
3. [Capability status and product contract](#3-capability-status-and-product-contract)
4. [Development sequence](#4-development-sequence)
5. [CAD, geometry and meshing](#5-cad-geometry-and-meshing)
6. [Classical analysis and physical definitions](#6-classical-analysis-and-physical-definitions)
7. [Physics ML and paper-inspired research](#7-physics-ml-and-paper-inspired-research)
8. [AI assistant, BYOK and agent workflows](#8-ai-assistant-byok-and-agent-workflows)
9. [Results, documentation and product experience](#9-results-documentation-and-product-experience)
10. [Architecture and local devices](#10-architecture-and-local-devices)
11. [Acceptance gates](#11-acceptance-gates)
12. [Further product areas](#12-further-product-areas)
13. [Research anchors](#13-research-anchors)

## 1. Product direction

Phyra combines four things that should reinforce one another:

- **Mechanical CAD and preparation:** create, import, edit and inspect analysis-ready geometry; assign materials and physical conditions to stable regions; control the mesh.
- **Classical numerical analysis:** provide trusted, inspectable reference solutions across useful 2D and 3D solid-mechanics workflows, with selected thermal workflows.
- **Physics ML research:** train, evaluate and apply physics-informed, operator, mesh/graph and hybrid methods on the same problem definitions and reference data.
- **An AI workbench assistant:** explain Phyra and its methods, answer questions from the active study and results, and help users carry out bounded workflows through approved tools.

The workbench should feel complete across supported workflows, rather than like a collection of solver demonstrations. A user should be able to go from sketch or imported part, through materials, conditions and meshing, to a validated result and a clear explanation of its limits.

### Product principles

1. **Prepare the engineering problem first.** Geometry, materials, loads, boundary conditions, mesh and result interpretation are product capabilities, not incidental inputs to a neural network.
2. **Separate definition from solution.** A project may store a well-formed problem definition even if no current solver can solve it. The interface must say what is missing and prevent a misleading run.
3. **Use established methods where they fit.** Prefer maintained CAD, meshing and numerical libraries with a clear license and platform story. Phyra should own the product contracts, integration, validation and user workflow; avoid building a bespoke general-purpose solver when a suitable library exists.
4. **Select research by reusable value.** Reproduce papers as end-to-end cases, then keep the shared geometry, physics, data and method capabilities. Do not fork the application or add one-off UI for each paper.
5. **Make evidence visible.** Every supported method has assumptions, applicability limits, references, errors and failure behavior. Training loss alone is not accuracy evidence.
6. **Keep the desktop useful locally.** Core CAD and numerical workflows work without a Phyra account, hosted solver or model API key. BYOK AI features are optional and disclose when information leaves the machine.
7. **Keep extensions possible without speculative infrastructure.** Preserve project, study, execution, field and model boundaries. Add a stable extension contract when real integrations prove what it needs to support.

### Product boundary

The core product focuses on mechanical CAD, solid mechanics, selected heat transfer, research-grade Physics ML experimentation and a user-controlled AI assistant. It does not promise every industrial formulation or every CAD discipline. Each advertised feature must correspond to a declared and validated capability, not a checkbox in an editor.

The CAD scope is mechanical part and assembly preparation for analysis. CAM, BIM and unrelated authoring disciplines are outside the product direction. Broader fluid mechanics and coupled multiphysics are later expansion areas; keep the desktop and engine structured to explore them without making them prerequisites for supported mechanical workflows.

## 2. Verified starting point

“Completed” means implemented and verified within the scope shown. “Experimental” means a real implementation exists but has restricted applicability or incomplete evidence. “Partial” means verified support covers only part of the capability, with remaining limits stated in the table. “Implemented” records current functionality whose broader provider/platform workflow evidence remains open. Capabilities listed as Planned or Planned / research are future work; capabilities absent from this table have not been assessed here.

| Capability | Current status | Verified scope and remaining limit |
|---|---|---|
| Desktop and local execution | Completed, limited | Tauri 2, React/TypeScript and Three.js; isolated Python workers, cancellation, cleanup and run ownership |
| Geometry-to-results workflow | Completed, limited | Parametric box, cylinder and connected bracket solids; rectangular and bounded line/arc/circular-hole 2D profiles; central sketch drafts including exact slots and split straight edges; exact CAD recipes retained through primitive adapters or a separate source-bound single-solid FEM study |
| 3D classical elasticity | Completed, limited | Homogeneous isotropic, small-strain linear static solids with first-order tetrahedra |
| 2D classical elasticity | Completed, limited | Rectangle/profile plane stress with constant-strain triangles, physical thickness and independent Kirsch checks for the matching quarter-plate case |
| Supports and loads | Completed, limited | Component restraints, prescribed displacement, total force and pressure; typed affine/Kirsch spatial traction for 2D FEM and potential-energy PINN |
| Elasticity PINN | Experimental | Real strong-form rectangle residuals and potential-energy rectangle/profile training with finite straight-segment exact essential conditions; independent quadrature audit and seeded patch checks; no general field-error guarantee |
| FEM/PINN comparison | Completed, limited | Same nodes and cell centroids, relative L2 and maximum differences, comparison fields |
| Results | Completed, limited | Displacement/stress fields, probes, units, deformation and undeformed overlay; animation scales a static result and is not dynamics |
| Persistence and recovery | Completed, bounded | Versioned .phyra archives, schema migration, stale-result rejection, recovery journals and SI CSV export |
| Boundary selections and edit history | Completed, bounded | Copied named boundary sets, explicit repair, bounded definition undo/redo; no associative CAD references |
| Project tabs and preparation | Implemented, bounded | Up to 32 isolated documents, adjacent tree/properties, boundary/object context actions and compact workflow/checks; meshed worker restraint validation remains authoritative |
| Device coverage | Partial | CPU reference and measured Apple MPS PINN path on available hardware; CUDA remains unverified |
| Desktop distribution | Partial | Hosted package/workflow evidence on macOS 15 Apple Silicon and Windows Server 2022 x64; minimum-version, clean consumer installation and production distribution evidence remain open |
| CAD authoring and neutral import | Implemented, bounded | Direct blank-plane line/arc/circle sketching, dimensions, snapping, open-sketch DOF/conflict solving, general closed hole contours; local exact box/cylinder, extrusion, revolution, Boolean, fillet/chamfer, rigid placement and STEP import/export. Bounded feature recipes, standard views, through-selection, selection fitting and topology inspection. A compact viewport-first shell separates Model/Operations from on-demand details; new desktop solid commands use exact Preview/Apply/Cancel without publishing draft analysis evidence. No-hole loft/sweep solids or surface shells, named reusable assembly instances, component placement and body isolation are implemented. Freeform surface editing, shell/thicken, assembly mates/contact and unrestricted imported-solid analyses remain open. One closed solid with a verified source-bound face catalog can proceed through linear-static tetra4 FEM; shells, assemblies and multiple solids remain gated. |
| Broader classical physics and materials | Planned | No unrestricted CAD domains, multiple-material regions, thermal, nonlinear, dynamic or contact solver |
| Reusable Physics ML models | Planned / research | No validated operator, mesh/graph or geometry-conditioned product workflow |
| BYOK CAD/analysis assistant | Implemented, limited | Independent saved provider connections, account-discovered model selection in chat, OS credential storage, bounded authored project and current CAD/study evidence on deliberate Send and cited local history; broader provider/platform workflow evidence remains open |
| Local MCP | Implemented, read only | Individual tool allowlists for capability/help/project/run inspection, protocol 2025-11-25, native revocation/token rotation, expiring session leases, client configuration, native VS Code installation and access audit; no model-changing tools |
| Agent workflows and research portfolio | Planned / research | No assistant mutations, automated solver actions, parameter sweeps or reusable research-agent workflow |

Baseline evidence is in the [independent engine references](engine/tests), [frontend domain and feature tests](src/domain), [native lifecycle and persistence tests](src-tauri/src/tests), and [packaged workflow verifier](scripts/test-desktop.mjs). Hosted verification at [commit 3498f34](https://github.com/oguzhankir/phyra/actions/runs/36761517423) passed 168 frontend, 234 quick Python, 3 slow numerical and 38 macOS / 37 Windows native tests. Packaged FEM/PINN, rendering, save/reopen, cancellation, recovery and device workflows were exercised on the hosted macOS and Windows targets. This does not establish representative-user usability, minimum macOS 14 execution, manual consumer installation or untested GPU support.

The current project archive schema is version 8, separating empty/CAD documents from optional studies and preserving exact source recipes and source-bound CAD face catalogs. Existing v1/v2/v3/v4/v5/v6/v7 data is validated against frozen schemas before migration; compatible primitive caches pass normal fingerprint/field validation and v1 caches are discarded. Current safety limits include 12,000 nodes, 50,000 cells, 100,000 surface triangles, a 64 MiB binary-buffer limit and a 1 MiB JSON limit. Raising limits is not a scalability milestone; memory, rendering, persistence and numerical behavior must be measured together. The hosted baseline above predates subsequent profile, tab, sketch and assistant changes and does not verify those later workflows.

## 3. Capability status and product contract

The engine and interface must report capability status for the complete combination selected by a user:

- analysis family and formulation;
- geometry dimension, representation and mesh family;
- material law, orientation, regions and interfaces;
- load, boundary, initial and contact conditions;
- solver or Physics ML method;
- operation: define, mesh, solve, train, infer, compare or export;
- device, precision and runtime;
- validation level and supported parameter range.

Use these user-facing states consistently:

| State | Meaning |
|---|---|
| **Supported and validated** | The full workflow runs and has named verification cases, applicable limits and packaged workflow evidence. |
| **Experimental** | A real workflow runs, but its verified scope or reliability is restricted and shown before use. |
| **Definition only** | Geometry and physical inputs can be stored, but a required mesh, method or solver is unavailable. The project can be saved; execution is blocked with an actionable explanation. |
| **Unavailable** | The project cannot yet represent the requested capability. |

Definition, meshing, solving, training, inference and validation are distinct capabilities. A boundary editor must not imply that every solver supports that boundary condition. A complex imported shape must not imply that a particular method can solve it.

Extend the existing engine capability contract rather than maintaining separate, conflicting UI and solver catalogues. Every paper-inspired case should have a compact machine-readable definition for geometry, units, materials, conditions, mesh policy, method settings, seeds, references, metrics, hardware and source/license provenance.

## 4. Development sequence

The work advances through dependent product outcomes; there are no release-by-release promises in this document. CAD-kernel evaluation, selected-paper research, PhysicsNeMo evaluation and broader evaluation of the implemented documentation assistant can proceed in parallel. Solver integrations and agent actions should only enter the product after their shared data and permission contracts are understood.

| Order | Product outcome | Required evidence before the next dependent step |
|---|---|---|
| 1. Stabilize the problem model | Maintain project/study/run/result boundaries, units, geometry identity, capability status and safe schema evolution. Evaluate CAD-kernel and sketch-constraint candidates with small working prototypes. | Save/reopen and migration tests; identity behavior across edit/remesh; platform and license review for candidates. |
| 2. Deliver mechanical CAD and meshing | Add constrained 2D sketching, parametric feature history, selected 3D modeling, neutral import and analysis-ready mesh controls. | Valid geometry and stable selections through edit, import, remesh, save and reopen. |
| 3. Build the classical analysis foundation | Generalize 2D and 3D solid mechanics, common materials and boundary conditions; add further study families separately. | Independent analytic/manufactured references, equilibrium checks, mesh/time convergence and failure tests per formulation. |
| 4. Reproduce selected research workflows | Use shared CAD, material, mesh and solver features to recreate representative literature cases; add Physics ML methods on the same problem/field contract. | Reproducible case packs, held-out cases, disclosed deviations, error and cost comparison with the reference path. |
| 5. Deliver AI-assisted engineering | Validate the implemented BYOK documentation/study chat and read-only MCP core; extend to approved native workflow tools and bounded research agents. | Grounded-answer evaluation, credential/data-flow tests, tool authorization, stale-input checks, undo and cancellation. |
| 6. Harden the workbench | Complete results, reporting, offline help, package workflows, GPU capability reporting, compatibility and user validation. | Representative users complete declared tasks; each promoted capability passes packaged desktop and scientific gates. |

A paper is a source of problem definitions and evidence, not a product specification by itself. A selected paper may expose a missing reusable feature; implement that feature only after confirming its broader role in Phyra and its validation path. The target is a library of reproducible workflows built from shared product capabilities, not a stack of paper-specific solvers.

## 5. CAD, geometry and meshing

Phyra should become a strong mechanical CAD workbench for the geometries and assemblies used in its supported analyses. CAD authoring must be useful independently of whether a selected solver can solve the resulting study.

| Area | Target capability | Acceptance boundary |
|---|---|---|
| Constrained sketching | Lines, arcs, circles, slots and closed profiles; dimensions; coincidence, horizontal/vertical, parallel, perpendicular, tangent, equal, concentric, symmetry and related constraints. | Show under-, fully- and over-constrained status. Explain conflicts. Reopen and recompute the same constrained profile deterministically. |
| Parametric model history | Extrude, revolve, sweep, loft, Boolean operations, holes, patterns, mirror, fillet, chamfer, shell/thicken and datum geometry. | Edits propagate through a visible dependency tree. Failed recomputation preserves the last valid shape and identifies the failing feature. |
| Bodies and assemblies | Multiple bodies, reusable part instances, placements, coordinate systems, suppression/visibility and selected assembly constraints. | Preserve body/instance identity and material assignment. Keep bonded, tied and contact behavior explicit rather than inferring physical connections from visual overlap. |
| Import and export | STEP for solid exchange; IGES where useful; DXF for supported 2D entities; STL/OBJ for faceted surfaces; native Phyra projects. | Test a versioned file corpus for units, body count, validity, orientation and metadata. A faceted mesh is never presented as editable B-rep history. |
| Repair and defeaturing | Heal/stitch, simplify and remove selected small features; preserve the source geometry. | Show tolerances and geometric changes. Reject or request confirmation when volume, area or topology changes exceed declared bounds. |
| Named selections | Point/edge/face/body sets and geometric queries that can be attached to materials and conditions. | Preserve identity through edits/remeshing when unambiguous. A split, merge or uncertain remap creates a visible repair task; never move a load silently. |
| CAD inspection | Tree/inspector, hide/isolate, coordinate placement, exact length/angle/radius/area/volume measurements, mass properties and section inspection. | Measurements state their reference entity, coordinate frame and units; camera/selection changes do not mutate engineering data. |
| Drawing and review | Basic orthographic/section views, dimensions and annotations for supported parts, with PDF/DXF export where reliable. | Reopenable views match the authoritative model; drawings are clearly distinct from solver results and are not a substitute for a validated analysis. |
| Meshing | Global/local sizing, curvature/proximity controls, local refinement, supported triangle/quad/tet/hex/prism families, quality inspection and convergence studies. | Expose only controls supported by the selected mesher/domain. Report failed regions and element quality, preserve physical groups, and validate higher-order families before admitting them. |

Select the CAD kernel and sketch-constraint approach through prototypes that cover edit stability, import robustness, platform support, licensing/redistribution and application packaging. Keep the geometry definition separate from the mesh so changing a discretization does not erase design intent or physical assignments. Do not commit to a CAD library because it handles one demo part.

The next CAD gate is richer direct editing and preparation: reliable face movement/offset, datum geometry, mirror/pattern, split/imprint, shell/thicken, repair and sections, followed by validated helix and gear workflows. These remain open; a compact interface or a rigid-transform command does not implement arbitrary face editing. New operations must use the command lifecycle, explicit references and bounded local workers.

The target is analysis-oriented mechanical CAD. Do not add unrelated authoring disciplines to the product scope. A CAD feature is complete only when geometry can be created or imported, edited, inspected, saved and reopened in a normal workflow.

## 6. Classical analysis and physical definitions

The product direction goes beyond one rectangular elasticity example. Phyra should support a well-defined selection of common 2D/3D structural studies and selected heat-transfer studies, using established numerical libraries where appropriate. Treat each formulation as its own capability with its own scope and reference cases. The portfolio should include complete workflows for general 2D plane-stress/plane-strain and 3D linear static solid mechanics, multiple material regions, common structural loads and supports, mesh refinement/convergence, and the result quantities engineers need to inspect. It should also provide representative, independently validated workflows across modal/buckling, harmonic or transient response, geometric/material nonlinearity, contact, and selected fracture/damage cases; the capability matrix must state which formulation and material models are actually covered. For heat transfer, target steady/transient conduction, convection, surface-to-ambient radiation, and at least one sequential thermoelastic case. A capability may remain experimental when its evidence is incomplete; the current rectangle-only workflow must not be presented as the full analysis scope.

### Structural analysis families

| Family | Product definition and solver target |
|---|---|
| Dimensional formulations | General 2D plane stress and plane strain; selected axisymmetric, truss, beam and shell formulations; 3D solid mechanics. Do not apply rotational degrees of freedom to formulations that do not have them. |
| Linear static | Displacement, strain, stress, reactions and strain energy on general supported 2D profiles and 3D parts/assemblies; load cases and compatible linear combinations. |
| Modal and linear buckling | Eigenproblem-specific setup, boundary conditions, mode normalization, prestress definition and mode visualization. |
| Harmonic and transient response | Frequency/time definitions, density, damping, initial state and time integration; report whether a result is quasi-static, modal, harmonic or genuinely time-dependent. |
| Geometric and material nonlinearity | Incremental solution, convergence diagnostics and state ownership. Promote large displacement, plasticity, hyperelasticity or viscoelasticity only as separately validated formulations. |
| Connections and contact | Bonded/tied constraints first; then contact pairs with gap, normal behavior and separately selected friction law. Do not infer contact from a shared CAD boundary. |
| Advanced failure | Selected fracture/damage and fatigue formulations only with regularization, material parameters, history state and mesh-sensitive validation. A stress threshold is not a life or fracture prediction. |

### Materials, loads and boundary conditions

Build complete paths that cover geometry assignment, mesh transfer, project persistence and solver support:

- Isotropic linear elasticity first, then multiple material regions and explicit material coordinate frames.
- Orthotropic/transversely isotropic elasticity and selected layered-composite cases with orientation, ply data, interface ownership and shell/solid assumptions.
- Temperature-dependent and spatially varying material laws only with explicit interpolation and integration semantics.
- Separate hyperelastic, plastic, viscoelastic, damage and learned constitutive contracts. Path-dependent variables belong to the execution/integration-point state and require correct restart behavior.
- Component-wise prescribed displacement, symmetry, roller/normal constraints, periodic and multipoint constraints when supported by the method.
- Total force versus traction, pressure, body force/gravity, moments, edge/point loads, thermal strain and selected pretension/follower conditions where the formulation supports them.
- Local coordinate systems, units, load cases and combinations. A linear combination is valid only when the underlying problem is linear and the conditions remain compatible.

A material editor or boundary-condition control may exist before all solvers support that feature. In that case save the definition, mark it definition-only, state the missing formulation and block unsupported execution.

### Heat transfer and radiation

Add heat conduction as a separate, reference-tested family: steady and transient conduction, conductivity, heat capacity/density, internal sources, prescribed temperature, heat flux and initial temperature. Add convection and nonlinear surface-to-ambient radiation with explicit units, absolute temperature and sign convention after the required solver path is validated.

Distinguish three different physical models:

1. **Surface-to-ambient radiation:** a nonlinear surface boundary flux proportional to emissivity and the difference between fourth powers of absolute temperatures.
2. **Surface-to-surface radiation:** enclosure geometry and view-factor/radiosity treatment with energy exchange between surfaces.
3. **Participating-media radiation:** radiative transfer through an absorbing, emitting or scattering medium.

An editable “radiation” field must never imply support for all three. Sequential thermoelasticity follows validated structural and thermal components; coupled interface transfer needs its own energy check.

### Numerical library and result requirements

Prefer established, maintained libraries for meshing, sparse assembly and solution when they meet Phyra's problem contracts, license requirements and supported platforms. Qualify [CalculiX](https://www.calculix.de/) as the first external structural-backend candidate, compare [Code_Aster](https://code-aster.org/en/product/main) for advanced constitutive workflows, and evaluate [FEniCSx](https://fenicsproject.org/) separately as a research formulation framework. These are candidates, not bundled or supported solvers. CPU operation, macOS Apple Silicon/Windows x64 packaging, process-tree cancellation, license/source redistribution and independent references must pass before product exposure. Use a typed backend adapter and preserve an independent reference route where feasible. Do not assume that a library supports a formulation because it exposes a similarly named API.

Transient single-closed-solid BRep-to-Gmsh tetra4 mesh inspection is implemented, with outward boundary coverage, quality and exact-volume comparisons. A complete unique exact BRep round-trip check links source faces to mesh boundaries for unchanged geometry; users can inspect the same boundary in CAD and mesh views and retain a matched selection through remeshing. Unavailable correspondence is explicit. Prepare analysis now creates a separate source-bound study with a persistent exact-face catalog for one closed solid. Native-owned source snapshots, exact reconstruction and complete unique correspondence feed the existing tetra4 linear-elastic FEM method, with face-based supports/force/pressure, mesh validation and save/reopen. Reopening cached CAD results requires a newly verified exact source and identical numerical mesh; invalid derived results are discarded with a visible notice while preserving editable definitions. Topology edits require explicit study recreation and boundary reassignment. This bounded path does not admit shells, assemblies, multiple solids or general CAD PINNs. Higher-order elements, local refinement, multiple materials, modal/buckling and nonlinear/contact follow as individually tested slices; no unrestricted geometry gate opens in advance. Spatially graded materials must evaluate a typed material field in an explicit coordinate frame at quadrature locations and pass homogeneous-limit and graded-bar references before Physics ML receives the same law. Fluids and fluid–structure coupling remain later work.

For every advertised analysis, validate equations and conventions, reactions and conservation, mesh/time convergence, physical quantities of interest, nonlinear failure behavior and supported hardware. Result fields must retain node/cell/integration-point association. Smoothing and projection are explicit operations; never silently average discontinuous material fields or hide singular behavior.

## 7. Physics ML and paper-inspired research

The literature review across representative 2021–2026 solid-mechanics work points to a product capability portfolio, not one new model:

| Research pattern | Reusable Phyra capabilities |
|---|---|
| Perforated/notched plates and mixed boundaries | Constrained 2D profiles, holes/loops, durable boundary labels, local refinement, plane stress/strain and analytical comparisons. |
| Heterogeneous and inverse elasticity | Multiple material regions, spatial coefficients where justified, measurement import, identifiability checks and held-out recovery tests. |
| 3D brackets, frames, lattices and irregular meshes | Neutral solid import, stable body/face identity, volume meshing, local refinement and mesh-aware result fields. |
| Energy and variational mechanics methods | Correct potential/weak forms, quadrature, essential boundary treatment, nondimensionalization and independent FEM comparison. |
| Geometry-conditioned and operator models | Parameterized case generation, consistent mesh/graph/point-cloud features, train/validation/test splits by physical instance and unseen-geometry tests. |
| Contact, plasticity and fracture studies | Specialized stateful solver contracts, contact/interface representation, load histories, regularization and dedicated reference cases. |
| Thermoelastic studies | Validated conduction, thermal expansion/material data, coupling definition and temperature/displacement comparison. |

### Method families to evaluate and expose

| Method family | Intended use | Evidence before promotion |
|---|---|---|
| Strong-form PINNs | Per-problem forward and inverse solutions | Autograd derivative checks, scaling, boundary enforcement, independent-point residuals, multiple seeds and field/QoI errors against physical references. |
| Energy/variational PINNs | Mechanics problems with a valid energy/weak formulation | Correct quadrature and essential conditions; compare integration error and optimization error separately. |
| Domain-decomposed/mixed methods | Heterogeneous, multiscale or mixed-field cases | Interface continuity/flux checks, subdomain error and measured communication/compute costs. |
| FNO/DeepONet and related operators | Repeated solution families with structured inputs or query mappings | Data-generation cost, simulation-level held-out tests and measured break-even versus a competent reference. |
| Mesh/graph and geometry-aware operators | Changing domains, irregular meshes, lattices and varying topology | Hold out complete geometries/meshes; preserve boundaries/interfaces; test thin features and disconnected bodies. |
| Hybrid FE–ML | Learned initial guesses, corrections, reduced models or selected coupled fields | Independent reference route, valid correction behavior, robustness outside the training examples and end-to-end cost. |
| Inverse and learned constitutive methods | Material/parameter identification or a constitutive law inside an actual solver | Identifiability, unseen load paths, tangent/stability checks and data rights. |

The ML contract must be independent of a specific architecture: problem definition, mesh/samples, boundary and material labels, tensor fields, training/inference requests, checkpoints and provenance. A model contributes a real adapter to that contract; a generic plugin label or notebook is not product integration. Users should be able to run comparable experiments with representative strong-form PINN, energy/variational, operator-learning and mesh/graph methods on suitable shared cases, and add further architectures through the adapter contract. The UI lists only integrations that Phyra can actually load, run, validate and report; integration does not imply that every method is scientifically supported for every problem.

### Replicate research without adding paper-specific features

The first energy case pack is now [machine-readable](examples/research-cases.json) and runnable with `npm run verify:research`: axial analytical baseline, Wang et al. (2023) Section 3.2 partial prescribed-edge small-strain adaptation, and a changed circular-cutout/Kirsch case through the same method. Sources, SI choices, configuration/seeds, reference policies, failures and deviations are explicit. The original EPINN architecture, large displacement and runtime are not replicated. Signed energy and finer independent quadrature distinguish integration sensitivity from optimization/field error; a discrepancy above 1% rejects publication. These are experimental research cases, not an achieved general accuracy or performance milestone.

Build a curated set of runnable case packs that cover representative patterns from the reviewed literature. Initial candidates include:

- a circular-hole plate with a carefully matched Kirsch reference and mesh-convergence study;
- notched or mixed-boundary 2D elasticity;
- a heterogeneous/inverse material case;
- selected 3D bracket, frame or lattice geometry on irregular meshes;
- a mesh/geometry-aware operator-learning family with held-out geometries;
- one separately validated contact, fracture or thermoelastic case where the required classical path exists.

Each case pack records the paper and the exact scope reproduced, geometry and units, materials, loads/conditions, mesh/data policy, method configuration, seeds, reference fields and quantities of interest, errors/tolerances, failures, hardware and source/data license. State deviations from the paper. Do not claim a full replication from a matching picture or one parameter setting.

Generate training, validation and test data by independent physical instances. Test unseen geometry separately from unseen material/load parameters and unseen points on a known solution. Report data generation, preprocessing, training, validation, inference, memory and reference costs. Physics ML is promoted only when it has a justified use; a selected classical method may remain more accurate, robust or faster for a given case.

### PhysicsNeMo and local accelerator evaluation

NVIDIA PhysicsNeMo is an optional research/runtime adapter candidate, not Phyra's CAD system or default solver. Its maintained documentation provides mesh/graph representations and a structural-mechanics MeshGraphNet example; this makes it a concrete basis for evaluating irregular-mesh workflows. Integrate through Phyra's neutral study/data/field contract and pin a tested upstream release. Compare accuracy, data handling, dependencies, licensing, platform/device support, cancellation and total cost. Do not pull large framework or CUDA dependencies into the default desktop install.

Maintain the support matrix by method × operation × framework/runtime × platform × device × precision. Test actual forward pass, derivatives/backward, training, inference, cancellation and field export. CPU remains the reproducible baseline. Advertise CUDA, MPS or another accelerator only for the specific method and operation that passed on supported hardware; device detection alone is insufficient.

## 8. AI assistant, BYOK and agent workflows

AI assistance is part of the product direction, not a future optional extra. It should help users understand the product and operate supported workflows without becoming an authority on physical correctness.

The current core retrieves versioned offline help and automatically supplies the active SI study and available run/result summaries when the user deliberately sends a message. Gemini, OpenAI Responses, Anthropic Messages and compatible/Ollama adapters stream text; independently saved connections expose account-discovered model choices in chat. Native OS credentials are isolated by provider and endpoint origin. Local version 1 transcripts retain exact supplied context and provider/model/endpoint provenance; connection settings use an explicitly migrated version 2 registry. Numerical execution stays local, and the assistant has no mutation, solve/export or browsing tools. Adapters and fixture tests do not establish live operation of every provider/model or packaged platform.

### BYOK provider architecture

Maintain the implemented direct provider adapters and provider-neutral text event contract. Extend provider-native and compatible APIs only when needed features are supported and measured. Track each model's actual support for streaming, tool calls, structured outputs, document/image input, context limits, cancellation and usage reporting; current adapters expose text streaming and available limits/usage only. Unknown capabilities remain unknown. Do not silently downgrade a request when a feature is missing.

Do not require a Phyra-hosted gateway. A shared gateway can simplify organization-wide routing, virtual keys, budgets and observability, but it introduces a separate service, credential and data-routing responsibilities. The desktop should allow users to connect directly with their own key or configure a gateway they already control. Evaluate a multi-provider SDK only if its licensing, protocol coverage and failure behavior reduce maintenance without becoming a required proxy deployment. Local and offline workflows remain available without an API key.

Keep provider credentials in the operating system's secure credential store. Never write keys into .phyra projects, prompts, logs, crash reports or exports. Show the selected provider, model, endpoint and exact study/document context sent with a request. Warn before sending CAD metadata, field data, images or documents externally; do not treat local files as provider input by default. Separate API charges from Phyra's local compute and report unknown cost as unknown.

### User-facing AI capabilities

| Capability | Target behavior | Required evidence and controls |
|---|---|---|
| Product/documentation assistant | Answer questions about geometry tools, boundary conditions, materials, solver limits, errors and workflows. | Retrieve from versioned, offline Phyra help; cite the relevant help sections; say when the answer is not present. |
| Study and result assistant | Explain the active problem, solver log, convergence, units and selected result fields. | Read exact project/run/result data through typed tools; cite study/run IDs and values; never invent a stress, error or physical conclusion. |
| Modeling and analysis copilot | Help define geometry/conditions, diagnose missing constraints, create a mesh, start a solver and inspect results. | Produce a visible plan and typed change set; validate units/capabilities/current input fingerprint; ask approval before modifying the model, starting expensive work or exporting data. |
| Bounded research agent | Coordinate a parameter sweep, mesh convergence, comparison or supported optimization study. | User-set limits for runs, time, memory and provider spend; progress, cancellation, partial-failure handling and reproducible provenance. |
| External agent access | Let an external agent inspect and use Phyra from an authorized host. | Expose the same typed, capability-checked operations as the UI; a tool request cannot bypass desktop permissions or validation. |

Mutations must have a reviewable diff and a working undo path. Read-only help, geometry inspection and result queries can be available without mutation permission. For higher-impact actions, authorization must be clear, scoped and revocable. Treat imported documents, CAD metadata, model files and solver output as untrusted input; test prompt injection, stale edits, malformed tool calls, path traversal, unauthorized operations and credential leakage.

### MCP and computer-use integration

The implemented local stdio server is pinned to MCP 2025-11-25 and exposes capability/help/project/run inspection through opt-in scopes. Native consent has a 90-second renewable lease, revocation and a visible access audit. Snapshots follow the active tab and carry permitted project/revision/run identity. Registration currently copies generated JSON into a stdio-capable local client; no one-click host installation is claimed.

Future MCP mutations should cover geometry/condition change sets, mesh creation, solver launch/cancellation and export only after typed validation, reviewable diffs, undo and explicit authorization are complete. Version tool schemas, validate all inputs and outputs, return structured provenance and retain an action audit. Provide a tested registration path for supported hosts, with one-click installation only where the host offers a supported installation API. The server must not expose a general shell, arbitrary file access or public network listener.

MCP is a transport and discovery contract, not Phyra's permission policy. The desktop remains responsible for consent and enforcement. Clearly show which tools are exposed, indicate each invocation and require user confirmation for sensitive changes, solve/export actions or external data transfer. Test against a pinned stable protocol release; do not assume a host will enforce Phyra's safety rules.

For hosts that provide computer-use support, offer a bounded visible-app surface with semantic element names, accessible navigation and screenshots where the user authorizes them. Prefer Phyra's typed actions for engineering mutations because they can be validated and audited. Pixel-based clicking is a fallback for navigation, not a way to bypass model validation or approval.

## 9. Results, documentation and product experience

The workbench should communicate engineering intent and capability clearly at every stage:

- Provide a stable model tree, geometry editor, viewport and property inspector with keyboard-accessible commands, selection modes, undo/redo and contextual help.
- Show units, coordinate frames, material orientation, loads, constraints and the selected formulation where they are edited.
- Explain invalid geometry, missing constraints, unsupported solver combinations, mesh failures, stale results and failed remapping with an actionable repair path.
- Show which region, body, mesh and run a result belongs to. Distinguish a static field animation from time-dependent dynamics.
- Provide sections/clipping, body isolation, vectors/tensors/principal quantities, probes and paths, surface/volume integrals, time/frequency navigation and controlled comparison as supported by each field type.
- Keep field association intact. Make smoothing/projection explicit and do not hide singularities or discontinuous material interfaces.
- Use sequential color maps for ordered magnitudes and diverging maps centered at zero for signed quantities; show units, limits, clipping and undefined values accessibly.

Every supported analysis and method should have an offline help card covering equations, assumptions, geometry/material/condition compatibility, units, outputs, references, validation and known failures. Include a searchable capability catalogue, boundary-condition glossary, CAD tutorials and runnable examples. The documentation assistant should use this same versioned help source rather than a separate unmaintained knowledge base.

Provide useful export and reporting for model definition, mesh, solver settings, provenance, plots, fields and benchmark comparisons. Reports must distinguish reference data, solver output, ML prediction and assistant interpretation. Keep the roadmap as the single planning document; put operational instructions in README/CONTRIBUTING and product help beside the features it explains.

Measure usability with representative engineering users. The acceptance task should cover geometry creation/import, materials and conditions, mesh, solve, interpretation and save/reopen. Record completion rate, time to first correct study, diagnostic recovery and critical unit/boundary/result-interpretation errors.

## 10. Architecture and local devices

Keep the Tauri + React/TypeScript desktop and headless numerical engine direction. Continue to separate project definition, geometry, meshing, materials, study, execution, fields and AI adapters. The UI expresses engineering intent; numerical backends report their actual formulation and limitations. Bulk mesh/result arrays do not belong in ordinary reactive JSON state.

Promote extension contracts from real vertical slices, not speculative placeholders. The stable boundary should eventually cover:

- CAD-kernel and neutral-file adapters;
- geometry/mesh identity and material/boundary assignments;
- classical solver and physical formulation capabilities;
- Physics ML training, inference, model and dataset manifests;
- AI provider and internal typed-tool adapters;
- result fields, provenance, cancellation and validation.

Version project schemas explicitly. Editing geometry, material, conditions or solver settings invalidates dependent results and incompatible learned models. Preserve stable units and result associations through migrations. Keep reusable trained models and datasets as separately versioned artifacts; do not mix executable models with ordinary result caches. Stabilize a third-party extension SDK only after at least two real integrations demonstrate the common requirements.

### Local GPU and runtime

Keep a dependable CPU reference route and make local acceleration an explicit product capability. The matrix must identify supported model/method, operation, GPU runtime, device, precision, platform, memory limits and validated case. Include local NVIDIA CUDA workflows as a target and Apple MPS where operations pass; add other accelerators only after equivalent evidence. Checkpointing, resume and cancellation must restore or retire actual optimizer/model state rather than merely saving training settings.

Optional research runtimes must not prevent a CPU user from installing or launching the desktop. Report which operations will use CPU/GPU and any precision differences before execution. Validate field and quantity-of-interest tolerances across devices; preserve the actual device/runtime/precision in provenance.

### Local execution contracts

Keep execution requests, job state, cancellation, progress, input fingerprints and result/provenance contracts separate from the UI so local backends can be isolated, tested and changed without coupling them to the interface. Use versioned project and study definitions, and keep solver inputs and results on the user's machine.

## 11. Acceptance gates

A capability is ready to be presented as supported only when its evidence covers the full user workflow.

| Gate | Required evidence |
|---|---|
| CAD authoring | Users can create and edit representative constrained 2D profiles and 3D mechanical parts, import supported neutral files, inspect/repair geometry and preserve feature history through save/reopen. |
| Geometry identity | Material and boundary selections survive valid edits/remeshing; ambiguous references require repair before solving. |
| Mesh quality | Supported mesh families have quality checks, local/global refinement and convergence evidence appropriate to their analyses. |
| Classical mechanics | General 2D plane stress/plane strain and 3D linear static solid workflows cover editable/imported geometries, multiple materials and common loads/supports; representative modal/buckling, dynamic, nonlinear/contact and fracture/damage workflows each have their own references, balance checks, mesh/time convergence and failure tests. The published matrix states exact limits. |
| Materials and conditions | Every advertised material, load, support, contact or thermal condition has explicit units/semantics, assignment behavior and solver compatibility tests. |
| Heat and radiation | Heat conduction and any advertised convection/radiation model pass their own energy, nonlinear-convergence and boundary-sign tests; the three radiation models remain distinct. |
| Physics ML | Comparable experiments are runnable through the shared contract for representative PINN, energy/variational, operator and mesh/graph methods. Every integrated method has reproducible configuration, held-out validation appropriate to its claim, applicability limits, failures, actual device/precision and end-to-end cost. |
| Paper-inspired research | At least a curated set of representative case packs can be recreated from product workflows; each states its source, reproduced scope, deviations, data rights and comparison metrics. |
| AI and BYOK | Documentation answers cite the versioned help source; study/result answers trace to actual fields and runs; credentials stay out of projects/logs; users can inspect outbound context and control provider cost. |
| Agent tools and MCP | Permissions, input schemas, confirmation, stale-state checks, undo, cancellation, result provenance and prompt-injection handling pass adversarial workflow tests. |
| Architecture and compatibility | Project migrations preserve or explicitly invalidate caches; feature and engine capability matrices agree; real adapters use the shared contracts without placeholder modules. |
| Local GPU | Every advertised GPU/method/operation combination has packaged tests on the declared device and precision; CPU remains usable. |
| Desktop reliability | Supported macOS and Windows packages complete representative CAD-to-result, assistant, cancel, recover, save/reopen and export workflows. |
| User understanding | Representative users complete declared engineering tasks without critical unit, boundary, formulation or result-currency mistakes. Documentation matches actual shipped behavior. |

Choose numerical tolerances before evaluating each benchmark. Do not apply one universal error percentage across fields with different scales or engineering meaning. Measure at least five independently seeded learning runs as an initial screening floor where randomness applies; make no reliability claim from that floor alone. Report failure rate, high-percentile error, quantities of interest and end-to-end memory/time alongside mean field error.

## 12. Further product areas

With mechanical CAD and validated structural/research workflows in place, extend the same preparation contracts into broader fluid mechanics, more complete multiphysics and more demanding locally run accelerator studies. Each is a separate product area with distinct geometry, boundary conditions, data movement, conservation and operations; none should be represented as “enabled” by a generic plugin switch.

Possible future paths include:

- steady and transient incompressible flow, then selected compressible, turbulent, multiphase and porous-media problems;
- more complete enclosure radiation and coupled thermal–structural analysis;
- conjugate heat transfer and fluid–structure interaction after component solvers and conservative coupling are validated;
- broader multidisciplinary methods, optimization and uncertainty workflows.

This future direction does not create a release schedule. Expand only where users, maintainers, available libraries and verification evidence justify a complete workflow.

## 13. Research anchors

The selected literature motivates shared geometry, physics, mesh, material, boundary and model capabilities. These are representative anchors from the broader review, not a claim that Phyra will reproduce every paper.

### Solid mechanics and Physics ML

- Rezaei et al. (2022), [mixed PINN formulation for heterogeneous domains](https://arxiv.org/abs/2206.13103).
- Wang et al. (2023), [exact Dirichlet energy-based PINN for solid mechanics](https://doi.org/10.1016/j.cma.2023.116184).
- Kashefi and Mukerji (2023), [physics-informed PointNet on irregular elasticity geometries](https://arxiv.org/abs/2303.13634).
- Lian et al. (2023), [PINNs for phase-field brittle fracture](https://doi.org/10.3389/fphy.2023.1152811).
- Abueidda and Mobasher (2023), [learning methods for thermoelasticity](https://arxiv.org/abs/2305.17799).
- Roy and Bose (2023), [physics-constrained learning for von Mises plasticity](https://www.sciencedirect.com/science/article/pii/S0952197623002336).
- Kamali and Laksari (2024), [physics-informed learning for heterogeneous elasticity](https://doi.org/10.1016/j.jmbbm.2023.106228).
- Hildebrand and Klinge (2024), [neural FEM and neural operator comparison in solid mechanics](https://doi.org/10.1007/s00521-024-10132-2).
- Sahin et al. (2024, preprint), [PINNs for 3D contact problems](https://arxiv.org/abs/2412.09022).
- Tian et al. (2025), [adaptive energy-based PINN for solid mechanics](https://doi.org/10.1016/j.engstruct.2025.119884).
- Kaewnuratchadasorn et al. (2025), [geometry-aware neural operator for solid mechanics](https://doi.org/10.1111/mice.13405).
- Le-Duc et al. (2026), [normalized energy-based PINNs for solid mechanics](https://doi.org/10.1016/j.finel.2026.104523).

### Engineering and integration references

- NVIDIA, [PhysicsNeMo overview](https://docs.nvidia.com/physicsnemo/latest/overview.html), [MeshGraphNet deforming-plate example](https://docs.nvidia.com/physicsnemo/latest/physicsnemo/examples/structural_mechanics/deforming_plate/README.html) and [mesh/graph user guide](https://docs.nvidia.com/physicsnemo/latest/user-guide/mesh.html).
- Gmsh, [reference manual](https://gmsh.info/doc/texinfo/gmsh.html), for current mesh integration and future mesh-control evaluation.
- Model Context Protocol, [tool specification](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) and [security best practices](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices).
- LiteLLM, [SDK and gateway deployment paths](https://docs.litellm.ai/docs/learn) and [gateway request architecture](https://docs.litellm.ai/docs/proxy/architecture), as a reference for evaluating a provider adapter library versus operating a shared proxy.

Review this roadmap at major capability gates. Reassess the order when user evidence, research results, library maturity, licensing or platform support change. Mark a capability complete only when its implementation and acceptance evidence exist in the repository or linked verification records.
