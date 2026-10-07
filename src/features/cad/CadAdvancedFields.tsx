import { ArrowDown, ArrowUp, Plus, Trash2, Move3D } from 'lucide-react';
import type { CadFeature } from '../../domain/contracts/project.generated';
import Select from '../../shared/ui/Select';
import {
  bodyInputs,
  cadId,
  pathInputs,
  profileInputs,
  type AdvancedFeature,
} from './advancedFeatures';

export default function CadAdvancedFields({
  value,
  features,
  onChange,
  onPlaceComponent,
}: {
  value: AdvancedFeature;
  features: readonly CadFeature[];
  onChange: (next: AdvancedFeature) => void;
  onPlaceComponent?: (id: string) => void;
}) {
  const replace = (change: (next: AdvancedFeature) => void) => {
    const next = structuredClone(value);
    change(next);
    onChange(next);
  };
  const options = (items: CadFeature[]) =>
    items.map((item) => ({
      value: item.id,
      label: item.name,
      description:
        item.kind === 'transform'
          ? 'Placed geometry'
          : item.kind === 'sketch'
            ? 'Sketch on ' + item.plane.toUpperCase()
            : item.kind,
    }));
  const profiles = profileInputs(features),
    bodies = bodyInputs(features);
  return (
    <div className="cad-advanced-fields">
      {value.kind === 'loft' && (
        <>
          <p className="cad-hint">
            Connect closed sections in order. Place each sketch at its intended position with Move /
            rotate before creating the loft. Holes are not supported in this operation.
          </p>
          <ol className="cad-input-list">
            {value.sectionIds.map((id, index) => (
              <li key={index}>
                <span className="cad-input-number">{index + 1}</span>
                <Select
                  aria-label={`Loft section ${index + 1}`}
                  value={id}
                  options={options(
                    profiles.filter(
                      (item) => item.id === id || !value.sectionIds.includes(item.id),
                    ),
                  )}
                  onChange={(id) =>
                    replace((next) => {
                      if (next.kind === 'loft') next.sectionIds[index] = id;
                    })
                  }
                />
                <div className="cad-row-actions">
                  <button
                    type="button"
                    aria-label={`Move section ${index + 1} up`}
                    disabled={index === 0}
                    onClick={() =>
                      replace((next) => {
                        if (next.kind === 'loft')
                          [next.sectionIds[index - 1], next.sectionIds[index]] = [
                            next.sectionIds[index],
                            next.sectionIds[index - 1],
                          ];
                      })
                    }
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Move section ${index + 1} down`}
                    disabled={index === value.sectionIds.length - 1}
                    onClick={() =>
                      replace((next) => {
                        if (next.kind === 'loft')
                          [next.sectionIds[index + 1], next.sectionIds[index]] = [
                            next.sectionIds[index],
                            next.sectionIds[index + 1],
                          ];
                      })
                    }
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove section ${index + 1}`}
                    disabled={value.sectionIds.length <= 2}
                    onClick={() =>
                      replace((next) => {
                        if (next.kind === 'loft') next.sectionIds.splice(index, 1);
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="secondary full"
            disabled={
              value.sectionIds.length >= 16 ||
              profiles.every((item) => value.sectionIds.includes(item.id))
            }
            onClick={() =>
              replace((next) => {
                if (next.kind === 'loft') {
                  const source = profiles.find((item) => !next.sectionIds.includes(item.id));
                  if (source) next.sectionIds.push(source.id);
                }
              })
            }
          >
            <Plus size={14} /> Add section
          </button>
          <label className="cad-checkbox">
            <input
              type="checkbox"
              checked={value.ruled}
              onChange={(event) =>
                replace((next) => {
                  if (next.kind === 'loft') next.ruled = event.target.checked;
                })
              }
            />{' '}
            Straight transitions between sections
          </label>
        </>
      )}
      {value.kind === 'sweep' && (
        <>
          <p className="cad-hint">
            Place a closed profile at the first-created path endpoint, perpendicular to its starting
            tangent. Use one connected open line/arc sketch as the path. Corners use miter
            transitions. Self-intersections are rejected; holes are not supported.
          </p>
          <label className="field-label">
            <span>Cross-section profile</span>
            <Select
              aria-label="Sweep cross-section profile"
              value={value.profileId}
              options={[{ value: '', label: 'Choose a closed profile' }, ...options(profiles)]}
              onChange={(id) =>
                replace((next) => {
                  if (next.kind === 'sweep') next.profileId = id;
                })
              }
            />
          </label>
          <label className="field-label">
            <span>Open path</span>
            <Select
              aria-label="Sweep open path"
              value={value.spineId}
              options={[
                { value: '', label: 'Choose an open path' },
                ...options(pathInputs(features)),
              ]}
              onChange={(id) =>
                replace((next) => {
                  if (next.kind === 'sweep') next.spineId = id;
                })
              }
            />
          </label>
        </>
      )}
      {(value.kind === 'loft' || value.kind === 'sweep') && (
        <label className="field-label">
          <span>Output geometry</span>
          <Select
            aria-label="Output geometry"
            value={value.solid ? 'solid' : 'surface'}
            options={[
              {
                value: 'solid',
                label: 'Closed solid',
                description: 'Includes end caps and enclosed volume',
              },
              {
                value: 'surface',
                label: 'Surface shell',
                description: 'Open ends, no enclosed volume',
              },
            ]}
            onChange={(type) =>
              replace((next) => {
                if (next.kind !== 'assembly') next.solid = type === 'solid';
              })
            }
          />
        </label>
      )}
      {value.kind === 'assembly' && (
        <>
          <p className="cad-hint">
            Each component is a separate instance of its source geometry. Reusing a source preserves
            separate identity. Placement changes use Move / rotate; physical connections need a
            future compatible study.
          </p>
          <ol className="cad-component-list">
            {value.components.map((component, index) => (
              <li key={component.id}>
                <label className="field-label">
                  <span>Component {index + 1}</span>
                  <input
                    aria-label={`Component ${index + 1} name`}
                    value={component.name}
                    maxLength={200}
                    onChange={(event) =>
                      replace((next) => {
                        if (next.kind === 'assembly')
                          next.components[index].name = event.target.value;
                      })
                    }
                  />
                </label>
                <Select
                  aria-label={`Component ${index + 1} source`}
                  value={component.featureId}
                  options={options(bodies)}
                  onChange={(id) =>
                    replace((next) => {
                      if (next.kind === 'assembly') next.components[index].featureId = id;
                    })
                  }
                />
                <div className="cad-component-actions">
                  {onPlaceComponent && (
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => onPlaceComponent(component.id)}
                    >
                      <Move3D size={14} /> Move / rotate
                    </button>
                  )}
                  <button
                    type="button"
                    className="text-button"
                    aria-label={`Remove component ${index + 1}`}
                    disabled={value.components.length <= 1}
                    onClick={() =>
                      replace((next) => {
                        if (next.kind === 'assembly') next.components.splice(index, 1);
                      })
                    }
                  >
                    <Trash2 size={14} /> Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <button
            type="button"
            className="secondary full"
            disabled={!bodies.length || value.components.length >= 32}
            onClick={() =>
              replace((next) => {
                if (next.kind === 'assembly') {
                  const source = bodies.at(-1)!;
                  next.components.push({
                    id: cadId('component'),
                    name: `${source.name} ${next.components.length + 1}`,
                    featureId: source.id,
                  });
                }
              })
            }
          >
            <Plus size={14} /> Add component instance
          </button>
        </>
      )}
    </div>
  );
}
