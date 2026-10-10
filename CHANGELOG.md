# Changelog

Notable changes to Phyra are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe changes that affect users; contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-pull-requests).

## Unreleased

## 0.4.0 (2026-10-10)

Phyra v0.4.0 brings exact CAD authoring into the workbench and adds a source-bound linear-static FEM path for eligible closed solids. Surface shells and assemblies remain definition-only; CAD results are admitted only after exact face correspondence and mesh checks.

### Added

- A project overview and dedicated CAD workspace support editable 2D/3D designs, constrained sketches, exact features, STEP import, entity inspection and SI BRep or m/mm STEP export through isolated native workers. ([1d6b746](https://github.com/oguzhankir/phyra/commit/1d6b74620207fdd38066a5d1266d919288d4304c), [86c5a4b](https://github.com/oguzhankir/phyra/commit/86c5a4b496dcc5709a8817062c65b44fd7892b83))
- Sketch and CAD editing adds snapping, on-canvas dimensions, selection-driven constraints, bounded solve feedback, exact Preview/Apply/Cancel drafts, rigid placement, edge operations and standard views. ([86c5a4b](https://github.com/oguzhankir/phyra/commit/86c5a4b496dcc5709a8817062c65b44fd7892b83), [9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- CAD mesh inspection creates independent Gmsh tetra4 meshes for one closed solid, reports element quality and exact-versus-mesh volume, and links selected mesh boundaries to exact source faces after a complete unique correspondence check. ([9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- Prepare analysis can create a source-bound 3D linear-static FEM study from one closed exact solid with complete unique face correspondence. Face assignments persist across remeshing of unchanged geometry; supported conditions include restraints, prescribed displacement, total force and pressure. Geometry edits require explicit study recreation and reassignment. ([9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- Exact loft/sweep solids or surface shells, placed sections and independent assembly instances extend authored geometry. Eligible closed loft/sweep solids can use the source-bound FEM path; surface shells and assemblies remain definition-only. ([00d36cc](https://github.com/oguzhankir/phyra/commit/00d36cc901c9ee7635b64c41868a30db3011d12), [9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- Optional AI guidance can use bounded CAD/open-sketch evidence and read-only geometry inspection without attaching project files or field buffers. ([30d78a0](https://github.com/oguzhankir/phyra/commit/30d78a046801898af2aabf7359937245109b9d63), [dab3b39](https://github.com/oguzhankir/phyra/commit/dab3b39afe0e1a3c74a73572f8cd45796419fa15))
- Geometry validity and analysis eligibility are separate. Supported exact primitive/profile adapters retain the authored CAD definition and connect eligible studies to the existing material-to-results workflow. ([1d6b746](https://github.com/oguzhankir/phyra/commit/1d6b74620207fdd38066a5d1266d919288d4304c))

### Changed

- Project schema v8 adds source-bound CAD solids and stamped boundary sets. Versions 1–7 validate against frozen schemas before migration; CAD field-cache reuse requires matching a rebuilt exact source and mesh. Imported STEP sources remain immutable native-owned archive assets. ([9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- The CAD workspace unifies tabs and menus in a shared header, groups editing controls, and makes model navigation and property/analysis details responsive to available space. ([9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- Phyra-owned source code is licensed under Apache-2.0. Bundled dependencies retain their own terms, the combined application remains subject to applicable GPLv3 obligations, and earlier GPL releases retain their granted rights. ([9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a))
- README launch media and offline-help captures were refreshed to show the v0.3.0 interface and genuine saved CPU references. ([d95d2fd](https://github.com/oguzhankir/phyra/commit/d95d2fdd65a4c4203320d46d09969a3d1ad200ff))

### Fixed

- Project and recovery sessions preserve document ownership across validation, tab replacement, checkpoint retries and close failures; results remain pending until the owning document accepts transferred fields. ([3087038](https://github.com/oguzhankir/phyra/commit/30870382a8614408665bd95694632af175ad8ccd), [5280acf](https://github.com/oguzhankir/phyra/commit/5280acfced91a1709e6045b96ca9f2bf71794aba))
- Cached PINN fields are rejected when they violate prescribed supports or their reported strain energy disagrees with stress-field integration; support tolerances are bounded to trusted geometry scales. ([9e03945](https://github.com/oguzhankir/phyra/commit/9e03945feb7eec609225debb86a3f448e6d3d966), [992f3d6](https://github.com/oguzhankir/phyra/commit/992f3d6ace873f901e8ea3b7603e6fbfe0603be0))
- CAD validation rejects study/source mismatches and primitive dimensions below kernel tolerance. Counterclockwise profiles reach the same supported numerical adapters; mesh/viewport updates retain graphics resources, and packaged workers preserve portable diagnostics and JSON framing. ([705f7a9](https://github.com/oguzhankir/phyra/commit/705f7a979815d338f1507e68f587c29565db5164), [9f8840c](https://github.com/oguzhankir/phyra/commit/9f8840cf0276fd8977c47e6de3b724aa7ef45f7a), [5096fcd](https://github.com/oguzhankir/phyra/commit/5096fcdc0cf74e376b19688bc09791e32154f3ae))
- Redundant sketch constraints receive bounded repair hints; named boundary IDs remain reserved across profile edits, and menu commands stay active during focus changes. ([afd7836](https://github.com/oguzhankir/phyra/commit/afd783643514c3f70e5db7e5118877b1c69f0482), [257a21e](https://github.com/oguzhankir/phyra/commit/257a21e3a8b880b153f1093f438ef4a0ec98e550), [5fb56ce](https://github.com/oguzhankir/phyra/commit/5fb56ce7b63a13a63e1d1eb963afb13dc8317d46))

### Security

- Optional assistant streams, model catalogs and cancellation preserve saved provider keys; denied MCP requests log canonical operation labels rather than private client-supplied names. ([773c48f](https://github.com/oguzhankir/phyra/commit/773c48fb16df2c3182a358b2d164baf0af86ca1c), [18fd67d](https://github.com/oguzhankir/phyra/commit/18fd67d19cc87ad626a55dcf0b7753d2424a3adf))

## 0.3.0

### Added

- Experimental potential-energy plane-stress PINN on rectangles and profiles, with exact compatible finite straight-segment displacement conditions, force/pressure/spatial traction, signed energy history and a finer independent integration audit that rejects underintegrated fields. Training uses no FEM labels.
- Editable energy tension, partial prescribed-edge and circular-cutout research cases with primary-source provenance, disclosed small-strain/method deviations and repeatable CPU/FEM measurements.

- Central 2D sketch drafting adds exact rounded-slot outlines with tangent lines/semicircular ends and midpoint splitting of straight boundaries, preserving validated Apply/Revert and explicit boundary repair.
- Object context menus in the model tree and viewport create and edit loads, supports and boundary sets directly from the selected geometry; explicit zoom, fit-selection and view controls make model navigation discoverable.

- AI assistant with independent saved provider connections, a searchable model picker across connected accounts, direct sending with automatic active-study context, and searchable conversation history grouped by date. Connection status, key replacement, failures and disconnection stay in a dedicated connection screen.
- Local MCP starts in one step with individual read-only tool switches, client-specific copyable configuration, native VS Code installation and a terminal-style access log. Changing enabled tools revokes prior client configurations.
- Isolated assistant session transactions and presentation contracts support independent development while preserving exact context, cancellation, stream ordering and history failure recovery.
- Search actions now explains editor navigation and project actions. Help/F1 is the single general help entry, and help/action search use restrained keyboard focus styling.
- Provider disconnection removes only that connection and its unshared saved key; other connections, local conversations and projects remain available. Legacy assistant settings migrate to a versioned connection registry.
- Assistant requests, local history and MCP snapshots reject content containing credentials from any saved remote connection, including inactive providers.
- macOS packaging accepts an installed `APPLE_SIGNING_IDENTITY`, signs embedded native code before its containing bundle, and refuses an unavailable identity instead of silently substituting ad hoc signing.
- Home screen for creating a named 2D or 3D project, opening a local project and starting from an editable example.
- Home and a closable project tab that preserve the current project while moving between the start screen and workbench. Close with the tab’s ×, File → Close project or Ctrl/⌘ W.
- Desktop auto-save updates an associated project file after a 1.5-second editing pause, with an on/off control and visible pending, paused, saving and failure states. A first explicit Save chooses the file location; recovery copies remain separate.
- A preparation checklist checks study, geometry, material, supports, loads, mesh settings and method eligibility before execution. Boundary restraint checks account for rigid translation and rotation; the worker remains authoritative after meshing.
- Independent project tabs preserve each document’s edits, file association, recovery and run/result ownership, with a 32-document session limit.
- Bounded interactive 2D profile drafting with rectangles, polylines, circular arcs, radius edits, grid snapping and circular holes, followed by validated Apply or Revert.
- Native Gemini, OpenAI Responses, Anthropic Messages and compatible/local Ollama text streaming, account model discovery and OS credential storage for the optional assistant.
- In-product mathematical formulations for 3D/plane-stress FEM, scaled PINN residuals/losses and Kirsch reference assumptions, with primary references and source links.

### Changed

- Shared searchable selectors and focused detail dialogs replace native dropdowns and disclosure rows throughout the workbench, with keyboard navigation and light/dark styling.

- Project schema v5 records the selected Physics ML formulation. Frozen v1–v4 inputs migrate explicitly to strong-form; unchanged legacy fields remain eligible for ordinary ownership, fingerprint and field validation. Recovery discovery preserves original journal bytes.

- The workbench keeps its model tree and selected object properties together in one left dock, with a large central viewport and a compact Prepare/Solve/Inspect toolbar. Preparation checks expand on demand.

- A compact File/Edit/View/Help header stays available on Home and in the workbench. Examples live on Home; New project uses the same name and analysis-type dialog from Home, File or Ctrl/⌘ N.
- Save identifies its associated file through a tooltip. Pending and failed writes remain visible; successful writes show a brief confirmation. Home lists open documents, and switching tabs keeps them open.
- Support and load summaries stay visible in the model tree, and successful saves show a short confirmation before returning to the document state.

### Fixed

- PINN normalization measures spatial tractions along each boundary so a sign-changing load that vanishes at its midpoint retains its physical stress scale; cache validation uses the same rule.
- Object/viewport menus close when their document becomes inactive or a dialog opens; selected model rows stay visible and keyboard deletion restores focus safely.

- Empty conversations open at the top without clipping the welcome content. Streaming follows only the chat transcript, preserving the surrounding workbench scroll position.
- A delayed or cancelled turn cannot clear a newer composer draft after switching documents or conversations; cancellation during the initial history write retains a cancelled record without contacting the provider.
- Action-search options have distinct accessible identities, so the Results action cannot collide with its containing result list.
- macOS assistant settings check whether a credential exists without decrypting its secret, avoiding unnecessary Keychain authorization requests when opening the panel or saving connection settings.
- Closing or replacing a dirty project offers Save, Discard and Cancel, waits for an active automatic write and preserves the project when saving fails or is cancelled. A saved project can close directly.
- Assistant settings and history load on first panel use. OS credential access and serialized assistant storage run on background workers so they cannot block the native UI thread.
- Delayed assistant settings and MCP snapshot updates cannot replace newer saved connections or active-document publications.
- Layout changes preserve viewport pan, orbit and relative zoom so a model does not become cropped when the preparation checklist disappears.
- Failed response writes preserve the transcript with Retry save and a confirmed restore of the saved copy. Questions remain in the composer when their initial write fails. Shared history tabs use one current transcript, and streamed responses stop before exceeding local history limits. Credential checks cover provider origins in earlier turns even after changing the active provider.

## Initial baseline — 0.2.0 development

This is the starting snapshot for the changelog, not a reconstructed release history. The repository identifies 0.2.0 as a development build; no release date is assigned here.

### Added

- Local linear static elasticity workflows for 3D solids and 2D plane-stress rectangles and profiles, with editable geometry, material, supports, loads, meshing and FEM results.
- Experimental rectangular plane-stress PINN training with measured losses, device/precision metadata and comparison against FEM at matching locations.
- Field inspection, physical diagnostics, SI CSV export, viewport selection and undeformed distance measurement.
- Versioned `.phyra` project archives, bounded definition undo/redo, stale-result rejection, owned cancellable workers and definition-only recovery copies.
- Editable SI examples, validated CPU reference studies and offline engineering help.
