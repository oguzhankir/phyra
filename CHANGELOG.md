# Changelog

Notable changes to Phyra are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe changes that affect users; contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-pull-requests).

## Unreleased

### Added

- CAD mesh inspection links boundaries to exact source faces only after a complete unique BRep round-trip comparison. A searchable boundary list, viewport picking and Mesh/CAD faces switch highlight the same source through remeshing unchanged geometry. Unavailable correspondence is explicit; inspection selection stays separate from modeling and physical assignments.

- Single-solid CAD mesh inspection generates independent Gmsh tetra4 meshes from exact BRep geometry. The workspace shows boundary triangles, element counts and quality distribution, and exact-versus-mesh volume. Inspection remains transient; it neither assigns physical boundaries nor enables general-solid analysis or replaces exact CAD exports.

- New desktop CAD solid operations use editable command drafts with exact Preview, one-transaction Apply and Cancel. Provisional shapes cannot enable analysis/export or replace the last accepted shape; incomplete numeric drafts and late/cancelled previews remain blocked.
- CAD navigation adds overlapping-entity selection with Alt-click, visible-model and selected-entity fitting that preserves viewing direction, and numbered standard-view shortcuts.

- Exact no-hole loft/sweep solids or surface shells with ordered section/path selectors, placed section duplication and editable named assembly instances. Multi-body picking and isolation preserve component identity; these new operations remain definition-only for analysis. Offline tutorials and AI guidance describe their implemented scope.
- Project overview and a dedicated CAD workspace for empty 2D/3D designs, constrained line/arc/circle sketches, exact solid features, STEP import, entity inspection and SI BRep or m/mm STEP export through local isolated kernels.
- Direct blank-plane sketch editing with endpoint/grid/axis snapping, on-canvas dimensions, selection-driven constraints, local open-sketch solving and conflict/degree-of-freedom feedback. Modeling adds rigid placement, guided edge operations, standard orthographic views, retained stale previews and optional automatic rebuild.
- AI assistance accepts CAD-only project context, bounded current exact-geometry and sketch-solve evidence, and read-only CAD inspection without attaching source files or field buffers.
- Separate geometry validity and analysis eligibility, with explicit gates for unsupported designs and exact primitive/profile adapters that retain the authored CAD source through the existing material-to-results workflow.

### Changed

- CAD now shares application menus and document tabs in one header, with modeling tools, file status, Save and Rebuild in one command strip. Compact view selectors replace the wide view-button row; Auto-save and Auto rebuild move into their relevant menus. English help and assistant guidance describe the new locations and mesh-inspection limits.

- The CAD workspace uses a compact grouped toolbar, a resizable/collapsible Model and Operations navigator, and on-demand properties, measurement, analysis and export details. Project saving stays in the shared command strip; narrow workspaces collapse the navigator to retain drawing space.
- Sketch dimension activation focuses its editable constraint value; plane axes and point-coordinate labels match the active plane. Constraint names, linked geometry selection, conflict highlighting and hover feedback make edits easier to inspect. Product-assistant responses and visible help metadata use English.

- Phyra-owned source code is now Apache-2.0. Bundled GPL-covered dependencies retain their licenses; combined application metadata, notices and Corresponding Source gates explicitly preserve the applicable GPLv3 distribution obligations. Earlier GPL grants remain valid.

- Application menu actions activate before the menu closes, preserving theme and other command selections during focus changes.
- Native sketch builds discover a compatible installed MSVC toolchain on Windows; CAD worker output flushing uses the platform's native C runtime to preserve JSON framing.
- Project schema v7 extends geometry documents and optional studies with loft, sweep and named assembly instances. Validated v1–v6 inputs migrate explicitly; unchanged numerical and v6 CAD inputs preserve compatible cache fingerprints. Unreleased CAD definitions also support rigid placement and general closed line/arc hole contours; analysis adapters remain independently bounded. Imported STEP sources are immutable native-owned definition assets transported inside project archives and retained for definition recovery.

### Fixed

- CAD rebuilds and CAD/mesh inspection switches reuse the viewport's graphics context and compiled materials. Shaders compile asynchronously where supported, with explicit graphics-loss feedback; repeated shape updates no longer recreate the graphics context.

- CAD profiles drawn clockwise now reach the same supported numerical adapters as counterclockwise profiles. Derived traversal is normalized without changing authored geometry, boundary identities or constraints; independent tension and extruded-solid checks cover every rectangle drawing direction.

- Project validation rejects a CAD study whose dimension disagrees with its geometry before opening the document, avoiding an unusable preparation state.
- CAD rebuilds reject primitive dimensions at or below the exact kernel tolerance with a consistent diagnostic across platforms.
- Redundant sketch constraints receive bounded repair hints without changing the native solve, including equivalent authored constraints when native diagnostics time out. Help and assistant guidance identify these hints as potentially incomplete.
- Packaged Windows CAD workers align native output handles and route OCCT messages to stderr without suppressing message severities, preserving JSON framing.

## 0.4.0

### Changed

- Refreshed the README launch video and workbench, sketch and diagnostic screenshots for v0.3.0, including offline help captions that identify recorded CPU references.

### Fixed

- Opening a cached project releases document ownership locks during validation and rejects late association changes, preventing hangs during recovery and replacement of a newer tab state. Migration notices identify the actual schema and only claim cache reuse after validation.
- Recovery checkpoints and cleanup can retry a temporary initialization failure without reloading the document or changing its journal identity. A session-limit close failure preserves the active recovery copy and client before any discard or cleanup.
- Completed worker results remain pending until their document receives and accepts the buffer; failed transfers preserve the previous result for saving and export. Cancellation follows the matching request through preparation and completion.
- New profile boundaries reserve identifiers referenced by named boundary sets, so deleting and recreating geometry cannot silently reassign an incompatible set.
- PINN cache reuse rejects fields that violate prescribed supports or whose reported strain energy disagrees with their stress fields, accounting for the recorded training precision.

### Security

- Provider streams and model catalogs protect saved keys from every connection, including fragmented responses and cancellation. Denied MCP requests record canonical operation labels instead of private client-supplied names.

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
