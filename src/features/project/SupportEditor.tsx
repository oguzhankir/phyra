import { LockKeyhole, Plus, Trash2 } from 'lucide-react';
import { assignedRegions } from '../../domain/project/regions';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function SupportEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    addConstraint,
    constraint,
    editConstraint,
    is2D,
    factor,
    project,
    boundaryEditor,
    setError,
    edit,
    setConstraintId,
  } = workbench;
  return (
    <>
      <Group
        title="Displacement supports"
        action={
          <button className="icon-button" aria-label="Add support" onClick={addConstraint}>
            <Plus size={16} />
          </button>
        }
      >
        {!constraint ? (
          <div className="empty-state">
            <LockKeyhole size={24} />
            <p>Select a support in the model tree or create one on the selected boundaries.</p>
            <button className="secondary full" onClick={addConstraint}>
              Add support
            </button>
          </div>
        ) : (
          <>
            <label className="field-label">
              <span>Name</span>
              <input
                value={constraint.name}
                maxLength={200}
                onChange={(event) =>
                  editConstraint((item) => {
                    item.name = event.target.value;
                  })
                }
              />
            </label>
            <div className="segmented">
              <button
                className={
                  constraint.components.slice(0, is2D ? 2 : 3).every((value) => value === 0)
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  editConstraint((item) => {
                    item.components = is2D ? [0, 0, null] : [0, 0, 0];
                  })
                }
              >
                Fixed
              </button>
              <button
                className={
                  constraint.components.slice(0, is2D ? 2 : 3).some((value) => value !== 0)
                    ? 'active'
                    : ''
                }
                onClick={() =>
                  editConstraint((item) => {
                    item.components = [0, null, null];
                  })
                }
              >
                Components
              </button>
            </div>
            <div className="component-editor">
              {(is2D ? (['X', 'Y'] as const) : (['X', 'Y', 'Z'] as const)).map((axis, index) => (
                <div key={axis}>
                  <label className="component-check">
                    <input
                      type="checkbox"
                      checked={constraint.components[index] !== null}
                      onChange={(event) =>
                        editConstraint((item) => {
                          item.components[index] = event.target.checked ? 0 : null;
                        })
                      }
                    />
                    <span>U{axis.toLowerCase()}</span>
                  </label>
                  {constraint.components[index] !== null ? (
                    <NumberInput
                      label={`Prescribed ${axis}`}
                      value={constraint.components[index]! * factor}
                      unit={project.displayUnits}
                      onChange={(value) =>
                        editConstraint((item) => {
                          item.components[index] = value / factor;
                        })
                      }
                    />
                  ) : (
                    <span className="free-component">Free</span>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </Group>
      {constraint && (
        <>
          <Group title="Assigned boundaries">
            {boundaryEditor(constraint, (value) => {
              if (!value.length) {
                setError('A support needs at least one boundary.');
                return;
              }
              editConstraint((item) => {
                item.regions = assignedRegions(value, 'x0');
              });
            })}
          </Group>
          <button
            className="danger full"
            onClick={() => {
              edit((next) => {
                next.study.constraints = next.study.constraints.filter(
                  (item) => item.id !== constraint.id,
                );
              });
              setConstraintId(null);
            }}
          >
            <Trash2 size={14} />
            Delete support
          </button>
        </>
      )}
      <p className="property-hint">
        Prescribed values use the global axes. An unchecked component is free. Conflicting
        assignments and rigid body freedom are reported by the engine.
      </p>
    </>
  );
}
