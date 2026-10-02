import { Plus, Trash2 } from 'lucide-react';
import type { Profile, Point2 } from '../../domain/contracts/project.generated';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';
import { freshBoundaryId, setArcRadius } from '../../domain/project/profile';
import type { ProjectInspectorModel } from './model';

export default function ProfileEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const { project, factor, edit } = workbench;
  const profile = project.geometry.profile;
  if (!profile) return null;
  const change = (mutation: (next: Profile) => void) =>
    edit((next) => {
      if (next.geometry.profile) mutation(next.geometry.profile);
    });
  const uniqueId = (prefix: string) => freshBoundaryId(project, prefix);
  const pointEditor = (
    label: string,
    point: Point2,
    update: (value: number, axis: number) => void,
  ) => (
    <div className="form-grid">
      {(['X', 'Y'] as const).map((axis, index) => (
        <NumberInput
          key={axis}
          label={`${label} ${axis}`}
          value={point[index] * factor}
          unit={project.displayUnits}
          onChange={(value) => update(value / factor, index)}
        />
      ))}
    </div>
  );
  return (
    <>
      <Group
        title="Outer line / arc loop"
        action={
          <button
            className="icon-button"
            aria-label="Add outer edge"
            disabled={profile.outer.length >= 64}
            onClick={() =>
              change((next) => {
                const start = [...next.outer.at(-1)!.end] as Point2;
                next.outer.push({
                  id: uniqueId('edge'),
                  name: 'New edge',
                  kind: 'line',
                  start,
                  end: [start[0] + project.geometry.length / 4, start[1]],
                });
              })
            }
          >
            <Plus size={16} />
          </button>
        }
      >
        <p className="property-hint">
          One counterclockwise outer loop, with exact lines and circular arcs. Match adjacent
          endpoints. IDs persist through remeshing; changing or deleting an ID requires explicit
          assignment repair.
        </p>
        {profile.outer.map((segment, index) => (
          <details key={index}>
            <summary>
              {index + 1}. {segment.name} · {segment.kind} <code>{segment.id}</code>
            </summary>
            <label className="field-label">
              <span>Boundary name</span>
              <input
                value={segment.name}
                maxLength={200}
                onChange={(event) =>
                  change((next) => {
                    next.outer[index].name = event.target.value;
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>Persistent boundary ID</span>
              <input
                value={segment.id}
                maxLength={100}
                onChange={(event) =>
                  change((next) => {
                    next.outer[index].id = event.target.value;
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>Exact curve</span>
              <select
                value={segment.kind}
                onChange={(event) =>
                  change((next) => {
                    const edge = next.outer[index];
                    edge.kind = event.target.value as 'line' | 'arc';
                    if (edge.kind === 'arc') {
                      edge.center ??= [
                        (edge.start[0] + edge.end[0]) / 2,
                        (edge.start[1] + edge.end[1]) / 2,
                      ];
                      edge.clockwise ??= false;
                    } else {
                      delete edge.center;
                      delete edge.clockwise;
                    }
                  })
                }
              >
                <option value="line">Straight line</option>
                <option value="arc">Circular arc</option>
              </select>
            </label>
            {pointEditor('Start', segment.start, (value, axis) =>
              change((next) => {
                next.outer[index].start[axis] = value;
              }),
            )}
            {pointEditor('End', segment.end, (value, axis) =>
              change((next) => {
                next.outer[index].end[axis] = value;
              }),
            )}
            {segment.kind === 'arc' && segment.center && (
              <>
                <NumberInput
                  label="Arc radius"
                  positive
                  maximum={1000 * factor}
                  value={
                    Math.hypot(
                      segment.start[0] - segment.center[0],
                      segment.start[1] - segment.center[1],
                    ) * factor
                  }
                  unit={project.displayUnits}
                  onChange={(value) => change((next) => setArcRadius(next, index, value / factor))}
                />
                <p className="property-hint">
                  Radius changes move this arc and matching neighboring endpoints. Review adjacent
                  arcs and independently update any traction radius in Loads.
                </p>
                {pointEditor('Center', segment.center, (value, axis) =>
                  change((next) => {
                    next.outer[index].center![axis] = value;
                  }),
                )}
                <label className="field-label">
                  <span>Arc traversal</span>
                  <select
                    value={segment.clockwise ? 'clockwise' : 'counterclockwise'}
                    onChange={(event) =>
                      change((next) => {
                        next.outer[index].clockwise = event.target.value === 'clockwise';
                      })
                    }
                  >
                    <option value="counterclockwise">Counterclockwise</option>
                    <option value="clockwise">Clockwise</option>
                  </select>
                </label>
              </>
            )}
            <button
              className="danger full"
              disabled={profile.outer.length <= 2}
              onClick={() =>
                change((next) => {
                  next.outer.splice(index, 1);
                })
              }
            >
              <Trash2 size={14} />
              Delete edge
            </button>
          </details>
        ))}
      </Group>
      <Group
        title="Circular inner holes"
        action={
          <button
            className="icon-button"
            aria-label="Add circular hole"
            disabled={profile.holes.length >= 16}
            onClick={() =>
              change((next) => {
                const points = next.outer.map((segment) => segment.start);
                const xs = points.map((point) => point[0]),
                  ys = points.map((point) => point[1]);
                next.holes.push({
                  id: uniqueId('hole'),
                  name: 'Circular hole',
                  center: [
                    (Math.min(...xs) + Math.max(...xs)) / 2,
                    (Math.min(...ys) + Math.max(...ys)) / 2,
                  ],
                  radius:
                    Math.min(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) /
                    12,
                });
              })
            }
          >
            <Plus size={16} />
          </button>
        }
      >
        {profile.holes.length === 0 && (
          <p className="property-hint">
            No enclosed circular holes. An outer arc may form an open cutout.
          </p>
        )}
        {profile.holes.map((hole, index) => (
          <details key={index}>
            <summary>
              {hole.name} <code>{hole.id}</code>
            </summary>
            <label className="field-label">
              <span>Boundary name</span>
              <input
                value={hole.name}
                maxLength={200}
                onChange={(event) =>
                  change((next) => {
                    next.holes[index].name = event.target.value;
                  })
                }
              />
            </label>
            <label className="field-label">
              <span>Persistent boundary ID</span>
              <input
                value={hole.id}
                maxLength={100}
                onChange={(event) =>
                  change((next) => {
                    next.holes[index].id = event.target.value;
                  })
                }
              />
            </label>
            {pointEditor('Center', hole.center, (value, axis) =>
              change((next) => {
                next.holes[index].center[axis] = value;
              }),
            )}
            <NumberInput
              label="Radius"
              value={hole.radius * factor}
              unit={project.displayUnits}
              onChange={(value) =>
                change((next) => {
                  next.holes[index].radius = value / factor;
                })
              }
            />
            <button
              className="danger full"
              onClick={() =>
                change((next) => {
                  next.holes.splice(index, 1);
                })
              }
            >
              <Trash2 size={14} />
              Delete hole
            </button>
          </details>
        ))}
      </Group>
    </>
  );
}
