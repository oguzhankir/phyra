import { ArrowUpRight, Plus, Trash2 } from 'lucide-react';
import type { Load } from '../../domain/contracts/types';
import { assignedRegions } from '../../domain/project/regions';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
import BoundaryAssignments from './BoundaryAssignments';
export default function LoadEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    is2D,
    project,
    factor,
    addLoad,
    load,
    editLoad,
    regions,
    selected,
    setError,
    edit,
    setLoadId,
  } = workbench;
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
                    if (item.kind === 'traction')
                      item.traction ??= {
                        kind: 'affine',
                        xx: [0, 0, 0],
                        yy: [0, 0, 0],
                        xy: [0, 0, 0],
                      };
                    else delete item.traction;
                  })
                }
              >
                <option value="force">Distributed total force</option>
                <option value="pressure">Boundary pressure</option>
                {is2D && <option value="traction">Spatial vector traction</option>}
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
            ) : load.kind === 'pressure' ? (
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
            ) : (
              <>
                <label className="field-label">
                  <span>Stress field defining traction</span>
                  <select
                    value={load.traction?.kind ?? 'affine'}
                    onChange={(event) =>
                      editLoad((item) => {
                        item.traction =
                          event.target.value === 'kirsch'
                            ? {
                                kind: 'kirsch',
                                radius: project.geometry.radius,
                                center: [0, 0],
                                tension: 1,
                              }
                            : { kind: 'affine', xx: [0, 0, 0], yy: [0, 0, 0], xy: [0, 0, 0] };
                      })
                    }
                  >
                    <option value="affine">Affine symmetric stress</option>
                    <option value="kirsch">Kirsch circular-hole stress</option>
                  </select>
                </label>
                {load.traction?.kind === 'affine' ? (
                  <>
                    {(['xx', 'yy', 'xy'] as const).map((component) => (
                      <div key={component}>
                        <strong>σ{component} = a + bX + cY</strong>
                        {(['a', 'b', 'c'] as const).map((coefficient, index) => (
                          <NumberInput
                            key={coefficient}
                            label={`σ${component} · ${coefficient}`}
                            value={
                              load.traction?.kind === 'affine' ? load.traction[component][index] : 0
                            }
                            unit={index === 0 ? 'Pa' : 'Pa/m'}
                            onChange={(value) =>
                              editLoad((item) => {
                                if (item.traction?.kind === 'affine')
                                  item.traction[component][index] = value;
                              })
                            }
                          />
                        ))}
                      </div>
                    ))}
                  </>
                ) : (
                  load.traction?.kind === 'kirsch' && (
                    <>
                      <NumberInput
                        label="Hole radius"
                        value={load.traction.radius * factor}
                        unit={project.displayUnits}
                        onChange={(value) =>
                          editLoad((item) => {
                            if (item.traction?.kind === 'kirsch')
                              item.traction.radius = value / factor;
                          })
                        }
                      />
                      {(['X', 'Y'] as const).map((axis, index) => (
                        <NumberInput
                          key={axis}
                          label={`Center ${axis}`}
                          value={
                            load.traction?.kind === 'kirsch'
                              ? load.traction.center[index] * factor
                              : 0
                          }
                          unit={project.displayUnits}
                          onChange={(value) =>
                            editLoad((item) => {
                              if (item.traction?.kind === 'kirsch')
                                item.traction.center[index] = value / factor;
                            })
                          }
                        />
                      ))}
                      <NumberInput
                        label="Remote X tension"
                        value={load.traction.tension}
                        unit="Pa"
                        onChange={(value) =>
                          editLoad((item) => {
                            if (item.traction?.kind === 'kirsch') item.traction.tension = value;
                          })
                        }
                      />
                    </>
                  )
                )}
                <p className="property-hint">
                  Vector traction is t = σ(X,Y)n at boundary integration points, using the outward
                  material normal. Coordinates and radii use m internally; positive remote tension
                  is tensile. Physical thickness converts traction into force. Kirsch analytical
                  diagnostics require a matching circular cutout and the intended exterior domain;
                  changing geometry or assignments may remove the reference comparison.
                </p>
                <p className="property-hint">
                  Spatial traction requires FEM. Select FEM before running if a saved study selected
                  PINN.
                </p>
              </>
            )}
          </>
        )}
      </Group>
      {load && (
        <>
          <Group title="Assigned boundaries">
            <BoundaryAssignments
              assigned={load.regions}
              regions={regions}
              selected={selected}
              onChange={(value) => {
                if (!value.length) {
                  setError('A load needs at least one boundary.');
                  return;
                }
                editLoad((item) => {
                  item.regions = assignedRegions(value, 'x1');
                });
              }}
            />
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
