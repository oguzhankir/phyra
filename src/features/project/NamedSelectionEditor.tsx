import { isCadSolidProject } from '../../domain/project/cadSolid';
import { Bookmark, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { assignedRegions } from '../../domain/project/regions';
import { selectionIsCompatible, selectedBoundaries } from '../../domain/project/namedSelections';
import { Group } from '../../shared/forms/PropertyControls';
import type { ProjectInspectorModel } from './model';

export default function NamedSelectionEditor({
  workbench: w,
}: {
  workbench: ProjectInspectorModel;
}) {
  const item = w.namedSelection;
  const compatible = item && selectionIsCompatible(w.project, item);
  const chosen = selectedBoundaries(w.project, w.selected);
  return (
    <>
      <Group
        title="Boundary set"
        action={
          <button
            className="icon-button"
            aria-label="Create named selection"
            disabled={!chosen.length || w.project.namedSelections.length >= 100}
            onClick={w.addNamedSelection}
          >
            <Plus size={15} />
          </button>
        }
      >
        {!item ? (
          <div className="empty-state">
            <Bookmark size={24} />
            <p>
              Select a saved boundary set in the model tree, or select boundaries in the viewport to
              create one.
            </p>
            <button
              className="secondary full"
              disabled={!chosen.length || w.project.namedSelections.length >= 100}
              onClick={w.addNamedSelection}
            >
              Save selected boundaries ({chosen.length})
            </button>
          </div>
        ) : (
          <>
            <label className="field-label">
              <span>Name</span>
              <input
                maxLength={200}
                value={item.name}
                onChange={(event) =>
                  w.editNamedSelection((next) => {
                    next.name = event.target.value;
                  })
                }
              />
            </label>
            <div className="selection-definition">
              <span>
                {item.dimension.toUpperCase()} · {item.geometryKind}
              </span>
              <strong>
                {item.regions.length} {item.regions.length === 1 ? 'boundary' : 'boundaries'}
              </strong>
            </div>
            {!compatible && (
              <div className="selection-repair" role="status">
                <strong>Boundary set needs repair</strong>
                <p>
                  The source geometry or study dimension changed. Select the intended boundaries on
                  the current geometry and replace this set explicitly.
                </p>
              </div>
            )}
            <div className="saved-boundaries">
              {item.regions.map((region) => (
                <code key={region}>{region}</code>
              ))}
            </div>
            <button
              className="secondary full"
              disabled={!compatible}
              onClick={() => w.useNamedSelection(item)}
            >
              Select these boundaries
            </button>
            <button
              className="secondary full"
              disabled={!chosen.length}
              onClick={() => {
                w.editNamedSelection((next) => {
                  next.geometryKind = w.project.geometry.kind;
                  next.dimension = w.project.study.dimension;
                  if (isCadSolidProject(w.project))
                    next.geometryFingerprint = w.project.study.domain.geometryFingerprint;
                  else delete next.geometryFingerprint;
                  next.regions = assignedRegions(chosen, 'x0');
                });
                w.setNotice(
                  'Boundary set updated · existing supports and loads retain their copied boundaries',
                );
              }}
            >
              <RefreshCw size={14} /> Replace with viewport selection ({chosen.length})
            </button>
          </>
        )}
      </Group>
      <Group title="Assignment behavior">
        <p className="property-hint">
          Named selections store reusable boundary IDs for their geometry type and study dimension.
          Exact CAD sets also retain their source fingerprint and need explicit repair after the
          source changes. Profile segment IDs stay compatible when the edited profile retains them.
        </p>
        <p className="property-hint">
          Copy a set from the support or load editor. Changing or deleting the set later does not
          change those assignments. This version does not provide associative CAD selections.
        </p>
      </Group>
      {item && (
        <button
          className="danger full"
          onClick={() => {
            w.edit((next) => {
              next.namedSelections = next.namedSelections.filter(
                (candidate) => candidate.id !== item.id,
              );
            }, false);
            w.setNamedSelectionId(null);
          }}
        >
          <Trash2 size={14} /> Delete boundary set
        </button>
      )}
    </>
  );
}
