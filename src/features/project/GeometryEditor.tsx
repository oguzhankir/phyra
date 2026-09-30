import type { Project } from '../../domain/contracts/types';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function GeometryEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    is2D,
    project,
    invalidDraftsRef,
    setError,
    edit,
    setSelected,
    setConstraintId,
    setLoadId,
    factor,
    regions,
    selected,
    selectRegion,
    setNotice,
  } = workbench;
  return (
    <>
      <Group title={is2D ? 'Rectangular domain' : 'Solid definition'}>
        <label className="field-label">
          <span>{is2D ? 'Domain' : 'Primitive'}</span>
          <select
            value={project.geometry.kind}
            onChange={(event) => {
              if (invalidDraftsRef.current.size) {
                setError('Complete or revert the numeric input before changing primitive.');
                return;
              }
              const kind = event.target.value as Project['geometry']['kind'];
              if (kind === project.geometry.kind) return;
              const count = project.study.constraints.length + project.study.loads.length;
              edit((next) => {
                next.geometry.kind = kind;
                next.study.constraints = [];
                next.study.loads = [];
              });
              setSelected([]);
              setConstraintId(null);
              setLoadId(null);
              setNotice(
                `Primitive changed · ${count} boundary assignments cleared. Named sets require repair; Undo restores the definition.`,
              );
            }}
          >
            <option value="box">{is2D ? 'Rectangular domain' : 'Rectangular solid'}</option>
            {!is2D && (
              <>
                <option value="cylinder">Cylinder · X axis</option>
                <option value="bracket">L bracket · XY plane</option>
              </>
            )}
          </select>
        </label>
        {(
          [
            'length',
            ...(is2D
              ? ['width']
              : project.geometry.kind === 'cylinder'
                ? ['radius']
                : [
                    'width',
                    'height',
                    ...(project.geometry.kind === 'bracket' ? ['thickness'] : []),
                  ]),
          ] as (keyof Omit<Project['geometry'], 'kind'>)[]
        ).map((dimension) => (
          <NumberInput
            key={dimension}
            label={dimension.charAt(0).toUpperCase() + dimension.slice(1)}
            value={project.geometry[dimension] * factor}
            unit={project.displayUnits}
            onChange={(value) =>
              edit((next) => {
                next.geometry[dimension] = value / factor;
              })
            }
          />
        ))}
      </Group>
      <Group title="Display units">
        <div className="segmented">
          {(['mm', 'm'] as const).map((unit) => (
            <button
              key={unit}
              className={project.displayUnits === unit ? 'active' : ''}
              onClick={() =>
                edit((next) => {
                  next.displayUnits = unit;
                }, false)
              }
            >
              {unit === 'mm' ? 'Millimeters' : 'Meters'}
            </button>
          ))}
        </div>
        <p className="property-hint">
          Inputs and outputs convert for display. Authoritative geometry and solver fields use SI.
        </p>
      </Group>
      <Group title="Boundary regions">
        <div className="boundary-list">
          {regions.map((region) => (
            <label key={region.id}>
              <input
                type="checkbox"
                checked={selected.includes(region.id)}
                onChange={() => selectRegion(region.id)}
              />
              <span>{region.name}</span>
              <code>{region.id}</code>
            </label>
          ))}
        </div>
      </Group>
      <p className="property-hint">
        {is2D
          ? 'Rectangle spans X = 0 to length and Y = 0 to width. Physical thickness belongs to the study.'
          : project.geometry.kind === 'cylinder'
            ? 'Cylinder spans X = 0 to length, centered on Y = Z = 0.'
            : 'Geometry starts at the global origin. Brackets extend in X and Y, with height in Z.'}{' '}
        Changing primitive clears its boundary assignments.
      </p>
    </>
  );
}
