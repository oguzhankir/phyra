import { useEffect, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Box,
  Circle,
  Download,
  Layers,
  Play,
  Plus,
  Save,
  Scissors,
  Square,
  Trash2,
  Undo2,
  Redo2,
  Upload,
} from 'lucide-react';
import type {
  CadFeature,
  CadSketchFeature,
  CadSketchConstraint,
} from '../../domain/contracts/project.generated';
import { rectangularProfile } from '../../domain/project/profile';
import {
  graphProfile,
  profileGraph,
  sketchReferenceError,
} from '../../domain/geometry/sketchGraph';
import { numericalCadGeometry } from '../../domain/geometry/cadConversion';
import { isNumericalProject } from '../../domain/project/document';
import { featureDependencies } from '../../domain/project/document';
import { lengthFactor, formatValue } from '../../domain/units';
import { NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';
import SketchCanvas from '../project/SketchCanvas';
import CadViewport from './CadViewport';
import type { CadWorkspaceModel } from './model';
import './CadWorkspace.css';

const freshId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
const labels: Record<CadFeature['kind'], string> = {
  'import-step': 'STEP import',
  sketch: 'Sketch',
  box: 'Box',
  cylinder: 'Cylinder',
  extrude: 'Extrusion',
  revolve: 'Revolution',
  boolean: 'Boolean',
  fillet: 'Fillet',
  chamfer: 'Chamfer',
};

export default function CadWorkspace({ model }: { model: CadWorkspaceModel }) {
  const { project, evaluation } = model;
  const conversion = isNumericalProject(project) ? numericalCadGeometry(project) : null;
  const geometry = project.geometry.kind === 'cad' ? project.geometry : null;
  const [sketchDirty, setSketchDirty] = useState(false);
  const [sketchView, setSketchView] = useState<'authored' | 'evaluated'>('authored');
  useEffect(() => {
    setSelected([]);
  }, [evaluation?.preview]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [selectionKind, setSelectionKind] = useState<'face' | 'edge' | 'body'>('face');
  const [selected, setSelected] = useState<string[]>([]);
  const [exportUnits, setExportUnits] = useState<'m' | 'mm'>(project.displayUnits);
  const feature =
    geometry?.features.find((item) => item.id === chosenId) ??
    geometry?.features.find((item) => item.id === geometry.outputFeatureId);
  const factor = lengthFactor(project.displayUnits);
  const dimension =
    geometry?.dimension ??
    (project.geometry.kind === 'empty'
      ? project.geometry.dimension
      : (project.study?.dimension ?? '3d'));
  const chooseEntity = (id: string, additive = false) =>
    setSelected((previous) =>
      additive
        ? previous.includes(id)
          ? previous.filter((item) => item !== id)
          : [...previous, id]
        : [id],
    );
  const add = (next: CadFeature) => {
    if (model.locked) return;
    if (sketchDirty) {
      model.onError('Apply or revert the current sketch before adding another feature.');
      return;
    }
    if (geometry)
      model.editGeometry((value) => {
        value.features.push(next);
        value.outputFeatureId = next.id;
      });
    else
      model.replaceGeometry({
        kind: 'cad',
        dimension,
        features: [next],
        outputFeatureId: next.id,
        assets: [],
      });
    setChosenId(next.id);
    setSketchView('authored');
    setSelected([]);
  };
  const update = (change: (next: CadFeature) => void) => {
    if (!feature) return;
    model.editGeometry((value) => {
      const item = value.features.find((next) => next.id === feature.id);
      if (item) change(item);
    });
  };
  const output = geometry?.outputFeatureId;
  const sketches = geometry?.features.filter((item) => item.kind === 'sketch') ?? [];
  const shapes = geometry?.features.filter((item) => item.kind !== 'sketch') ?? [];
  const selectedEdges =
    evaluation?.preview.edges
      .filter((edge) => selected.includes(edge.id) && edge.identity !== 'ambiguous')
      .map((edge) => edge.id) ?? [];
  const deleteFeature = () => {
    if (!feature || !geometry) return;
    const dependent = geometry.features.find((item) =>
      featureDependencies(item).includes(feature.id),
    );
    if (dependent) {
      model.onError(`Remove ${dependent.name} before deleting its input ${feature.name}.`);
      return;
    }
    if (geometry.features.length === 1)
      model.replaceGeometry({ kind: 'empty', dimension: geometry.dimension });
    else
      model.editGeometry((value) => {
        value.features = value.features.filter(
          (item) => item.id !== feature.id,
        ) as typeof value.features;
        if (value.outputFeatureId === feature.id) value.outputFeatureId = value.features.at(-1)!.id;
      });
    setChosenId(null);
  };
  const dimensionInput = (label: string, value: number, field: string, signed = false) => (
    <NumberInput
      label={label}
      value={value * factor}
      unit={project.displayUnits}
      positive={!signed}
      maximum={1000 * factor}
      onChange={(n) =>
        update((next) => {
          if (field.startsWith('axisOrigin') && next.kind === 'revolve')
            next.axisOrigin[Number(field.at(-1))] = n / factor;
          else if (field in next) Object.assign(next, { [field]: n / factor });
        })
      }
    />
  );
  return (
    <div className="cad-workspace">
      <header className="cad-heading">
        <button className="secondary" disabled={model.busy || sketchDirty} onClick={model.onReturn}>
          <ArrowLeft size={15} /> Project
        </button>
        <div>
          <h1>{project.name}</h1>
          <p>Geometry workspace · {dimension.toUpperCase()} · SI definition</p>
        </div>
        <div className="cad-heading-actions">
          <button className="icon-button" aria-label="CAD help" onClick={model.onHelp}>
            <BookOpen size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Undo CAD edit"
            disabled={!model.canUndo || sketchDirty}
            onClick={model.onUndo}
          >
            <Undo2 size={15} />
          </button>
          <button
            className="icon-button"
            aria-label="Redo CAD edit"
            disabled={!model.canRedo || sketchDirty}
            onClick={model.onRedo}
          >
            <Redo2 size={15} />
          </button>
          <button
            className="secondary"
            disabled={!model.canSave}
            onClick={() => void model.onSaveProject()}
          >
            <Save size={14} /> Save project
          </button>
          {model.busy ? (
            <button className="cancel-button" onClick={() => void model.cancel()}>
              Cancel evaluation
            </button>
          ) : (
            <button
              className="primary"
              disabled={
                model.locked ||
                model.nativeLocked ||
                model.draftBlocked ||
                sketchDirty ||
                !geometry ||
                !model.desktop
              }
              onClick={() => void model.evaluate()}
            >
              <Play size={14} /> Evaluate geometry
            </button>
          )}
        </div>
      </header>
      <div className="cad-ribbon" role="toolbar" aria-label="CAD feature tools">
        {conversion && (
          <>
            <button disabled={model.locked} onClick={() => model.replaceGeometry(conversion)}>
              Convert current geometry to CAD
            </button>
            <span className="toolbar-divider" />
          </>
        )}
        <button
          disabled={model.locked || dimension === '2d'}
          onClick={() =>
            add({
              id: freshId('box'),
              name: 'Box',
              kind: 'box',
              length: 0.1,
              width: 0.05,
              height: 0.025,
            })
          }
        >
          <Box size={16} /> Box
        </button>
        <button
          disabled={model.locked || dimension === '2d'}
          onClick={() =>
            add({
              id: freshId('cylinder'),
              name: 'Cylinder',
              kind: 'cylinder',
              radius: 0.025,
              length: 0.1,
            })
          }
        >
          <Circle size={16} /> Cylinder
        </button>
        <button
          disabled={model.locked}
          onClick={() =>
            add({
              id: freshId('sketch'),
              name: 'Rectangle sketch',
              kind: 'sketch',
              plane: 'xy',
              sketch: profileGraph({ ...rectangularProfile(0.1, 0.05), holes: [] }),
            })
          }
        >
          <Square size={16} /> Sketch
        </button>
        <button
          disabled={model.locked}
          onClick={() => {
            const id = freshId('circle'),
              centerId = freshId('center');
            add({
              id: freshId('sketch'),
              name: 'Circle sketch',
              kind: 'sketch',
              plane: 'xy',
              sketch: {
                points: [{ id: centerId, position: [0, 0] }],
                entities: [{ id, name: 'Circle', kind: 'circle', centerId, radius: 0.025 }],
                constraints: [],
                loops: [{ id: 'outer', role: 'outer', entityIds: [id] }],
              },
            });
          }}
        >
          <Circle size={16} /> Circle sketch
        </button>
        <span className="toolbar-divider" />
        <button
          disabled={model.locked || !sketches.length || dimension === '2d'}
          onClick={() =>
            add({
              id: freshId('extrude'),
              name: 'Extrusion',
              kind: 'extrude',
              sketchId: feature?.kind === 'sketch' ? feature.id : sketches.at(-1)!.id,
              distance: 0.025,
            })
          }
        >
          <Layers size={16} /> Extrude
        </button>
        <button
          disabled={model.locked || !sketches.length || dimension === '2d'}
          onClick={() =>
            add({
              id: freshId('revolve'),
              name: 'Revolution',
              kind: 'revolve',
              sketchId: feature?.kind === 'sketch' ? feature.id : sketches.at(-1)!.id,
              axisOrigin: [0, 0, 0],
              axisDirection: [1, 0, 0],
              angle: 2 * Math.PI,
            })
          }
        >
          <Circle size={16} /> Revolve
        </button>
        <button
          disabled={model.locked || shapes.length < 2}
          onClick={() =>
            add({
              id: freshId('boolean'),
              name: 'Boolean cut',
              kind: 'boolean',
              operation: 'cut',
              leftId: shapes.at(-2)!.id,
              rightId: shapes.at(-1)!.id,
            })
          }
        >
          <Scissors size={16} /> Boolean
        </button>
        <button
          disabled={model.locked || !output || !selectedEdges.length || !evaluation}
          title="Select unambiguous evaluated edges first"
          onClick={() =>
            add({
              id: freshId('fillet'),
              name: 'Fillet',
              kind: 'fillet',
              inputId: output!,
              edgeIds: selectedEdges as [string, ...string[]],
              radius: 0.002,
            })
          }
        >
          Fillet
        </button>
        <button
          disabled={model.locked || !output || !selectedEdges.length || !evaluation}
          title="Select unambiguous evaluated edges first"
          onClick={() =>
            add({
              id: freshId('chamfer'),
              name: 'Chamfer',
              kind: 'chamfer',
              inputId: output!,
              edgeIds: selectedEdges as [string, ...string[]],
              distance: 0.002,
            })
          }
        >
          Chamfer
        </button>
        <span className="toolbar-divider" />
        <button
          disabled={model.locked || model.nativeLocked || model.draftBlocked || !model.desktop}
          onClick={() => void model.importSource()}
        >
          <Upload size={16} /> Import STEP
        </button>
      </div>
      <div className="cad-layout">
        <aside className="cad-tree">
          <h2>Feature history</h2>
          {!geometry ? (
            <>
              <p className="cad-hint">
                {isNumericalProject(project)
                  ? 'Current geometry remains in its numerical definition. Convert it explicitly to preserve its exact dimensions in CAD, or return to its current editor.'
                  : 'Start with a sketch, a solid primitive or a STEP import.'}
              </p>
              {project.geometry.kind === 'empty' && (
                <Select
                  aria-label="New geometry dimension"
                  value={project.geometry.dimension}
                  options={[
                    { value: '2d', label: '2D plane geometry' },
                    { value: '3d', label: '3D solid geometry' },
                  ]}
                  onChange={(value) =>
                    model.replaceGeometry({ kind: 'empty', dimension: value as '2d' | '3d' })
                  }
                />
              )}
            </>
          ) : (
            <ol>
              {geometry.features.map((item, index) => (
                <li key={item.id}>
                  <button
                    className={feature?.id === item.id ? 'active' : ''}
                    disabled={sketchDirty}
                    onClick={() => {
                      setChosenId(item.id);
                      setSketchView('authored');
                      setSelected([]);
                    }}
                  >
                    <small>{index + 1}</small>
                    <span>
                      {item.name}
                      <em>
                        {labels[item.kind]}
                        {item.id === geometry.outputFeatureId ? ' · Output' : ''}
                      </em>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          )}
          {geometry && feature && (
            <button
              className="secondary full"
              disabled={model.locked || sketchDirty || feature.id === geometry.outputFeatureId}
              onClick={() =>
                model.editGeometry((next) => {
                  next.outputFeatureId = feature.id;
                })
              }
            >
              Use selected feature as output
            </button>
          )}
          {evaluation && (
            <>
              <h2>Geometry entities</h2>
              <Select
                aria-label="CAD entity selection"
                value={selectionKind}
                options={[
                  { value: 'body', label: 'Bodies' },
                  { value: 'face', label: 'Faces' },
                  { value: 'edge', label: 'Edges' },
                ]}
                onChange={(value) => {
                  setSelectionKind(value as typeof selectionKind);
                  setSelected([]);
                }}
              />
              <div className="cad-entity-list">
                {(selectionKind === 'face'
                  ? evaluation.preview.faces
                  : selectionKind === 'edge'
                    ? evaluation.preview.edges
                    : evaluation.preview.bodies
                ).map((entity) => (
                  <label key={entity.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(entity.id)}
                      onChange={() => chooseEntity(entity.id, true)}
                    />
                    <span>
                      {entity.name}
                      {entity.identity === 'ambiguous' && <small>Ambiguous identity</small>}
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
        </aside>
        <main className="cad-canvas-area">
          {feature?.kind === 'sketch' && evaluation && (
            <div className="cad-view-toggle">
              <button
                className={sketchView === 'authored' ? 'active' : ''}
                onClick={() => setSketchView('authored')}
              >
                Authored sketch
              </button>
              <button
                className={sketchView === 'evaluated' ? 'active' : ''}
                disabled={sketchDirty}
                onClick={() => setSketchView('evaluated')}
              >
                Evaluated shape
              </button>
            </div>
          )}
          {sketchView === 'authored' &&
          feature?.kind === 'sketch' &&
          graphProfile(feature.sketch) ? (
            <div className="cad-sketch-area" inert={model.locked}>
              <SketchCanvas
                profile={graphProfile(feature.sketch)!}
                planeLabel={`${feature.plane.toUpperCase()} local sketch`}
                factor={factor}
                unit={project.displayUnits}
                reservedIds={feature.sketch.entities.map((item) => item.id)}
                onSelectBoundary={() => {}}
                onDraftChange={(dirty) => {
                  setSketchDirty(dirty);
                  model.reportDraft('cad-sketch', dirty ? 'Unapplied CAD sketch' : null);
                }}
                onApply={(profile) => {
                  if (model.locked) return false;
                  const graph = profileGraph(profile, feature.sketch);
                  const issue = sketchReferenceError(graph);
                  if (issue) {
                    model.onError(issue);
                    return false;
                  }
                  model.reportDraft('cad-sketch', null);
                  update((next) => {
                    if (next.kind === 'sketch') next.sketch = graph;
                  });
                  return true;
                }}
              />
            </div>
          ) : (
            <CadViewport
              preview={evaluation?.preview ?? null}
              selected={selected}
              selectionKind={selectionKind}
              onSelect={chooseEntity}
              dark={model.dark}
              onRendered={model.onRendered}
            />
          )}
          <div className={`cad-evaluation-status ${evaluation ? 'complete' : ''}`} role="status">
            {model.busy
              ? 'Evaluating exact geometry in the local worker…'
              : evaluation
                ? `${evaluation.kernel} · ${evaluation.bodyCount} bodies · ${evaluation.faceCount} faces · ${evaluation.edgeCount} edges`
                : 'Geometry has not been evaluated for the current definition.'}
          </div>
          {model.error && (
            <div className="cad-error" role="alert">
              <strong>Geometry needs attention</strong>
              <p>{model.error}</p>
              <button className="text-button" onClick={() => model.onError(null)}>
                Dismiss
              </button>
            </div>
          )}
        </main>
        <aside className="cad-properties">
          <h2>{feature ? labels[feature.kind] : 'Geometry properties'}</h2>
          {feature ? (
            <fieldset disabled={model.locked}>
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
              {feature.kind === 'extrude' &&
                dimensionInput('Distance', feature.distance, 'distance', true)}
              {feature.kind === 'revolve' && (
                <>
                  <NumberInput
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
                        if (next.kind === 'boolean')
                          next.operation = value as typeof next.operation;
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
                          (item) =>
                            geometry!.features.indexOf(item) < geometry!.features.indexOf(feature),
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
                    STEP units are read by the exact kernel and converted to SI. The scale below is
                    an additional user transformation.
                  </p>
                  <NumberInput
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
              {feature.kind === 'chamfer' &&
                dimensionInput('Distance', feature.distance, 'distance')}
              {feature.kind === 'sketch' && (
                <SketchProperties
                  feature={feature}
                  draftBlocked={sketchDirty}
                  report={evaluation?.sketches.find((item) => item.featureId === feature.id)}
                  factor={factor}
                  unit={project.displayUnits}
                  onChange={(next) =>
                    update((item) => {
                      if (item.kind === 'sketch') Object.assign(item, next);
                    })
                  }
                />
              )}
              <button className="secondary full" disabled={sketchDirty} onClick={deleteFeature}>
                <Trash2 size={14} /> Delete feature
              </button>
            </fieldset>
          ) : (
            <p className="cad-hint">Choose a feature to edit its definition.</p>
          )}
          {evaluation && (
            <div className="cad-shape-summary">
              <h2>Exact shape measurements</h2>
              <dl>
                <dt>Volume</dt>
                <dd>{formatValue(evaluation.volume)} m³</dd>
                <dt>Surface area</dt>
                <dd>{formatValue(evaluation.surfaceArea)} m²</dd>
              </dl>
            </div>
          )}
          <div className="cad-export">
            <h2>Export geometry</h2>
            <Select
              aria-label="CAD export units"
              value={exportUnits}
              options={[
                { value: 'm', label: 'Meters' },
                { value: 'mm', label: 'Millimeters' },
              ]}
              onChange={(unit) => setExportUnits(unit as 'm' | 'mm')}
            />
            <button
              className="secondary full"
              disabled={
                model.locked ||
                model.nativeLocked ||
                model.draftBlocked ||
                !evaluation ||
                !model.desktop
              }
              onClick={() => void model.exportShape('step', exportUnits)}
            >
              <Download size={14} /> Export STEP
            </button>
            <button
              className="secondary full"
              disabled={
                model.locked ||
                model.nativeLocked ||
                model.draftBlocked ||
                !evaluation ||
                !model.desktop
              }
              onClick={() => void model.exportShape('brep', 'm')}
            >
              Export B-rep (SI)
            </button>
          </div>
          <p className="cad-hint">
            Geometry validity and analysis support are separate. The project overview reports the
            exact geometry’s available analysis paths. Unsupported shapes remain editable and
            exportable.
          </p>
        </aside>
      </div>
    </div>
  );
}

function SketchProperties({
  feature,
  draftBlocked,
  report,
  factor,
  unit,
  onChange,
}: {
  feature: CadSketchFeature;
  draftBlocked: boolean;
  report?: CadWorkspaceModel['evaluation'] extends infer T
    ? NonNullable<T> extends { sketches: infer S }
      ? S extends (infer R)[]
        ? R
        : never
      : never
    : never;
  factor: number;
  unit: 'm' | 'mm';
  onChange: (feature: CadSketchFeature) => void;
}) {
  const [kind, setKind] = useState<CadSketchConstraint['kind']>('horizontal');
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [value, setValue] = useState(10);
  const points = feature.sketch.points;
  const lines = feature.sketch.entities.filter((e) => e.kind === 'line');
  const curves = feature.sketch.entities.filter((e) => e.kind !== 'line');
  const pointKind = ['fixedPoint', 'coincident', 'distance'].includes(kind);
  const curveKind = ['diameter', 'equalRadius'].includes(kind);
  const options = (pointKind ? points : curveKind ? curves : lines).map((item) => ({
    value: item.id,
    label: 'name' in item ? item.name : item.id,
  }));
  const firstId = options.some((o) => o.value === first) ? first : (options[0]?.value ?? '');
  const secondId = options.some((o) => o.value === second)
    ? second
    : (options[1]?.value ?? options[0]?.value ?? '');
  const two = [
    'coincident',
    'distance',
    'equalLength',
    'parallel',
    'perpendicular',
    'equalRadius',
  ].includes(kind);
  const addConstraint = () => {
    const id = freshId('constraint');
    let c: CadSketchConstraint;
    switch (kind) {
      case 'fixedPoint':
        c = { id, kind, pointId: firstId };
        break;
      case 'coincident':
        c = { id, kind, firstPointId: firstId, secondPointId: secondId };
        break;
      case 'distance':
        c = { id, kind, firstPointId: firstId, secondPointId: secondId, value: value / factor };
        break;
      case 'horizontal':
      case 'vertical':
        c = { id, kind, lineId: firstId };
        break;
      case 'diameter':
        c = { id, kind, curveId: firstId, value: value / factor };
        break;
      case 'equalRadius':
        c = { id, kind, firstCurveId: firstId, secondCurveId: secondId };
        break;
      default:
        c = { id, kind, firstLineId: firstId, secondLineId: secondId };
    }
    onChange({
      ...feature,
      sketch: { ...feature.sketch, constraints: [...feature.sketch.constraints, c] },
    });
  };
  return (
    <>
      <details className="cad-sketch-coordinates">
        <summary>Authored points & curves</summary>
        {feature.sketch.points.map((point) => (
          <div key={point.id}>
            <small>{point.id}</small>
            {([0, 1] as const).map((axis) => (
              <NumberInput
                key={axis}
                disabled={draftBlocked}
                label={'XY'[axis]}
                value={point.position[axis] * factor}
                unit={unit}
                onChange={(value) =>
                  onChange({
                    ...feature,
                    sketch: {
                      ...feature.sketch,
                      points: feature.sketch.points.map((item) =>
                        item.id === point.id
                          ? {
                              ...item,
                              position: item.position.map((n, i) =>
                                i === axis ? value / factor : n,
                              ) as [number, number],
                            }
                          : item,
                      ),
                    },
                  })
                }
              />
            ))}
          </div>
        ))}
        {curves
          .filter((curve) => curve.kind === 'circle')
          .map((curve) => (
            <NumberInput
              key={curve.id}
              disabled={draftBlocked}
              label={`${curve.name} radius`}
              value={curve.radius * factor}
              unit={unit}
              positive
              onChange={(value) =>
                onChange({
                  ...feature,
                  sketch: {
                    ...feature.sketch,
                    entities: feature.sketch.entities.map((item) =>
                      item.id === curve.id && item.kind === 'circle'
                        ? { ...item, radius: value / factor }
                        : item,
                    ),
                  },
                })
              }
            />
          ))}
      </details>
      <Select
        aria-label="Sketch plane"
        value={feature.plane}
        options={['xy', 'xz', 'yz'].map((plane) => ({
          value: plane,
          label: `${plane.toUpperCase()} plane`,
        }))}
        onChange={(plane) => onChange({ ...feature, plane: plane as typeof feature.plane })}
      />
      <h3>Sketch constraints</h3>
      <p className="cad-hint">
        {report
          ? `${report.status} · ${report.degreesOfFreedom ?? 'unknown'} degrees of freedom`
          : 'Evaluate to measure degrees of freedom and constraint conflicts. No automatic anchor is added.'}
      </p>
      {feature.sketch.constraints.map((constraint) => (
        <div className="cad-constraint-row" key={constraint.id}>
          <span>
            {constraint.kind}
            {report?.failedConstraintIds.includes(constraint.id) && <small>Needs repair</small>}
          </span>
          <button
            className="icon-button"
            aria-label={`Delete ${constraint.kind} constraint`}
            onClick={() =>
              onChange({
                ...feature,
                sketch: {
                  ...feature.sketch,
                  constraints: feature.sketch.constraints.filter(
                    (item) => item.id !== constraint.id,
                  ),
                },
              })
            }
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
      <Select
        aria-label="New sketch constraint"
        value={kind}
        options={(
          [
            'fixedPoint',
            'coincident',
            'distance',
            'horizontal',
            'vertical',
            'diameter',
            'equalLength',
            'parallel',
            'perpendicular',
            'equalRadius',
          ] as const
        ).map((k) => ({ value: k, label: k.replace(/([A-Z])/g, ' $1') }))}
        onChange={(k) => {
          setKind(k as typeof kind);
          setFirst('');
          setSecond('');
        }}
      />
      <Select
        aria-label="First constraint reference"
        value={firstId}
        options={options}
        onChange={setFirst}
      />
      {two && (
        <Select
          aria-label="Second constraint reference"
          value={secondId}
          options={options}
          onChange={setSecond}
        />
      )}
      {['distance', 'diameter'].includes(kind) && (
        <NumberInput
          label="Constraint value"
          value={value}
          unit={unit}
          positive
          onChange={setValue}
        />
      )}
      <button
        className="secondary full"
        disabled={
          !firstId ||
          (two && (!secondId || firstId === secondId)) ||
          feature.sketch.constraints.length >= 512
        }
        onClick={addConstraint}
      >
        <Plus size={14} /> Add constraint
      </button>
    </>
  );
}
