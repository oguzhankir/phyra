# Changelog

Notable changes to Phyra are recorded here, following [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Entries describe changes that affect users; contribution rules are in [CONTRIBUTING.md](CONTRIBUTING.md#changelog-and-pull-requests).

## Unreleased

### Added

- Home screen for creating a named 2D or 3D project, opening a local project and starting from an editable example.
- Home and a closable project tab that preserve the current project while moving between the start screen and workbench. Close with the tab’s ×, File → Close project or Ctrl/⌘ W.
- Desktop auto-save updates an associated project file after a 1.5-second editing pause, with an on/off control and visible pending, paused, saving and failure states. A first explicit Save chooses the file location; recovery copies remain separate.
- A preparation checklist checks study, geometry, material, supports, loads, mesh settings and method eligibility before execution. Boundary restraint checks account for rigid translation and rotation; the worker remains authoritative after meshing.

### Changed

- A compact File/Edit/View/Help header stays available on Home and in the workbench. Examples live on Home; New project uses the same name and analysis-type dialog from Home, File or Ctrl/⌘ N.
- File location and save state appear together in the project workspace. Home shows the project open in this session, and switching tabs keeps it open.
- Support and load summaries stay visible in the model tree, and successful saves show a short confirmation before returning to the document state.

### Fixed

- Closing or replacing a dirty project offers Save, Discard and Cancel, waits for an active automatic write and preserves the project when saving fails or is cancelled. A saved project can close directly.

## Initial baseline — 0.2.0 development

This is the starting snapshot for the changelog, not a reconstructed release history. The repository identifies 0.2.0 as a development build; no release date is assigned here.

### Added

- Local linear static elasticity workflows for 3D solids and 2D plane-stress rectangles and profiles, with editable geometry, material, supports, loads, meshing and FEM results.
- Experimental rectangular plane-stress PINN training with measured losses, device/precision metadata and comparison against FEM at matching locations.
- Field inspection, physical diagnostics, SI CSV export, viewport selection and undeformed distance measurement.
- Versioned `.phyra` project archives, bounded definition undo/redo, stale-result rejection, owned cancellable workers and definition-only recovery copies.
- Editable SI examples, validated CPU reference studies and offline engineering help.
