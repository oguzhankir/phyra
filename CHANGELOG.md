# Changelog

Notable changes to Phyra are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe changes that affect users; contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-pull-requests).

## Unreleased

### Added

- Explicit provider disconnection removes its saved key and active model selection while preserving local conversations and projects. Saved keys remain available across application restarts.
- macOS packaging accepts an installed `APPLE_SIGNING_IDENTITY`, signs embedded native code before its containing bundle, and refuses an unavailable identity instead of silently substituting ad hoc signing.
- Home screen for creating a named 2D or 3D project, opening a local project and starting from an editable example.
- Home and a closable project tab that preserve the current project while moving between the start screen and workbench. Close with the tab’s ×, File → Close project or Ctrl/⌘ W.
- Desktop auto-save updates an associated project file after a 1.5-second editing pause, with an on/off control and visible pending, paused, saving and failure states. A first explicit Save chooses the file location; recovery copies remain separate.
- A preparation checklist checks study, geometry, material, supports, loads, mesh settings and method eligibility before execution. Boundary restraint checks account for rigid translation and rotation; the worker remains authoritative after meshing.
- Independent project tabs preserve each document’s edits, file association, recovery and run/result ownership, with a 32-document session limit.
- Bounded interactive 2D profile drafting with rectangles, polylines, circular arcs, radius edits, grid snapping and circular holes, followed by validated Apply or Revert.
- Optional BYOK documentation/study chat with native Gemini, OpenAI Responses, Anthropic Messages and compatible/local Ollama text streaming, model discovery, OS credential storage, inspectable context consent and bounded local conversation history.
- Opt-in local read-only MCP inspection of help, active project and run summaries, with native scopes, revocation, expiring session consent and an access audit.
- In-product mathematical formulations for 3D/plane-stress FEM, scaled PINN residuals/losses and Kirsch reference assumptions, with primary references and source links.

### Changed

- A compact File/Edit/View/Help header stays available on Home and in the workbench. Examples live on Home; New project uses the same name and analysis-type dialog from Home, File or Ctrl/⌘ N.
- Save identifies its associated file through a tooltip. Pending and failed writes remain visible; successful writes show a brief confirmation. Home lists open documents, and switching tabs keeps them open.
- Support and load summaries stay visible in the model tree, and successful saves show a short confirmation before returning to the document state.

### Fixed

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
