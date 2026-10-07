import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import {
  ArrowLeft,
  BookOpen,
  Box,
  Circle,
  Layers,
  Play,
  Move3D,
  Check,
  X,
  Scissors,
  Square,
  Undo2,
  Redo2,
  Upload,
  PanelLeft,
  PanelLeftClose,
  SlidersHorizontal,
  Ruler,
  ShieldCheck,
  FileOutput,
} from 'lucide-react';
import type {
  CadFeature,
  CadGeometry,
  CadSketchFeature,
} from '../../domain/contracts/project.generated';
import { numericalCadGeometry } from '../../domain/geometry/cadConversion';
import { isNumericalProject } from '../../domain/project/document';
import { featureDependencies } from '../../domain/project/document';
import { lengthFactor } from '../../domain/units';
import { NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';
import CadSketchEditor from './CadSketchEditor';
import { cadRebuildIssue, usableSketch } from './featureWorkflow';
import { useModalFocus } from '../../shared/ui/useModalFocus';
import CadViewport from './CadViewport';
import CadMeshPanel from './CadMeshPanel';
import { useCadMeshInspection } from './useCadMeshInspection';
import CadCommandPanel from './CadCommandPanel';
import CadFeatureDialog from './CadFeatureDialog';
import CadFeatureProperties from './CadFeatureProperties';
import CadToolbar, { type CadToolAction } from './CadToolbar';
import CadModelNavigator from './CadModelNavigator';
import CadDetailsPanel, { type CadDetailsSection } from './CadDetailsPanel';
import { cadFeatureLabel } from './cadLabels';
import {
  bodyInputs,
  cadId,
  componentPlacement,
  profileInputs,
  type AdvancedKind,
} from './advancedFeatures';
import { cadAuthoringGuide } from './authoringGuide';
import type { CadWorkspaceModel } from './model';
import './CadWorkspace.css';

const freshId = (prefix: string) =>
  `${prefix}_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;

export default function CadWorkspace({
  model,
  persistenceControls,
}: {
  model: CadWorkspaceModel;
  persistenceControls?: ReactNode;
}) {
  const { project, command } = model;
  const draft = command.draft;
  const evaluation = draft ? null : model.evaluation;
  const authoringLocked = model.locked || !!draft;
  const conversion = isNumericalProject(project) ? numericalCadGeometry(project) : null;
  const geometry = draft?.geometry ?? (project.geometry.kind === 'cad' ? project.geometry : null);
  const [treeOpen, setTreeOpen] = useState(true);
  const [treeWidth, setTreeWidth] = useState(238);
  const [detailsSection, setDetailsSection] = useState<CadDetailsSection | null>(null);
  const [meshOpen, setMeshOpen] = useState(false);
  const meshInspection = useCadMeshInspection(
    model.meshPreview ?? null,
    evaluation?.preview ?? null,
  );
  const layout = useRef<HTMLDivElement>(null);
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  useEffect(() => {
    const element = layout.current;
    if (!element) return;
    let constrained = false;
    const observer = new ResizeObserver(([entry]) => {
      const narrow = entry.contentRect.width <= 680;
      if (narrow && !constrained) setTreeOpen(false);
      constrained = narrow;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const [sketchDirty, setSketchDirty] = useState(false);
  const [editingSketch, setEditingSketch] = useState<string | null>(null);
  const [advancedTool, setAdvancedTool] = useState<AdvancedKind | null>(null);
  const [hiddenBodies, setHiddenBodies] = useState<string[]>([]);
  const [newSketchPlane, setNewSketchPlane] = useState<'xy' | 'xz' | 'yz' | null>(null);
  const [newSketchPurpose, setNewSketchPurpose] = useState<'profile' | 'path'>('profile');
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
    setHiddenBodies([]);
  }, [evaluation?.preview]);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [selectionKind, setSelectionKind] = useState<'face' | 'edge' | 'body'>('face');
  const [selected, setSelected] = useState<string[]>([]);
  const [exportUnits, setExportUnits] = useState<'m' | 'mm'>(project.displayUnits);
  const feature =
    geometry?.features.find((item) => item.id === (draft?.featureId ?? chosenId)) ??
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
    if (authoringLocked) return;
    if (sketchDirty || model.draftBlocked) {
      model.onError(
        'Finish the current drawing gesture or dimension entry before adding another feature.',
      );
      return;
    }
    if (model.desktop && next.kind !== 'sketch') {
      const candidate: CadGeometry = geometry
        ? structuredClone(geometry)
        : {
            kind: 'cad',
            dimension,
            features: [next],
            outputFeatureId: next.id,
            assets: [],
          };
      if (geometry) candidate.features.push(next);
      candidate.outputFeatureId = next.id;
      if (!command.start(candidate, next.id, next.name)) return;
      setDetailsSection(null);
    } else if (geometry)
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
    (draft ? command.update : model.editGeometry)((value) => {
      const item = value.features.find((next) => next.id === feature.id);
      if (item) change(item);
    });
  };
  const output = geometry?.outputFeatureId;
  const activeSketch = geometry?.features.find(
    (item): item is CadSketchFeature => item.kind === 'sketch' && item.id === editingSketch,
  );
  const inspectingMesh = meshOpen && !draft && !activeSketch;
  useEffect(() => {
    if (draft || activeSketch || detailsSection) setMeshOpen(false);
  }, [draft, activeSketch, detailsSection]);
  const defaultMeshSize = useMemo(() => {
    const positions = evaluation?.preview.positions;
    if (!positions?.length) return 0.02;
    const low = [Infinity, Infinity, Infinity],
      high = [-Infinity, -Infinity, -Infinity];
    positions.forEach((value, i) => {
      low[i % 3] = Math.min(low[i % 3], value);
      high[i % 3] = Math.max(high[i % 3], value);
    });
    return Math.max(...high.map((value, i) => value - low[i])) / 6;
  }, [evaluation?.preview]);
  const meshReason = !model.desktop
    ? 'Open the desktop app to generate an exact-solid mesh.'
    : dimension !== '3d'
      ? 'Mesh inspection requires a 3D closed solid.'
      : !evaluation
        ? 'Rebuild the current geometry before generating a mesh.'
        : evaluation.bodyCount !== 1 ||
            evaluation.preview.bodies.some((body) => body.componentPath?.length)
          ? 'Choose one closed solid. Independent assembly instances and surface shells are not supported.'
          : null;
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
  const shapes = bodyInputs(geometry?.features ?? []);
  const earlier =
    geometry?.features.slice(
      0,
      geometry.features.findIndex((item) => item.id === feature?.id),
    ) ?? [];
  const sourceSketch = usableSketch(sketches, feature?.kind === 'sketch' ? feature.id : undefined);
  const rebuildIssue = geometry ? cadRebuildIssue(geometry) : null;
  const componentOutput = evaluation?.preview.bodies.some((body) => body.componentPath?.length);
  const selectedEdges =
    evaluation?.preview.edges
      .filter((edge) => selected.includes(edge.id) && edge.identity !== 'ambiguous')
      .map((edge) => edge.id) ?? [];
  const deleteFeature = () => {
    if (!feature || !geometry || draft) return;
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
  const selectFeature = (id: string) => {
    if (draft) return;
    setChosenId(id);
    setEditingSketch(null);
    setSelected([]);
    setDetailsSection('properties');
    if (layout.current && layout.current.clientWidth <= 680) setTreeOpen(false);
  };
  const duplicateSection = () => {
    if (feature?.kind !== 'sketch' || draft) return;
    const copy = structuredClone(feature);
    copy.id = cadId('sketch');
    copy.name = `${feature.name} section`;
    const placement: Extract<CadFeature, { kind: 'transform' }> = {
      id: cadId('transform'),
      name: `${copy.name} placement`,
      kind: 'transform',
      inputId: copy.id,
      translation:
        feature.plane === 'xy'
          ? [0, 0, 0.05]
          : feature.plane === 'xz'
            ? [0, -0.05, 0]
            : [0.05, 0, 0],
      axisOrigin: [0, 0, 0],
      axisDirection: [0, 0, 1],
      angle: 0,
    };
    model.editGeometry((next) => {
      next.features.push(copy, placement);
      next.outputFeatureId = placement.id;
    });
    setChosenId(placement.id);
  };
  const placeComponent = (id: string) => {
    if (!geometry || feature?.kind !== 'assembly' || draft) return;
    const prepared = componentPlacement(geometry.features, feature, id);
    if (!prepared) return;
    const { placement, insert } = prepared;
    if (insert)
      model.editGeometry((next) => {
        const index = next.features.findIndex((item) => item.id === feature.id);
        next.features.splice(index, 0, placement);
        const assembly = next.features[index + 1];
        if (assembly.kind === 'assembly')
          assembly.components.find((item) => item.id === id)!.featureId = placement.id;
      });
    setChosenId(placement.id);
  };
  const addWithProperties = (next: CadFeature) => {
    add(next);
    if (next.kind !== 'sketch' && !model.desktop) setDetailsSection('properties');
  };
  const primaryTools: CadToolAction[] = [
    {
      id: 'sketch',
      label: 'New sketch',
      icon: Square,
      disabled: authoringLocked,
      run: () => {
        setNewSketchPurpose('profile');
        setNewSketchPlane('xy');
      },
    },
    {
      id: 'extrude',
      label: 'Extrude',
      icon: Layers,
      disabled: authoringLocked || !sourceSketch || dimension === '2d',
      reason: !sourceSketch
        ? 'Create a closed sketch profile first.'
        : 'Extend a closed profile into a solid.',
      run: () =>
        addWithProperties({
          id: freshId('extrude'),
          name: 'Extrusion',
          kind: 'extrude',
          sketchId: sourceSketch!.id,
          distance: 0.025,
        }),
    },
  ];
  const createTools: CadToolAction[] = [
    {
      id: 'box',
      label: 'Box',
      icon: Box,
      disabled: authoringLocked || dimension === '2d',
      reason: 'Create a solid with length, width and height.',
      run: () =>
        addWithProperties({
          id: freshId('box'),
          name: 'Box',
          kind: 'box',
          length: 0.1,
          width: 0.05,
          height: 0.025,
        }),
    },
    {
      id: 'cylinder',
      label: 'Cylinder',
      icon: Circle,
      disabled: authoringLocked || dimension === '2d',
      reason: 'Create a cylinder along the X axis.',
      run: () =>
        addWithProperties({
          id: freshId('cylinder'),
          name: 'Cylinder',
          kind: 'cylinder',
          radius: 0.025,
          length: 0.1,
        }),
    },
    {
      id: 'revolve',
      label: 'Revolve',
      icon: Circle,
      disabled: authoringLocked || !sourceSketch || dimension === '2d',
      reason: !sourceSketch
        ? 'Create a closed sketch profile first.'
        : 'Rotate a closed profile about an axis.',
      run: () =>
        addWithProperties({
          id: freshId('revolve'),
          name: 'Revolution',
          kind: 'revolve',
          sketchId: sourceSketch!.id,
          axisOrigin: [0, 0, 0],
          axisDirection: [1, 0, 0],
          angle: 2 * Math.PI,
        }),
    },
    {
      id: 'loft',
      label: 'Loft',
      icon: Layers,
      disabled:
        authoringLocked ||
        dimension === '2d' ||
        !geometry ||
        profileInputs(geometry.features).length < 2,
      reason: 'Connect two or more placed sketch sections.',
      run: () => setAdvancedTool('loft'),
    },
    {
      id: 'sweep',
      label: 'Sweep',
      icon: Move3D,
      disabled: authoringLocked || dimension === '2d' || !geometry,
      reason: 'Follow a connected open path with a closed profile.',
      run: () => setAdvancedTool('sweep'),
    },
    {
      id: 'assembly',
      label: 'Assembly',
      icon: Box,
      disabled:
        authoringLocked || dimension === '2d' || !geometry || !bodyInputs(geometry.features).length,
      reason: 'Group separate instances without fusing or bonding them.',
      run: () => setAdvancedTool('assembly'),
    },
  ];
  const modifyTools: CadToolAction[] = [
    {
      id: 'boolean',
      label: 'Boolean',
      icon: Scissors,
      disabled: authoringLocked || shapes.length < 2,
      reason: 'Union, cut or intersect two earlier solid sources.',
      run: () =>
        addWithProperties({
          id: freshId('boolean'),
          name: 'Boolean cut',
          kind: 'boolean',
          operation: 'cut',
          leftId: shapes.at(-2)!.id,
          rightId: shapes.at(-1)!.id,
        }),
    },
    ...(['fillet', 'chamfer'] as const).map((kind) => ({
      id: kind,
      label: kind === 'fillet' ? 'Fillet' : 'Chamfer',
      disabled: authoringLocked || !output || !evaluation?.bodyCount || componentOutput,
      reason: componentOutput
        ? `Apply ${kind}s to a source part before assembling it.`
        : kind === 'fillet'
          ? 'Round selected edges on the exact output.'
          : 'Bevel selected edges on the exact output.',
      run: () => {
        setSelectionKind('edge');
        setSelected([]);
        setEdgeTool(kind);
        setDetailsSection(null);
      },
    })),
    {
      id: 'transform',
      label: 'Move / rotate',
      icon: Move3D,
      disabled: authoringLocked || !feature,
      reason: 'Place a sketch or part with a rigid transform.',
      run: () =>
        addWithProperties({
          id: freshId('transform'),
          name: 'Move / rotate',
          kind: 'transform',
          inputId: feature!.id,
          translation: [0, 0, 0],
          axisOrigin: [0, 0, 0],
          axisDirection: [0, 0, 1],
          angle: 0,
        }),
    },
  ];
  const inspectionTools: CadToolAction[] = [
    {
      id: 'properties',
      label: 'Feature properties',
      icon: SlidersHorizontal,
      run: () => setDetailsSection('properties'),
    },
    {
      id: 'measure',
      label: 'Exact measurements',
      icon: Ruler,
      run: () => setDetailsSection('measure'),
    },
    {
      id: 'mesh',
      label: 'Mesh inspection',
      icon: Layers,
      run: () => {
        setDetailsSection(null);
        setEdgeTool(null);
        setMeshOpen(true);
        if ((layout.current?.clientWidth ?? 1200) < 1000) setTreeOpen(false);
      },
    },
    {
      id: 'analysis',
      label: 'Analysis support',
      icon: ShieldCheck,
      run: () => setDetailsSection('analysis'),
    },
    {
      id: 'export',
      label: 'Export geometry',
      icon: FileOutput,
      run: () => setDetailsSection('export'),
    },
  ];
  const modelingTool = (action: CadToolAction): CadToolAction => ({
    ...action,
    run: () => {
      setMeshOpen(false);
      action.run();
    },
  });
  const workspaceLeading = (
    <>
      <button
        className="cad-project-return"
        disabled={model.busy || sketchDirty || !!draft}
        onClick={model.onReturn}
        title="Return to project workflow"
      >
        <ArrowLeft size={15} /> Project
      </button>
      <span
        className={`cad-workspace-context ${draft || sketchDirty ? 'has-draft' : ''}`}
        role={draft || sketchDirty ? 'status' : undefined}
        title={
          activeSketch
            ? `Editing ${activeSketch.name} on the ${activeSketch.plane.toUpperCase()} plane`
            : undefined
        }
      >
        {draft
          ? 'Command draft'
          : sketchDirty
            ? 'Sketch draft'
            : activeSketch
              ? `${activeSketch.name} · ${activeSketch.plane.toUpperCase()}`
              : `${dimension.toUpperCase()} · ${project.displayUnits}`}
      </span>
    </>
  );
  const workspaceActions = (
    <div className="cad-command-actions-inline">
      {persistenceControls}
      <div className="cad-history-actions">
        <button
          className="icon-button"
          aria-label="Undo CAD edit"
          title="Undo CAD edit · Ctrl/⌘ Z"
          disabled={!model.canUndo || sketchDirty}
          onClick={model.onUndo}
        >
          <Undo2 size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="Redo CAD edit"
          title="Redo CAD edit · Shift Ctrl/⌘ Z"
          disabled={!model.canRedo || sketchDirty}
          onClick={model.onRedo}
        >
          <Redo2 size={15} />
        </button>
      </div>
      {model.busy ? (
        <button
          className="cancel-button"
          disabled={!model.cancellable}
          onClick={() => void model.cancel()}
        >
          Cancel operation
        </button>
      ) : activeSketch ? (
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
      ) : (
        <button
          className="primary"
          aria-label="Rebuild geometry"
          disabled={
            model.locked ||
            model.nativeLocked ||
            model.draftBlocked ||
            sketchDirty ||
            !geometry ||
            !!rebuildIssue ||
            !model.desktop
          }
          title={rebuildIssue ?? 'Build the exact shape from the current feature history'}
          onClick={() => {
            attemptedSource.current = geometryKey;
            void model.evaluate();
          }}
        >
          <Play size={14} /> Rebuild
        </button>
      )}
      <button className="icon-button" aria-label="CAD help" title="CAD help" onClick={model.onHelp}>
        <BookOpen size={15} />
      </button>
    </div>
  );
  return (
    <div className="cad-workspace">
      {!activeSketch && (
        <CadToolbar
          leading={workspaceLeading}
          trailing={workspaceActions}
          modifySettings={
            model.desktop ? (
              <>
                <div className="menu-divider" />
                <button
                  role="menuitemcheckbox"
                  aria-checked={autoRebuild}
                  onClick={() => setAutoRebuild(!autoRebuild)}
                >
                  {autoRebuild ? <Check size={14} /> : <span className="menu-icon" />} Auto rebuild
                </button>
              </>
            ) : undefined
          }
          navigatorOpen={treeOpen}
          onToggleNavigator={() => setTreeOpen(!treeOpen)}
          primary={primaryTools.map(modelingTool)}
          create={createTools.map(modelingTool)}
          modify={modifyTools.map(modelingTool)}
          inspect={inspectionTools.map((action) => ({
            ...action,
            disabled: !!draft,
            reason: draft ? 'Apply or cancel the active command first.' : action.reason,
          }))}
          conversion={
            conversion
              ? {
                  id: 'convert',
                  label: 'Convert current geometry to CAD',
                  disabled: authoringLocked,
                  run: () => model.replaceGeometry(conversion),
                }
              : null
          }
          importAction={{
            id: 'import',
            label: 'Import STEP',
            icon: Upload,
            disabled: model.locked || model.nativeLocked || model.draftBlocked || !model.desktop,
            run: () => {
              setMeshOpen(false);
              void model.importSource();
            },
          }}
        />
      )}
      {activeSketch && (
        <div
          className="cad-command-strip cad-sketch-command-strip"
          role="toolbar"
          aria-label="Sketch session"
        >
          {workspaceLeading}
          <button
            className="icon-button"
            aria-label={treeOpen ? 'Hide model navigator' : 'Show model navigator'}
            aria-expanded={treeOpen}
            aria-controls="cad-model-navigator"
            onClick={() => setTreeOpen(!treeOpen)}
          >
            {treeOpen ? <PanelLeftClose size={16} /> : <PanelLeft size={16} />}
          </button>
          {workspaceActions}
        </div>
      )}
      <div
        ref={layout}
        className={`cad-layout ${activeSketch ? 'editing-sketch' : ''} ${treeOpen ? '' : 'navigator-collapsed'}`}
        style={{ '--cad-tree-width': `${treeWidth}px` } as CSSProperties}
      >
        {treeOpen && (
          <>
            <CadModelNavigator
              geometry={project.geometry.kind === 'cad' ? project.geometry : null}
              selectedFeatureId={feature?.id}
              disabled={sketchDirty || authoringLocked}
              emptyContent={
                <>
                  <p className="cad-hint">
                    {isNumericalProject(project)
                      ? 'Current geometry remains in its numerical definition. Convert it explicitly to preserve its exact dimensions in CAD, or return to its current editor.'
                      : 'Start with New sketch, choose a solid from Create, or import STEP.'}
                  </p>
                  {project.geometry.kind === 'empty' && (
                    <Select
                      aria-label="New geometry dimension"
                      disabled={authoringLocked}
                      value={project.geometry.dimension}
                      options={[
                        { value: '2d', label: '2D plane geometry' },
                        { value: '3d', label: '3D solid geometry' },
                      ]}
                      onChange={(value) =>
                        !authoringLocked &&
                        model.replaceGeometry({ kind: 'empty', dimension: value as '2d' | '3d' })
                      }
                    />
                  )}
                </>
              }
              preview={evaluation?.preview ?? null}
              selectionKind={selectionKind}
              selectedEntities={selected}
              hiddenBodies={hiddenBodies}
              onSelectFeature={selectFeature}
              onEditSketch={(id) => {
                setEditingSketch(id);
                setDetailsSection(null);
              }}
              onUseOutput={(id) =>
                model.editGeometry((next) => {
                  next.outputFeatureId = id;
                })
              }
              onSelectionKind={(kind) => {
                setSelectionKind(kind);
                setSelected([]);
              }}
              onSelectEntity={(id) => chooseEntity(id, true)}
              onIsolate={() =>
                setHiddenBodies(
                  evaluation?.preview.bodies
                    .filter((body) => !selected.includes(body.id))
                    .map((body) => body.id) ?? [],
                )
              }
              onShowAll={() => setHiddenBodies([])}
              onCollapse={() => setTreeOpen(false)}
            />
            <div
              className="cad-panel-resizer"
              role="separator"
              aria-label="Resize model navigator"
              aria-orientation="vertical"
              aria-valuemin={180}
              aria-valuemax={360}
              aria-valuenow={treeWidth}
              tabIndex={0}
              onPointerDown={(event) => {
                if (event.button !== 0) return;
                resizeStart.current = { x: event.clientX, width: treeWidth };
                event.currentTarget.setPointerCapture(event.pointerId);
              }}
              onPointerMove={(event) => {
                const start = resizeStart.current;
                if (start)
                  setTreeWidth(Math.max(180, Math.min(360, start.width + event.clientX - start.x)));
              }}
              onPointerUp={() => {
                resizeStart.current = null;
              }}
              onPointerCancel={() => {
                resizeStart.current = null;
              }}
              onKeyDown={(event) => {
                if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
                event.preventDefault();
                setTreeWidth(
                  event.key === 'Home'
                    ? 180
                    : event.key === 'End'
                      ? 360
                      : Math.max(
                          180,
                          Math.min(360, treeWidth + (event.key === 'ArrowLeft' ? -16 : 16)),
                        ),
                );
              }}
            />
          </>
        )}
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
                    Review {selectedEdges.length} edges
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
                preview={
                  inspectingMesh
                    ? meshInspection.preview
                    : (draft?.preview?.preview ??
                      evaluation?.preview ??
                      model.retainedPreview ??
                      null)
                }
                inspection={inspectingMesh}
                inspectionView={meshInspection.view}
                onInspectionSelect={inspectingMesh ? meshInspection.selectEntity : undefined}
                provisional={!!draft?.preview}
                guide={!inspectingMesh && !evaluation && !draft?.preview ? authoringGuide : null}
                definitionPresent={!!geometry}
                stale={!inspectingMesh && !evaluation && !draft?.preview && !!model.retainedPreview}
                selected={inspectingMesh ? meshInspection.selected : selected}
                hiddenBodies={inspectingMesh ? [] : hiddenBodies}
                selectionKind={inspectingMesh ? 'face' : selectionKind}
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
            {model.meshBusy
              ? 'Generating a tetrahedral mesh in the local worker…'
              : inspectingMesh
                ? model.meshPreview
                  ? `${model.meshPreview.receipt.statistics.cells.toLocaleString('en')} tetrahedra · inspection only`
                  : 'Choose an element size, then Generate mesh.'
                : model.busy
                  ? 'Evaluating exact geometry in the local worker…'
                  : activeSketch
                    ? activeSketch.purpose === 'path'
                      ? 'Completed drawing gestures are saved. Finish sketch, then choose Sweep with a closed profile.'
                      : 'Completed drawing gestures are saved in the project. Finish sketch to rebuild the exact geometry.'
                    : evaluation
                      ? `${evaluation.kernel} · ${evaluation.bodyCount} bodies · ${evaluation.faceCount} faces · ${evaluation.edgeCount} edges`
                      : (rebuildIssue ??
                        'Edit feature dimensions, then rebuild to view the exact geometry.')}
            {!activeSketch && (
              <button
                className={`cad-compatibility-link ${evaluation?.analysisCompatibility.state ?? 'unchecked'}`}
                disabled={!!draft}
                onClick={() => setDetailsSection('analysis')}
              >
                {evaluation
                  ? evaluation.analysisCompatibility.state === 'supported'
                    ? 'Analysis supported'
                    : 'Analysis unavailable'
                  : draft
                    ? 'Apply to check analysis'
                    : 'Analysis not checked'}
              </button>
            )}
          </div>
          {model.error && !draft?.error && (
            <div className="cad-error" role="alert">
              <strong>Geometry needs attention</strong>
              <p>{model.error}</p>
              <button className="text-button" onClick={() => model.onError(null)}>
                Dismiss
              </button>
            </div>
          )}
        </main>
        {inspectingMesh && (
          <CadMeshPanel
            key={`${project.id}:${project.displayUnits}`}
            mesh={model.meshPreview ?? null}
            inspection={meshInspection}
            units={project.displayUnits}
            defaultSize={defaultMeshSize}
            busy={!!model.meshBusy}
            blocked={
              !!meshReason ||
              model.locked ||
              model.nativeLocked ||
              model.draftBlocked ||
              !model.inspectMesh
            }
            reason={meshReason}
            onGenerate={model.inspectMesh ?? (async () => false)}
            onCancel={model.cancel}
            onClose={() => setMeshOpen(false)}
          />
        )}
        {!inspectingMesh && !draft && !activeSketch && detailsSection && (
          <CadDetailsPanel
            section={detailsSection}
            onSection={setDetailsSection}
            onClose={() => setDetailsSection(null)}
            featureName={feature?.name}
            featureKind={feature ? cadFeatureLabel(feature) : undefined}
            evaluation={evaluation}
            units={project.displayUnits}
            exportUnits={exportUnits}
            onExportUnits={setExportUnits}
            exportDisabled={
              model.locked ||
              model.nativeLocked ||
              model.draftBlocked ||
              !evaluation ||
              !model.desktop
            }
            onExport={(format, units) => void model.exportShape(format, units)}
          >
            {feature && geometry ? (
              <CadFeatureProperties
                feature={feature}
                geometry={geometry}
                earlier={earlier}
                sketches={sketches}
                units={project.displayUnits}
                dimension={dimension}
                locked={model.locked}
                draftBlocked={model.draftBlocked || sketchDirty}
                update={update}
                dimensionInput={dimensionInput}
                onEditSketch={(id) => {
                  setEditingSketch(id);
                  setDetailsSection(null);
                }}
                onDuplicateSection={duplicateSection}
                onPlaceComponent={placeComponent}
                onDelete={deleteFeature}
              />
            ) : (
              <p className="cad-hint">
                Choose a feature in the model navigator to edit its definition.
              </p>
            )}
          </CadDetailsPanel>
        )}
        {draft && geometry && feature && (
          <CadCommandPanel command={command} onApplied={() => setDetailsSection(null)}>
            <CadFeatureProperties
              feature={feature}
              geometry={geometry}
              earlier={earlier}
              sketches={sketches}
              units={project.displayUnits}
              dimension={dimension}
              locked={model.locked}
              creating
              draftBlocked={command.inputBlocked}
              update={update}
              dimensionInput={dimensionInput}
              onEditSketch={() => {}}
              onDuplicateSection={() => {}}
              onPlaceComponent={() => {}}
              onDelete={() => {}}
            />
          </CadCommandPanel>
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
            <h2 id="cad-plane-title">Create a sketch</h2>
            <label className="field-label">
              <span>Sketch purpose</span>
              <Select
                aria-label="New sketch purpose"
                value={newSketchPurpose}
                options={[
                  { value: 'profile', label: 'Closed profile' },
                  { value: 'path', label: 'Sweep path' },
                ]}
                onChange={(value) => setNewSketchPurpose(value as 'profile' | 'path')}
              />
            </label>
            <p>
              {newSketchPurpose === 'path'
                ? 'Draw one connected open chain with Line, Polyline or Arc. Its first-created endpoint is the sweep start; place your profile perpendicular to the path there.'
                : 'Draw a closed profile on a principal plane for Extrude, Revolve or Loft. Place sections with Move / rotate.'}
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
                    ...(newSketchPurpose === 'path' ? { purpose: 'path' as const } : {}),
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
      {advancedTool && geometry && (
        <CadFeatureDialog
          kind={advancedTool}
          commandPreview={model.desktop}
          features={geometry.features}
          selectedId={feature?.id}
          onCreate={addWithProperties}
          onClose={() => setAdvancedTool(null)}
        />
      )}
    </div>
  );
}
