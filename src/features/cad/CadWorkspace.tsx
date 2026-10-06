import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Box,
  Circle,
  Download,
  Layers,
  Play,
  Move3D,
  Check,
  X,
  Save,
  Scissors,
  Square,
  Trash2,
  Undo2,
  Redo2,
  Upload,
} from 'lucide-react';
import type { CadFeature, CadSketchFeature } from '../../domain/contracts/project.generated';
import { numericalCadGeometry } from '../../domain/geometry/cadConversion';
import { isNumericalProject } from '../../domain/project/document';
import { featureDependencies } from '../../domain/project/document';
import { lengthFactor, formatValue } from '../../domain/units';
import { NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';
import CadSketchEditor from './CadSketchEditor';
import { sketchReadiness } from './sketchInteractions';
import { cadRebuildIssue, usableSketch } from './featureWorkflow';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import CadViewport from './CadViewport';
import { cadAuthoringGuide } from './authoringGuide';
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
  transform: 'Move / rotate',
};

export default function CadWorkspace({ model }: { model: CadWorkspaceModel }) {
  const { project, evaluation } = model;
  const conversion = isNumericalProject(project) ? numericalCadGeometry(project) : null;
  const geometry = project.geometry.kind === 'cad' ? project.geometry : null;
  const [sketchDirty, setSketchDirty] = useState(false);
  const [editingSketch, setEditingSketch] = useState<string | null>(null);
  const [newSketchPlane, setNewSketchPlane] = useState<'xy' | 'xz' | 'yz' | null>(null);
  const planeDialog = useRef<HTMLDivElement>(null);
  useModalFocus(!!newSketchPlane, () => setNewSketchPlane(null), 'cad-plane-title', planeDialog);
  const [autoRebuild, setAutoRebuild] = useState(model.desktop);
  const [edgeTool, setEdgeTool] = useState<'fillet' | 'chamfer' | null>(null);
  const [edgeSize, setEdgeSize] = useState(0.002);
  const attemptedSource = useRef('');
  const evaluateRef = useRef(model.evaluate);
  evaluateRef.current = model.evaluate;
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
    if (sketchDirty || model.draftBlocked) {
      model.onError(
        'Finish the current drawing gesture or dimension entry before adding another feature.',
      );
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
    setEditingSketch(next.kind === 'sketch' ? next.id : null);
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
  const activeSketch = geometry?.features.find(
    (item): item is CadSketchFeature => item.kind === 'sketch' && item.id === editingSketch,
  );
  const authoringGuide = useMemo(() => (geometry ? cadAuthoringGuide(geometry) : null), [geometry]);
  const geometryKey = JSON.stringify(geometry);
  useEffect(() => {
    if (
      !autoRebuild ||
      !model.desktop ||
      !geometry ||
      activeSketch ||
      model.busy ||
      model.locked ||
      model.nativeLocked ||
      model.draftBlocked ||
      model.evaluation ||
      attemptedSource.current === geometryKey
    )
      return;
    if (cadRebuildIssue(geometry)) return;
    const timer = window.setTimeout(() => {
      attemptedSource.current = geometryKey;
      void evaluateRef.current();
    }, 700);
    return () => window.clearTimeout(timer);
  }, [
    autoRebuild,
    model.desktop,
    geometryKey,
    activeSketch,
    model.busy,
    model.locked,
    model.nativeLocked,
    model.draftBlocked,
    model.evaluation,
  ]);
  useEffect(() => {
    if (editingSketch && !activeSketch) setEditingSketch(null);
  }, [editingSketch, activeSketch]);
  const sketches = geometry?.features.filter((item) => item.kind === 'sketch') ?? [];
  const shapes = geometry?.features.filter((item) => item.kind !== 'sketch') ?? [];
  const sourceSketch = usableSketch(sketches, feature?.kind === 'sketch' ? feature.id : undefined);
  const rebuildIssue = geometry ? cadRebuildIssue(geometry) : null;
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
      commitMode="finish"
      label={label}
      value={value * factor}
      unit={project.displayUnits}
      positive={!signed}
      minimum={signed ? -1000 * factor : -Infinity}
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
          <p>
            Geometry workspace · {dimension.toUpperCase()} · {project.displayUnits}
          </p>
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
          {!activeSketch && model.desktop && (
            <label className="cad-auto-rebuild">
              <input
                type="checkbox"
                checked={autoRebuild}
                onChange={(event) => setAutoRebuild(event.target.checked)}
              />
              Auto rebuild
            </label>
          )}
          {model.busy ? (
            <button
              className="cancel-button"
              disabled={!model.cancellable}
              onClick={() => void model.cancel()}
            >
              Cancel operation
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
                !!activeSketch ||
                !!rebuildIssue ||
                !model.desktop
              }
              title={rebuildIssue ?? 'Build the exact shape from the current feature history'}
              onClick={() => {
                attemptedSource.current = geometryKey;
                void model.evaluate();
              }}
            >
              <Play size={14} /> Rebuild geometry
            </button>
          )}
        </div>
      </header>
      {!activeSketch && (
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
          <button disabled={model.locked || !!activeSketch} onClick={() => setNewSketchPlane('xy')}>
            <Square size={16} /> New sketch
          </button>
          <span className="toolbar-divider" />
          <button
            disabled={model.locked || !sourceSketch || dimension === '2d'}
            onClick={() =>
              add({
                id: freshId('extrude'),
                name: 'Extrusion',
                kind: 'extrude',
                sketchId: sourceSketch!.id,
                distance: 0.025,
              })
            }
          >
            <Layers size={16} /> Extrude
          </button>
          <button
            disabled={model.locked || !sourceSketch || dimension === '2d'}
            onClick={() =>
              add({
                id: freshId('revolve'),
                name: 'Revolution',
                kind: 'revolve',
                sketchId: sourceSketch!.id,
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
            disabled={model.locked || !output || !evaluation}
            onClick={() => {
              setSelectionKind('edge');
              setSelected([]);
              setEdgeTool('fillet');
            }}
          >
            Fillet
          </button>
          <button
            disabled={model.locked || !output || !evaluation}
            onClick={() => {
              setSelectionKind('edge');
              setSelected([]);
              setEdgeTool('chamfer');
            }}
          >
            Chamfer
          </button>
          <button
            disabled={model.locked || !shapes.length}
            onClick={() =>
              add({
                id: freshId('transform'),
                name: 'Move / rotate',
                kind: 'transform',
                inputId: feature && feature.kind !== 'sketch' ? feature.id : shapes.at(-1)!.id,
                translation: [0, 0, 0],
                axisOrigin: [0, 0, 0],
                axisDirection: [0, 0, 1],
                angle: 0,
              })
            }
          >
            <Move3D size={16} /> Move / rotate
          </button>
          <span className="toolbar-divider" />
          <button
            disabled={model.locked || model.nativeLocked || model.draftBlocked || !model.desktop}
            onClick={() => void model.importSource()}
          >
            <Upload size={16} /> Import STEP
          </button>
        </div>
      )}
      {activeSketch && (
        <div className="cad-sketch-session" role="toolbar" aria-label="Sketch session">
          <div>
            <strong>Editing {activeSketch.name}</strong>
            <span>{activeSketch.plane.toUpperCase()} plane · draw and constrain your profile</span>
          </div>
          <button
            className="primary"
            disabled={model.locked || sketchDirty}
            onClick={() => {
              setEditingSketch(null);
              model.reportDraft('cad-sketch', null);
            }}
          >
            <Check size={15} /> Finish sketch
          </button>
        </div>
      )}
      <div className={`cad-layout ${activeSketch ? 'editing-sketch' : ''}`}>
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
                    disabled={sketchDirty || model.locked}
                    onClick={() => {
                      setChosenId(item.id);
                      setEditingSketch(item.kind === 'sketch' ? item.id : null);
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
          {activeSketch ? (
            <CadSketchEditor
              key={activeSketch.id}
              feature={activeSketch}
              units={project.displayUnits}
              locked={model.locked}
              solving={model.busy}
              onSolve={model.desktop ? () => model.solveSketch(activeSketch.id) : undefined}
              solveReport={
                model.sketchSolve?.featureId === activeSketch.id
                  ? model.sketchSolve.report
                  : evaluation?.sketches.find((item) => item.featureId === activeSketch.id)
              }
              onDraftChange={(dirty) => {
                setSketchDirty(dirty);
                model.reportDraft(
                  'cad-sketch',
                  dirty ? 'Finish or cancel the current sketch gesture' : null,
                );
              }}
              onChange={(next) =>
                model.editGeometry((value) => {
                  const index = value.features.findIndex((item) => item.id === next.id);
                  if (index >= 0) value.features[index] = next;
                })
              }
            />
          ) : (
            <>
              {edgeTool && (
                <div className="cad-edge-task">
                  <div>
                    <strong>
                      {edgeTool === 'fillet' ? 'Round selected edges' : 'Bevel selected edges'}
                    </strong>
                    <span>Click edges in the view. Hold Shift to add more.</span>
                  </div>
                  <NumberInput
                    commitMode="finish"
                    label={edgeTool === 'fillet' ? 'Radius' : 'Distance'}
                    value={edgeSize * factor}
                    unit={project.displayUnits}
                    positive
                    onChange={(n) => setEdgeSize(n / factor)}
                  />
                  <button
                    className="primary"
                    disabled={!selectedEdges.length || model.locked}
                    onClick={() => {
                      if (!output) return;
                      add(
                        edgeTool === 'fillet'
                          ? {
                              id: freshId('fillet'),
                              name: 'Fillet',
                              kind: 'fillet',
                              inputId: output,
                              edgeIds: selectedEdges as [string, ...string[]],
                              radius: edgeSize,
                            }
                          : {
                              id: freshId('chamfer'),
                              name: 'Chamfer',
                              kind: 'chamfer',
                              inputId: output,
                              edgeIds: selectedEdges as [string, ...string[]],
                              distance: edgeSize,
                            },
                      );
                      setEdgeTool(null);
                    }}
                  >
                    Apply to {selectedEdges.length} edges
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Cancel edge operation"
                    onClick={() => setEdgeTool(null)}
                  >
                    <X size={15} />
                  </button>
                </div>
              )}
              <CadViewport
                preview={evaluation?.preview ?? model.retainedPreview ?? null}
                guide={!evaluation ? authoringGuide : null}
                definitionPresent={!!geometry}
                stale={!evaluation && !!model.retainedPreview}
                selected={selected}
                selectionKind={selectionKind}
                onSelectionKind={(kind) => {
                  setSelectionKind(kind);
                  setSelected([]);
                }}
                onSelect={chooseEntity}
                onClearSelection={() => setSelected([])}
                dark={model.dark}
                onRendered={evaluation ? model.onRendered : undefined}
              />
            </>
          )}
          <div className={`cad-evaluation-status ${evaluation ? 'complete' : ''}`} role="status">
            {model.busy
              ? 'Evaluating exact geometry in the local worker…'
              : activeSketch
                ? 'Completed drawing gestures are saved in the project. Finish sketch to rebuild the exact geometry.'
                : evaluation
                  ? `${evaluation.kernel} · ${evaluation.bodyCount} bodies · ${evaluation.faceCount} faces · ${evaluation.edgeCount} edges`
                  : (rebuildIssue ??
                    'Edit feature dimensions, then rebuild to view the exact geometry.')}
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
        {!activeSketch && (
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
                              geometry!.features.indexOf(item) <
                              geometry!.features.indexOf(feature),
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
                      STEP units are read by the exact kernel and converted to SI. The scale below
                      is an additional user transformation.
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
                {feature.kind === 'chamfer' &&
                  dimensionInput('Distance', feature.distance, 'distance')}
                {feature.kind === 'sketch' && (
                  <>
                    <p className="cad-hint">
                      {feature.plane.toUpperCase()} plane · {feature.sketch.entities.length}{' '}
                      entities · {feature.sketch.constraints.length} constraints
                    </p>
                    {sketchReadiness(feature.sketch).issue && (
                      <p className="cad-hint">
                        {sketchReadiness(feature.sketch).issue} The sketch remains saved and
                        editable.
                      </p>
                    )}
                    <button className="primary" onClick={() => setEditingSketch(feature.id)}>
                      Edit sketch
                    </button>
                  </>
                )}
                {feature.kind === 'transform' && (
                  <>
                    <p className="cad-hint">
                      Rigid placement of{' '}
                      {geometry?.features.find((item) => item.id === feature.inputId)?.name ??
                        'input shape'}
                      .
                    </p>
                    {([0, 1, 2] as const).map((axis) => (
                      <NumberInput
                        commitMode="finish"
                        key={axis}
                        label={`Translate ${'XYZ'[axis]}`}
                        value={feature.translation[axis] * factor}
                        unit={project.displayUnits}
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
                          unit={project.displayUnits}
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
                  <dd>
                    {formatValue(evaluation.volume * factor ** 3)} {project.displayUnits}³
                  </dd>
                  <dt>Surface area</dt>
                  <dd>
                    {formatValue(evaluation.surfaceArea * factor ** 2)} {project.displayUnits}²
                  </dd>
                </dl>
              </div>
            )}
            {evaluation && (
              <div className={`cad-analysis-support ${evaluation.analysisCompatibility.state}`}>
                <h2>Analysis support</h2>
                <strong>
                  {evaluation.analysisCompatibility.state === 'supported'
                    ? 'Supported analysis path'
                    : 'CAD ready · analysis unavailable'}
                </strong>
                <p>{evaluation.analysisCompatibility.reason}</p>
                {evaluation.analysisCompatibility.state === 'unsupported' && (
                  <span>You can continue modeling, save this geometry or export it.</span>
                )}
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
        )}
      </div>
      {newSketchPlane && (
        <div
          className="cad-plane-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="cad-plane-title"
        >
          <div ref={planeDialog} className="cad-plane-dialog modal">
            <h2 id="cad-plane-title">Choose a sketch plane</h2>
            <p>
              Draw a 2D profile on a principal plane. You can extrude or revolve it after closing
              the profile.
            </p>
            <div className="cad-plane-options">
              {(['xy', 'xz', 'yz'] as const).map((plane) => (
                <button
                  className={newSketchPlane === plane ? 'active' : ''}
                  key={plane}
                  aria-pressed={newSketchPlane === plane}
                  disabled={dimension === '2d' && plane !== 'xy'}
                  onClick={() => setNewSketchPlane(plane)}
                >
                  <Square size={24} />
                  <strong>{plane.toUpperCase()}</strong>
                  <span>{plane === 'xy' ? 'Front' : plane === 'xz' ? 'Top' : 'Right'}</span>
                </button>
              ))}
            </div>
            <div className="cad-plane-actions">
              <button className="secondary" onClick={() => setNewSketchPlane(null)}>
                Cancel
              </button>
              <button
                className="primary"
                onClick={() => {
                  add({
                    id: freshId('sketch'),
                    name: `Sketch ${sketches.length + 1}`,
                    kind: 'sketch',
                    plane: newSketchPlane,
                    sketch: { points: [], entities: [], constraints: [], loops: [] },
                  });
                  setNewSketchPlane(null);
                }}
              >
                Start drawing
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
