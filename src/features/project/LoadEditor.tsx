import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import type { Load } from '../../domain/contracts/types';
import { assignedRegions } from '../../domain/project/regions';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function LoadEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const { is2D, addLoad, load, editLoad, boundaryEditor, setError, edit, setLoadId } = workbench;
  return (
    <>
      <Group
        title={is2D ? 'Boundary edge loads' : 'Surface loads'}
        action={
          <button className="icon-button" aria-label="Add load" onClick={addLoad}>
            <Plus size={16} />
          </button>
        }
      >
        {!load ? (
          <div className="empty-state">
            <ArrowUpRight size={25} />
            <p>Select a load in the model tree or create one on the selected boundaries.</p>
            <button className="secondary full" onClick={addLoad}>
              Add load
            </button>
          </div>
        ) : (
          <>
            <label className="field-label">
              <span>Name</span>
              <input
                value={load.name}
                maxLength={200}
                onChange={(event) =>
                  editLoad((item) => {
                    item.name = event.target.value;
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>Type</span>
              <select
                value={load.kind}
                onChange={(event) =>
                  editLoad((item) => {
                    item.kind = event.target.value as Load['kind'];
                  })
                }
              >
                <option value="force">Distributed total force</option>
                <option value="pressure">Boundary pressure</option>
              </select>
            </label>
            {load.kind === 'force' ? (
              <>
                {(is2D ? (['X', 'Y'] as const) : (['X', 'Y', 'Z'] as const)).map((axis, index) => (
                  <NumberInput
                    key={axis}
                    label={`Force ${axis}`}
                    value={load.vector[index]}
                    unit="N"
                    onChange={(value) =>
                      editLoad((item) => {
                        item.vector[index] = value;
                      })
                    }
                  />
                ))}
                <p className="property-hint">
                  {is2D
                    ? 'One total vector force across assigned edges, distributed by edge length × physical thickness in the global frame.'
                    : 'One total vector force across all assigned faces, distributed by surface area in the global frame.'}
                </p>
              </>
            ) : (
              <>
                <NumberInput
                  label="Pressure"
                  value={load.pressure}
                  unit="Pa"
                  onChange={(value) =>
                    editLoad((item) => {
                      item.pressure = value;
                    })
                  }
                />
                <p className="property-hint">
                  Positive pressure acts inward, opposite the outward solid boundary normal.
                  Negative pressure acts outward.
                </p>
              </>
            )}
          </>
        )}
      </Group>
      {load && (
        <>
          <Group title="Assigned boundaries">
            {boundaryEditor(load, (value) => {
              if (!value.length) {
                setError('A load needs at least one boundary.');
                return;
              }
              editLoad((item) => {
                item.regions = assignedRegions(value, 'x1');
              });
            })}
          </Group>
          <button
            className="danger full"
            onClick={() => {
              edit((next) => {
                next.study.loads = next.study.loads.filter((item) => item.id !== load.id);
              });
              setLoadId(null);
            }}
          >
            <Trash2 size={14} />
            Delete load
          </button>
        </>
      )}
    </>
  );
}
