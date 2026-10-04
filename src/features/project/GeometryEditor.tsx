import type { Project } from '../../domain/contracts/types';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';

import type { ProjectInspectorModel } from './model';
import ProfileEditor from './ProfileEditor';
import { changeGeometryKind } from '../../domain/project/profile';
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
      <Group title={is2D ? 'Plane domain' : 'Solid definition'}>
        <label className="field-label">
          <span>{is2D ? 'Domain' : 'Primitive'}</span>
          <Select
            aria-label={is2D ? 'Domain' : 'Primitive'}
            value={project.geometry.kind}
            options={[
              { value: 'box', label: is2D ? 'Rectangular domain' : 'Rectangular solid' },
              ...(is2D
                ? [{ value: 'profile', label: 'Line / arc profile with circular holes' }]
                : [
                    { value: 'cylinder', label: 'Cylinder · X axis' },
                    { value: 'bracket', label: 'L bracket · XY plane' },
                  ]),
            ]}
            onChange={(value) => {
              if (invalidDraftsRef.current.size) {
                setError('Complete or revert the numeric input before changing primitive.');
                return;
              }
              const kind = value as Project['geometry']['kind'];
              if (kind === project.geometry.kind) return;
              const count = project.study.constraints.length + project.study.loads.length;
              edit((next) => {
                changeGeometryKind(next, kind);
              });
              setSelected([]);
              setConstraintId(null);
              setLoadId(null);
              setNotice(
                `Primitive changed · ${count} boundary assignments cleared. Named sets require repair; Undo restores the definition.`,
              );
            }}
          />
        </label>
        {project.geometry.kind !== 'profile' &&
          (
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
            ] as ('length' | 'width' | 'height' | 'radius' | 'thickness')[]
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
        {is2D && project.geometry.kind === 'box' && (
          <button
            type="button"
            className="full"
            onClick={() => {
              if (invalidDraftsRef.current.size) {
                setError('Complete or revert the numeric input before opening the sketch.');
                return;
              }
              edit((next) => {
                changeGeometryKind(next, 'profile');
                next.geometry.profile!.holes = [];
              });
              setSelected([]);
              setNotice(
                'Rectangle opened as an exact plane sketch. Existing outer boundary IDs are preserved.',
              );
            }}
          >
            Edit rectangle as sketch
          </button>
        )}
      </Group>
      {project.geometry.kind === 'profile' && <ProfileEditor workbench={workbench} />}
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
        {project.geometry.kind === 'profile'
          ? 'Profile coordinates use global X/Y. Physical thickness belongs to the study. Circular arcs remain exact in the mesher; the preview samples them for display.'
          : is2D
            ? 'Rectangle spans X = 0 to length and Y = 0 to width. Physical thickness belongs to the study.'
            : project.geometry.kind === 'cylinder'
              ? 'Cylinder spans X = 0 to length, centered on Y = Z = 0.'
              : 'Geometry starts at the global origin. Brackets extend in X and Y, with height in Z.'}{' '}
        Changing or deleting boundary IDs leaves assignments requiring explicit repair. Incompatible
        primitive changes retain condition values but clear boundary selections.
      </p>
    </>
  );
}
