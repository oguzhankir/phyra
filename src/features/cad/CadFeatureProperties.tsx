import type { ReactNode } from 'react';
import { Trash2 } from 'lucide-react';
import type {
  CadFeature,
  CadGeometry,
  CadSketchFeature,
} from '../../domain/contracts/project.generated';
import { lengthFactor } from '../../domain/units';
import { NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';
import CadAdvancedFields from './CadAdvancedFields';
import { bodyInputs, pathIssue } from './advancedFeatures';
import { sketchReadiness } from './sketchInteractions';

export interface CadFeaturePropertiesProps {
  feature: CadFeature;
  geometry: CadGeometry;
  earlier: CadFeature[];
  sketches: CadSketchFeature[];
  units: 'm' | 'mm';
  dimension: '2d' | '3d';
  locked: boolean;
  creating?: boolean;
  draftBlocked: boolean;
  update: (change: (next: CadFeature) => void) => void;
  dimensionInput: (label: string, value: number, field: string, signed?: boolean) => ReactNode;
  onEditSketch: (id: string) => void;
  onDuplicateSection: () => void;
  onPlaceComponent: (id: string) => void;
  onDelete: () => void;
}

/** Feature forms consume definition callbacks; document and command ownership stay outside. */
export default function CadFeatureProperties({
  feature,
  geometry,
  earlier,
  sketches,
  units,
  dimension,
  locked,
  creating = false,
  draftBlocked,
  update,
  dimensionInput,
  onEditSketch,
  onDuplicateSection,
  onPlaceComponent,
  onDelete,
}: CadFeaturePropertiesProps) {
  const factor = lengthFactor(units);
  const shapes = bodyInputs(geometry.features);
  return (
    <fieldset disabled={locked}>
      <label className="field-label">
        <span>Feature name</span>
        <input
          value={feature.name}
          maxLength={200}
          onChange={(e) =>
            update((next) => {
              next.name = e.target.value;
            })
          }
        />
      </label>
      {feature.kind === 'box' && (
        <>
          {dimensionInput('Length', feature.length, 'length')}
          {dimensionInput('Width', feature.width, 'width')}
          {dimensionInput('Height', feature.height, 'height')}
        </>
      )}
      {feature.kind === 'cylinder' && (
        <>
          {dimensionInput('Length · X axis', feature.length, 'length')}
          {dimensionInput('Radius', feature.radius, 'radius')}
        </>
      )}
      {(feature.kind === 'extrude' || feature.kind === 'revolve') && (
        <Select
          aria-label="Source sketch"
          value={feature.sketchId}
          options={sketches.map((item) => ({ value: item.id, label: item.name }))}
          onChange={(id) =>
            update((next) => {
              if (next.kind === 'extrude' || next.kind === 'revolve') next.sketchId = id;
            })
          }
        />
      )}
      {feature.kind === 'extrude' && dimensionInput('Distance', feature.distance, 'distance', true)}
      {feature.kind === 'revolve' && (
        <>
          <NumberInput
            commitMode="finish"
            label="Angle"
            value={(feature.angle * 180) / Math.PI}
            unit="°"
            positive
            maximum={360}
            onChange={(n) =>
              update((next) => {
                if (next.kind === 'revolve') next.angle = (n * Math.PI) / 180;
              })
            }
          />
          {([0, 1, 2] as const).map((axis) => (
            <div key={axis}>
              {dimensionInput(
                `Axis origin ${'XYZ'[axis]}`,
                feature.axisOrigin[axis],
                `axisOrigin${axis}`,
                true,
              )}
              <NumberInput
                commitMode="finish"
                label={`Axis direction ${'XYZ'[axis]}`}
                value={feature.axisDirection[axis]}
                onChange={(n) =>
                  update((next) => {
                    if (next.kind === 'revolve') next.axisDirection[axis] = n;
                  })
                }
              />
            </div>
          ))}
        </>
      )}
      {feature.kind === 'boolean' && (
        <>
          <Select
            aria-label="Boolean operation"
            value={feature.operation}
            options={[
              { value: 'union', label: 'Union' },
              { value: 'cut', label: 'Cut' },
              { value: 'intersect', label: 'Intersection' },
            ]}
            onChange={(value) =>
              update((next) => {
                if (next.kind === 'boolean') next.operation = value as typeof next.operation;
              })
            }
          />
          {(['leftId', 'rightId'] as const).map((field) => (
            <Select
              key={field}
              aria-label={field === 'leftId' ? 'Base solid' : 'Tool solid'}
              value={feature[field]}
              options={shapes
                .filter(
                  (item) => geometry!.features.indexOf(item) < geometry!.features.indexOf(feature),
                )
                .map((item) => ({ value: item.id, label: item.name }))}
              onChange={(id) =>
                update((next) => {
                  if (next.kind === 'boolean') next[field] = id;
                })
              }
            />
          ))}
        </>
      )}
      {feature.kind === 'import-step' && (
        <>
          <p className="cad-hint">
            STEP units are read by the exact kernel and converted to SI. The scale below is an
            additional user transformation.
          </p>
          <NumberInput
            commitMode="finish"
            label="Additional scale factor"
            value={feature.scaleFactor}
            positive
            onChange={(n) =>
              update((next) => {
                if (next.kind === 'import-step') next.scaleFactor = n;
              })
            }
          />
        </>
      )}
      {feature.kind === 'fillet' && dimensionInput('Radius', feature.radius, 'radius')}
      {feature.kind === 'chamfer' && dimensionInput('Distance', feature.distance, 'distance')}
      {feature.kind === 'sketch' && (
        <>
          <p className="cad-hint">
            {feature.plane.toUpperCase()} plane · {feature.sketch.entities.length} entities ·{' '}
            {feature.sketch.constraints.length} constraints
          </p>
          <label className="field-label">
            <span>Sketch purpose</span>
            <Select
              aria-label="Sketch purpose"
              value={feature.purpose ?? 'profile'}
              options={[
                { value: 'profile', label: 'Closed profile' },
                { value: 'path', label: 'Sweep path' },
              ]}
              onChange={(value) =>
                update((next) => {
                  if (next.kind === 'sketch') {
                    if (value === 'path') next.purpose = 'path';
                    else delete next.purpose;
                  }
                })
              }
            />
          </label>
          {feature.purpose === 'path' ? (
            <p className="cad-hint">
              {pathIssue(feature.sketch) ??
                'Path connected. Choose Sweep and pair it with a closed profile.'}
            </p>
          ) : (
            sketchReadiness(feature.sketch).issue && (
              <p className="cad-hint">
                {sketchReadiness(feature.sketch).issue} The sketch remains saved and editable.
              </p>
            )
          )}
          <button className="primary" onClick={() => onEditSketch(feature.id)}>
            Edit sketch
          </button>
          <button
            className="secondary"
            disabled={
              dimension === '2d' ||
              feature.purpose === 'path' ||
              !!sketchReadiness(feature.sketch).issue ||
              draftBlocked
            }
            onClick={onDuplicateSection}
          >
            Duplicate as placed section
          </button>
        </>
      )}
      {feature.kind === 'transform' && (
        <>
          <p className="cad-hint">
            Rigid placement of{' '}
            {geometry?.features.find((item) => item.id === feature.inputId)?.name ?? 'input shape'}.
          </p>
          <label className="field-label">
            <span>Source geometry</span>
            <Select
              aria-label="Placement source geometry"
              value={feature.inputId}
              options={earlier.map((item) => ({ value: item.id, label: item.name }))}
              onChange={(id) =>
                update((next) => {
                  if (next.kind === 'transform') next.inputId = id;
                })
              }
            />
          </label>
          {([0, 1, 2] as const).map((axis) => (
            <NumberInput
              commitMode="finish"
              key={axis}
              label={`Translate ${'XYZ'[axis]}`}
              value={feature.translation[axis] * factor}
              unit={units}
              onChange={(n) =>
                update((next) => {
                  if (next.kind === 'transform') next.translation[axis] = n / factor;
                })
              }
            />
          ))}
          <NumberInput
            commitMode="finish"
            label="Rotation"
            value={(feature.angle * 180) / Math.PI}
            unit="°"
            maximum={360}
            onChange={(n) =>
              update((next) => {
                if (next.kind === 'transform') next.angle = (n * Math.PI) / 180;
              })
            }
          />
          <Select
            aria-label="Rotation axis"
            value={JSON.stringify(feature.axisDirection)}
            options={[
              { value: '[1,0,0]', label: 'X axis' },
              { value: '[0,1,0]', label: 'Y axis' },
              { value: '[0,0,1]', label: 'Z axis' },
            ]}
            onChange={(value) =>
              update((next) => {
                if (next.kind === 'transform') next.axisDirection = JSON.parse(value);
              })
            }
          />
          <details>
            <summary>Rotation axis origin</summary>
            {([0, 1, 2] as const).map((axis) => (
              <NumberInput
                commitMode="finish"
                key={axis}
                label={`Origin ${'XYZ'[axis]}`}
                value={feature.axisOrigin[axis] * factor}
                unit={units}
                onChange={(n) =>
                  update((next) => {
                    if (next.kind === 'transform') next.axisOrigin[axis] = n / factor;
                  })
                }
              />
            ))}
          </details>
        </>
      )}
      {(feature.kind === 'loft' || feature.kind === 'sweep' || feature.kind === 'assembly') && (
        <CadAdvancedFields
          value={feature}
          features={earlier}
          onChange={(replacement) => update((next) => Object.assign(next, replacement))}
          onPlaceComponent={feature.kind === 'assembly' && !creating ? onPlaceComponent : undefined}
        />
      )}
      {!creating && (
        <button className="secondary full" disabled={draftBlocked} onClick={onDelete}>
          <Trash2 size={14} /> Delete feature
        </button>
      )}
    </fieldset>
  );
}
