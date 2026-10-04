# Changelog

Notable changes to Phyra are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe changes that affect users; contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-pull-requests).

## Unreleased

### Added

- Experimental potential-energy plane-stress PINN on rectangles and profiles, with exact compatible finite straight-segment displacement conditions, force/pressure/spatial traction, signed energy history and a finer independent integration audit that rejects underintegrated fields. Training uses no FEM labels.
- Editable energy tension, partial prescribed-edge and circular-cutout research cases with primary-source provenance, disclosed small-strain/method deviations and repeatable CPU/FEM measurements.

- Central 2D sketch drafting adds exact rounded-slot outlines with tangent lines/semicircular ends and midpoint splitting of straight boundaries, preserving validated Apply/Revert and explicit boundary repair.
- Object context menus in the model tree and viewport create and edit loads, supports and boundary sets directly from the selected geometry; explicit zoom, fit-selection and view controls make model navigation discoverable.

- AI assistant with independent saved provider connections, a searchable model picker across connected accounts, direct sending with automatic active-study context, and searchable conversation history grouped by date. Connection status, key replacement, failures and disconnection stay in a dedicated connection screen.
- Local MCP starts in one step with individual read-only tool switches, client-specific copyable configuration, native VS Code installation and a terminal-style access log. Changing enabled tools revokes prior client configurations.
- Isolated assistant session transactions and presentation contracts support independent development while preserving exact context, cancellation, stream ordering and history failure recovery.
- Search actions now explains editor navigation and project actions. Help/F1 is the single general help entry, and help/action search use restrained keyboard focus styling.
- Provider disconnection removes only that connection and its saved key; other connections, local conversations and projects remain available. Legacy assistant settings migrate to a versioned connection registry.
- macOS packaging accepts an installed `APPLE_SIGNING_IDENTITY`, signs embedded native code before its containing bundle, and refuses an unavailable identity instead of silently substituting ad hoc signing.
- Home screen for creating a named 2D or 3D project, opening a local project and starting from an editable example.
- Home and a closable project tab that preserve the current project while moving between the start screen and workbench. Close with the tab’s ×, File → Close project or Ctrl/⌘ W.
- Desktop auto-save updates an associated project file after a 1.5-second editing pause, with an on/off control and visible pending, paused, saving and failure states. A first explicit Save chooses the file location; recovery copies remain separate.
- A preparation checklist checks study, geometry, material, supports, loads, mesh settings and method eligibility before execution. Boundary restraint checks account for rigid translation and rotation; the worker remains authoritative after meshing.
- Independent project tabs preserve each document’s edits, file association, recovery and run/result ownership, with a 32-document session limit.
- Bounded interactive 2D profile drafting with rectangles, polylines, circular arcs, radius edits, grid snapping and circular holes, followed by validated Apply or Revert.
- Optional BYOK documentation/study chat with native Gemini, OpenAI Responses, Anthropic Messages and compatible/local Ollama text streaming, model discovery, OS credential storage, deliberate-send consent and bounded local conversation history.
- Opt-in local read-only MCP inspection of help, active project and run summaries, with native tool permissions, revocation, expiring session consent and an access audit.
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
