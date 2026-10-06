import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronRight,
  Download,
  GitCompareArrows,
  Magnet,
  Play,
  Square,
  X,
} from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { primaryOperation, supportsPinn } from '../domain/project/study';
import { selectionIsCompatible } from '../domain/project/namedSelections';
import { type FieldId } from '../domain/results/fields';
import {
  inspectResultField,
  sameResultSelection,
  type OwnedResultProbe,
  type ResultFieldSelection,
} from '../domain/results/inspection';
import { displayValue, formatValue } from '../domain/units';
import { referenceLabels } from '../features/examples/references';
import {
  classifyProblem,
  validationProblem,
  warningProblem,
  type Problem,
} from '../features/problems/problems';
import ProblemsPanel from '../features/problems/ProblemsPanel';
import RunWorkspace from '../features/runs/RunWorkspace';
import { contourGradient } from '../features/viewport/contours';
const Viewport = lazy(() => import('../features/viewport/Viewport'));
import ModelTree from '../features/workbench/ModelTree';
import {
  sectionDescriptions,
  stageForSection,
  workflowStages,
} from '../features/workbench/navigation';
import ProjectWorkspaceBar from '../features/workbench/ProjectWorkspaceBar';
import StudyReadiness from '../features/workbench/StudyReadiness';
import { NumericDraftContext } from '../shared/forms/PropertyControls';
import { useModalFocus } from '../shared/ui/useModalFocus';
import Select from '../shared/ui/Select';

import PropertyInspector from '../features/project/PropertyInspector';
import CanonicalProjectWorkspace from './CanonicalProjectWorkspace';
import { isNumericalProject } from '../domain/project/document';
import { useWorkbench } from './useWorkbench';
import { createWorkbenchCommands } from './workbenchCommands';
import WorkbenchOverlays from './WorkbenchOverlays';
import type {
  ProjectDocumentSeed,
  ProjectDocuments,
  ProjectDocumentSnapshot,
} from './projectDocuments';
import type { NativeActivity } from './workbenchActivity';
import type { useTheme } from '../features/workbench/theme';
import './DocumentTabs.css';
type Props = {
  seed: ProjectDocumentSeed;
  active: boolean;
  documents: ProjectDocuments;
  nativeActivity: NativeActivity;
  appearance: ReturnType<typeof useTheme>;
  onNew: () => void;
  onOpen: () => Promise<boolean>;
  windowClosing: boolean;
  modalBlocked?: boolean;
  onAssistantOpen?: (question?: string, includeStudy?: boolean) => void;
  onRecoveryRestored: () => void;
  onRecoveryFailed: (message: string) => void;
};
export default function ProjectDocumentWorkspace({
  seed,
  active,
  documents,
  nativeActivity,
  appearance,
  onNew,
  onOpen,
  windowClosing,
  modalBlocked = false,
  onAssistantOpen,
  onRecoveryRestored,
  onRecoveryFailed,
}: Props) {
  const workbench = useWorkbench({
    seed,
    active,
    nativeActivity,
    appearance,
    windowClosing,
    onProjectActivated: () => {
      documents.focus(seed.id);
    },
    onNewProjectRequested: onNew,
    onRecoveryRestored,
    onRecoveryFailed,
  });
  const { workspaceMode, setWorkspaceMode } = workbench;
  useEffect(() => {
    if (workbench.cadVerification.workspace) setWorkspaceMode(workbench.cadVerification.workspace);
  }, [workbench.cadVerification.workspace]);
  const probeOwner = useRef<OwnedResultProbe | null>(null);
  const resultSelection = useMemo<ResultFieldSelection | null>(
    () =>
      workbench.section === 'results' && workbench.currentData && workbench.field
        ? {
            data: workbench.currentData,
            field: workbench.field,
            fieldId: workbench.fieldId,
            source: workbench.fieldSource,
          }
        : null,
    [
      workbench.section,
      workbench.currentData,
      workbench.field,
      workbench.fieldId,
      workbench.fieldSource,
    ],
  );
  const inspection = useMemo(
    () =>
      workbench.analysisProject
        ? inspectResultField(
            workbench.analysisProject,
            resultSelection,
            workbench.probe && probeOwner.current?.probe === workbench.probe
              ? probeOwner.current
              : null,
          )
        : null,
    [workbench.analysisProject, resultSelection, workbench.probe],
  );
  useEffect(() => {
    if (probeOwner.current && !sameResultSelection(probeOwner.current.selection, resultSelection)) {
      probeOwner.current = null;
      workbench.setProbe(null);
    } else if (!workbench.probe) probeOwner.current = null;
  }, [resultSelection, workbench.probe, workbench.setProbe]);
  const controller = useRef<typeof workbench | null>(null);
  controller.current = workbench;
  useEffect(() => documents.register(seed.id, controller), [documents, seed.id]);
  useEffect(() => {
    const snapshot: ProjectDocumentSnapshot = {
      documentId: seed.id,
      project: workbench.project,
      path: workbench.path,
      dirty: workbench.dirty,
      section: workbench.section,
      currentData: workbench.currentData,
      runExecution: workbench.runExecution,
      runStatus: workbench.runStatus,
      progress: workbench.progress,
      error: workbench.error,
      notice: workbench.notice,
      busy: workbench.busy,
      fileBusy: workbench.fileBusy,
      deviceBusy: workbench.deviceBusy,
      transitioning: workbench.transitioning,
      autosaveStatus: workbench.autosaveStatus,
      confirmation: workbench.confirmation,
      help: workbench.help,
      validation: workbench.validation,
      solved: workbench.solved,
      canUndo: workbench.canUndo,
      canRedo: workbench.canRedo,
      undoLabel: workbench.undoLabel,
      redoLabel: workbench.redoLabel,
      historyBlocked: workbench.historyBlocked,
      locked: workbench.locked,
      nativeLocked: workbench.nativeLocked,
      cadBusy: workbench.cadBusy,
      preparation: workbench.preparation,
      recoveryReady: workbench.recovery.ready,
      recoveryPending: workbench.recovery.pending,
      inspection,
    };
    documents.update(snapshot);
  });
  const {
    recovery,
    namedSelectionId,
    addNamedSelection,
    selectionMode,
    setSelectionMode,
    reportDraftValidity,
    project: definition,
    path,
    dirty,
    locked,
    desktop,
    validation,
    solved,
    currentData,
    isPinn,
    theme,
    save,
    autosaveEnabled,
    setAutosaveEnabled,
    autosaveStatus,
    autosaveError,
    exportFields,
    showHelp,
    leftWidth,
    section,
    constraintId,
    loadId,
    stat,
    data,
    selectSection,
    addConstraint,
    addLoad,
    resize,
    adjustPanel,
    is2D,
    execute,
    busy,
    cancelling,
    cancel,
    referenceId,
    error,
    setError,
    edges,
    setEdges,
    fieldId,
    setFieldId,
    setProbe,
    availableFields,
    fieldSource,
    chooseSource,
    field,
    selected,
    selectRegion,
    verification,
    verified,
    animate,
    deformation,
    customScale,
    setSelected,
    fileBusy,
    fileBusyLabel,
    progress,
    notice,
    metrics,
    runStatus,
    runExecution,
    runElapsed,
    runTab,
    setRunTab,
    setRunExpanded,
    runExpanded,
    confirmation,
    help,
  } = workbench;
  const [problemsOpen, setProblemsOpen] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);
  const menusBlocked =
    modalBlocked || commandsOpen || help || confirmation || workbench.recovery.prompt;
  const [sketchTarget, setSketchTarget] = useState<HTMLDivElement | null>(null);
  const project = workbench.analysisProject ?? definition;
  const editingSketch =
    definition.geometry.kind !== 'cad' &&
    section === 'geometry' &&
    project.geometry.kind === 'profile';
  const stage = stageForSection(section);
  const missingCheck = workbench.preparation.checks.find(
    (check) =>
      check.section !== section && (check.state === 'missing' || check.state === 'invalid'),
  );
  const reviewSection =
    missingCheck?.section ?? (workbench.preparation.canRun ? 'solver' : 'study');
  const canCompute = !locked && !workbench.nativeLocked && workbench.preparation.canRun && desktop;
  const canMesh = !locked && !workbench.nativeLocked && workbench.preparation.canMesh && desktop;
  useModalFocus(active && commandsOpen && !modalBlocked && !help && !confirmation, () =>
    setCommandsOpen(false),
  );
  useEffect(() => {
    if (!active || modalBlocked || help || confirmation || fileBusy) setCommandsOpen(false);
  }, [active, modalBlocked, help, confirmation, fileBusy]);
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if (
        !active ||
        modalBlocked ||
        event.defaultPrevented ||
        event.isComposing ||
        document.querySelector('.modal[aria-modal="true"]') ||
        (!event.metaKey && !event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      )
        return;
      event.preventDefault();
      if (!help && !confirmation && !fileBusy) setCommandsOpen((value) => !value);
    };
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, [active, modalBlocked, help, confirmation, fileBusy]);
  const problems = useMemo(() => {
    const items: Problem[] = [];
    if (validation) items.push(validationProblem(validation));
    if (error) items.push(classifyProblem(error));
    const orphaned = project.namedSelections.filter(
      (item) => !selectionIsCompatible(project, item),
    );
    if (orphaned.length)
      items.push({
        id: 'orphaned-selections',
        severity: 'warning',
        title: 'Named boundaries need repair',
        message: `${orphaned.length} saved boundary set(s) belong to a different geometry or dimension. They remain preserved and cannot be copied until repaired. Existing copied supports and loads are separate.`,
        section: 'selections',
        action: 'Review boundary sets',
      });
    if (data && !currentData)
      items.push({
        id: 'stale',
        severity: 'info',
        title: 'Previous fields are stale',
        message:
          'The physical inputs changed. Recompute the analysis to obtain fields for this definition.',
        section: 'solver',
        help: 'results',
        action: 'Review analysis',
      });
    for (const [index, warning] of (currentData?.manifest.warnings ?? []).entries())
      items.push(warningProblem(warning, index));
    return items;
  }, [validation, error, data, currentData]);
  useEffect(() => {
    setProblemsOpen(!!error);
  }, [error]);
  const problemAction = (problem: Problem) => {
    const invalid = document
      .getElementById(`document-panel-${seed.id}`)
      ?.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    if (invalid && (problem.id === 'validation' || problem.message.includes('numeric'))) {
      let ancestor = invalid.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      invalid.focus();
      invalid.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (problem.section) selectSection(problem.section);
    else showHelp(problem.help ?? 'overview');
  };
  const commands = createWorkbenchCommands({
    ...workbench,
    create: async () => {
      onNew();
      return false;
    },
    open: onOpen,
  });
  if (workspaceMode !== 'analysis' || !isNumericalProject(project))
    return (
      <NumericDraftContext.Provider value={reportDraftValidity}>
        <CanonicalProjectWorkspace
          workbench={workbench}
          mode={workspaceMode === 'cad' ? 'cad' : 'overview'}
          active={active}
          documentId={seed.id}
          onMode={setWorkspaceMode}
          onAnalysis={() => setWorkspaceMode('analysis')}
        />
      </NumericDraftContext.Provider>
    );
  return (
    <NumericDraftContext.Provider value={reportDraftValidity}>
      <section
        className="project-document-workspace"
        hidden={!active}
        role="tabpanel"
        id={`document-panel-${seed.id}`}
        aria-labelledby={`document-tab-${seed.id}`}
      >
        {
          <ProjectWorkspaceBar
            path={path}
            dirty={dirty}
            desktop={desktop}
            canSave={!locked && !workbench.nativeLocked && !validation && desktop}
            autosaveEnabled={autosaveEnabled}
            autosaveStatus={autosaveStatus}
            autosaveError={autosaveError}
            onAutosave={setAutosaveEnabled}
            onSave={() => void save()}
          />
        }
        <nav className="workbench-workflow" aria-label="Analysis workflow">
          <button onClick={() => setWorkspaceMode('overview')}>Project overview</button>
          {workflowStages.map((item) => (
            <button
              key={item.id}
              className={stage.id === item.id ? 'active' : ''}
              aria-current={stage.id === item.id ? 'step' : undefined}
              title={item.description}
              onClick={() => selectSection(item.entrySection)}
            >
              <span>{item.number}</span>
              {item.title}
            </button>
          ))}
          <button className="workflow-readiness" onClick={() => selectSection('study')}>
            {workbench.preparation.canRun ? <Check size={14} /> : <ChevronRight size={14} />}
            {workbench.preparation.completed}/{workbench.preparation.total} checks
          </button>
        </nav>
        <div className="workspace">
          <aside id={`model-panel-${seed.id}`} className="model-panel" style={{ width: leftWidth }}>
            <div className="model-browser">
              <ModelTree
                active={active}
                menusBlocked={menusBlocked}
                documentId={seed.id}
                project={project}
                section={section}
                constraintId={constraintId}
                loadId={loadId}
                namedSelectionId={namedSelectionId}
                hasSelection={selected.length > 0}
                locked={locked}
                cells={stat?.cells}
                solved={solved}
                stale={!!data && !currentData}
                onSection={selectSection}
                onAddSupport={() => addConstraint()}
                onAddLoad={() => addLoad()}
                onAddSelection={() => addNamedSelection()}
                onDeleteSupport={workbench.deleteSupport}
                onDeleteLoad={workbench.deleteLoad}
                onDeleteSelection={workbench.deleteSelection}
                onSelectBoundaries={setSelected}
              />
            </div>
            {definition.geometry.kind === 'cad' && section === 'geometry' ? (
              <div className="cad-source-inspector">
                <h2>Authored CAD geometry</h2>
                <p>The study uses an exact supported projection of the saved CAD definition.</p>
                <button
                  className="secondary"
                  disabled={locked}
                  onClick={() => setWorkspaceMode('cad')}
                >
                  Open CAD workspace
                </button>
                <p>Dimension changes require a compatible source geometry.</p>
              </div>
            ) : (
              <PropertyInspector
                workbench={{
                  ...workbench,
                  project,
                  sourceCad: definition.geometry.kind === 'cad',
                  openCad: () => setWorkspaceMode('cad'),
                  edit: workbench.numericalEdit,
                  sketchTarget: editingSketch ? sketchTarget : null,
                }}
                panelId={`properties-panel-${seed.id}`}
              />
            )}
          </aside>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize model and properties panel"
            aria-orientation="vertical"
            aria-controls={`model-panel-${seed.id}`}
            aria-valuemin={300}
            aria-valuemax={520}
            aria-valuenow={leftWidth}
            tabIndex={0}
            title="Drag or use the left and right arrow keys to resize"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              adjustPanel(event.key === 'ArrowRight' ? 20 : -20);
            }}
            onPointerDown={resize}
          />
          <main className="work-area">
            <div className="work-heading">
              <div className="work-context">
                <div className="work-breadcrumb">
                  <span>
                    {stage.number}. {stage.title}
                  </span>
                  <ChevronRight size={12} />
                  <span>{is2D ? '2D plane stress' : '3D solid elasticity'}</span>
                </div>
                <h1 title={sectionDescriptions[section]}>{project.name}</h1>
                <p className="work-subtitle">
                  {is2D ? 'Plane-stress model' : 'Solid model'} · Select an object to edit its
                  properties
                </p>
              </div>
              <div className="run-actions">
                {section === 'solver' && supportsPinn(project) && !busy && (
                  <button
                    className="secondary"
                    disabled={!canCompute}
                    title="Compare FEM and PINN at identical locations"
                    onClick={() => void execute('compare')}
                  >
                    <GitCompareArrows size={15} />
                    Compare FEM + PINN
                  </button>
                )}
                {busy ? (
                  <button
                    className="cancel-button"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    <Square size={13} />
                    {cancelling ? 'Stopping…' : 'Cancel'}
                  </button>
                ) : stage.id === 'prepare' ? (
                  <>
                    <button
                      className="secondary"
                      onClick={() =>
                        definition.geometry.kind === 'cad'
                          ? setWorkspaceMode('cad')
                          : selectSection('geometry')
                      }
                    >
                      Edit geometry
                    </button>
                    <button className="primary" onClick={() => selectSection(reviewSection)}>
                      Mesh & method <ArrowRight size={15} />
                    </button>
                  </>
                ) : section === 'mesh' ? (
                  <>
                    <button className="secondary" onClick={() => selectSection('solver')}>
                      Method <ArrowRight size={14} />
                    </button>
                    <button
                      className="primary"
                      disabled={!canMesh}
                      onClick={() => void execute('mesh')}
                    >
                      <Magnet size={15} /> Generate mesh
                    </button>
                  </>
                ) : section === 'results' ? (
                  <>
                    <button className="secondary" onClick={() => selectSection('solver')}>
                      New run
                    </button>
                    <button
                      className="primary"
                      disabled={locked || workbench.nativeLocked || !solved || !desktop}
                      onClick={() => void exportFields()}
                    >
                      <Download size={15} /> Export fields
                    </button>
                  </>
                ) : (
                  <button
                    className="primary"
                    disabled={!canCompute}
                    onClick={() => void execute(primaryOperation(project))}
                  >
                    <Play size={14} fill="currentColor" />
                    {isPinn ? 'Train PINN' : 'Run FEM'}
                  </button>
                )}
              </div>
            </div>
            {!desktop && (
              <div className="browser-banner">
                <span title="Saved CPU fields and history; editing physical inputs makes them stale. Use the desktop app to compute and manage native project files.">
                  {referenceId ? (
                    <>Saved CPU reference · {referenceLabels[referenceId]}</>
                  ) : (
                    'Browser preview'
                  )}{' '}
                  <small>· Desktop required to compute</small>
                </span>
              </div>
            )}
            <div className="viewport-toolbar">
              <div className="view-mode">
                <span className={solved ? 'indicator solved' : 'indicator'} />
                {solved ? 'Solution' : currentData ? 'Mesh' : 'Geometry'}
                <span className="toolbar-divider" />
                {project.geometry.kind.toUpperCase() === 'BOX' && is2D
                  ? 'RECTANGLE'
                  : project.geometry.kind.toUpperCase()}
              </div>
              <Select
                compact
                aria-label="Boundary selection mode"
                value={selectionMode}
                onChange={(value) => setSelectionMode(value as 'replace' | 'add' | 'toggle')}
                title="Click replaces; Shift adds; Ctrl/Command toggles"
                options={[
                  { value: 'replace', label: 'Replace selection' },
                  { value: 'add', label: 'Add to selection' },
                  { value: 'toggle', label: 'Toggle selection' },
                ]}
              />
              {currentData && (
                <label className="edge-toggle">
                  <input
                    type="checkbox"
                    checked={edges}
                    onChange={(event) => setEdges(event.target.checked)}
                  />
                  Mesh edges
                </label>
              )}
              {solved && (
                <Select
                  compact
                  aria-label="Displayed result field"
                  disabled={!solved || locked}
                  value={solved ? fieldId : 'geometry'}
                  options={availableFields.map((option) => ({
                    value: option.id,
                    label: option.label,
                  }))}
                  onChange={(value) => {
                    setFieldId(value as FieldId);
                    setProbe(null);
                  }}
                />
              )}
            </div>
            {currentData?.manifest.operation === 'compare' && (
              <div className="comparison-source">
                {(
                  [
                    { id: 'fem', label: 'FEM' },
                    { id: 'pinn', label: 'PINN' },
                    { id: 'difference', label: 'Absolute Δ' },
                    { id: 'relative', label: 'Relative Δ' },
                  ] as const
                ).map((source) => (
                  <button
                    key={source.id}
                    className={fieldSource === source.id ? 'active' : ''}
                    onClick={() => chooseSource(source.id)}
                  >
                    {source.label}
                  </button>
                ))}
                <span>Matched nodes and cell centroids</span>
              </div>
            )}
            {section === 'study' && (
              <StudyReadiness preparation={workbench.preparation} onSection={selectSection} />
            )}
            <div className="viewport-wrap">
              {editingSketch && <div ref={setSketchTarget} className="central-sketch" />}
              <div className={`model-viewport${editingSketch ? ' sketch-editing' : ''}`}>
                <Suspense fallback={<span role="status">Opening model view…</span>}>
                  <Viewport
                    active={active}
                    menusBlocked={menusBlocked}
                    onCondition={(kind, id) =>
                      selectSection(kind === 'constraint' ? 'constraints' : 'loads', id)
                    }
                    locked={locked}
                    onEditGeometry={() => selectSection('geometry')}
                    onAddCondition={(kind, boundaries) => {
                      if (kind === 'constraint') workbench.addConstraintOn(boundaries);
                      else workbench.addLoadOn(boundaries);
                    }}
                    onAddNamedSelection={workbench.addNamedSelectionOn}
                    selectionMode={selectionMode}
                    onSelectionChange={setSelected}
                    theme={theme}
                    project={project}
                    data={currentData}
                    field={field}
                    selected={selected}
                    onSelect={selectRegion}
                    onProbe={(probe) => {
                      probeOwner.current =
                        probe && resultSelection ? { probe, selection: resultSelection } : null;
                      setProbe(probe);
                    }}
                    onVerified={verification ? verified : undefined}
                    edges={edges}
                    source={fieldSource}
                    animate={animate}
                    deformation={deformation}
                    customScale={customScale}
                  />
                </Suspense>
              </div>
              {field && (
                <div className="contour-legend">
                  <strong>{field.label}</strong>
                  {inspection && onAssistantOpen && (
                    <button
                      className="text-button"
                      onClick={() =>
                        onAssistantOpen(
                          inspection.probe
                            ? 'Explain the selected probe value, its units and limitations using this exact result.'
                            : 'Explain the selected result field, its range and limitations using this exact result.',
                          true,
                        )
                      }
                    >
                      {inspection.probe ? 'Ask about this probe' : 'Ask about this field'}
                    </button>
                  )}
                  <span>
                    {field.association === 'cell' ? 'Element values' : 'Nodal values'} ·{' '}
                    {is2D ? 'full domain' : 'full volume'}
                  </span>
                  {field.finiteCount === 0 ? (
                    <small>No defined relative values · zero references omitted</small>
                  ) : (
                    <>
                      <div
                        className="legend-gradient"
                        style={{ background: contourGradient(field.minimum, field.maximum) }}
                      />
                      <div className="legend-labels">
                        <span>
                          {formatValue(
                            displayValue(field.minimum, field.units, project.displayUnits).value,
                          )}
                        </span>
                        <b>{displayValue(0, field.units, project.displayUnits).units}</b>
                        <span>
                          {formatValue(
                            displayValue(field.maximum, field.units, project.displayUnits).value,
                          )}
                        </span>
                      </div>
                      {field.minimum === field.maximum && <small>Constant field</small>}
                    </>
                  )}
                </div>
              )}
            </div>
            {(selected.length > 0 || ['geometry', 'constraints', 'loads'].includes(section)) && (
              <div className="selection-bar">
                <span>
                  <span className="selection-dot" />
                  {selected.length
                    ? `${selected.length} ${selected.length === 1 ? 'boundary' : 'boundaries'} selected`
                    : 'Select a boundary in the viewport'}
                </span>
                {selected.length > 0 && (
                  <>
                    <div className="selection-chips">
                      {selected.map((region) => (
                        <button key={region} onClick={() => selectRegion(region)}>
                          {region}
                          <X size={10} />
                        </button>
                      ))}
                    </div>
                    <button
                      className="text-button"
                      disabled={locked}
                      onClick={() => addConstraint()}
                    >
                      Add support
                    </button>
                    <button className="text-button" disabled={locked} onClick={() => addLoad()}>
                      Add load
                    </button>
                    <button
                      className="text-button"
                      disabled={locked || project.namedSelections.length >= 100}
                      onClick={() => addNamedSelection()}
                    >
                      <Bookmark size={13} /> Save boundary set
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Clear selection"
                      onClick={() => setSelected([])}
                    >
                      <X size={14} />
                    </button>
                  </>
                )}
              </div>
            )}
            <div className="diagnostics-strip">
              {recovery.records.length > 0 && !recovery.prompt && (
                <button className="text-button" onClick={() => recovery.setPrompt(true)}>
                  Recovery copies ({recovery.records.length})
                </button>
              )}
              {stat ? (
                <>
                  <span>
                    <b>{stat.nodes.toLocaleString()}</b> nodes
                  </span>
                  <span>
                    <b>{stat.cells.toLocaleString()}</b> cells
                  </span>
                  {section === 'mesh' && (
                    <span title={stat.qualityMetric}>
                      Minimum quality <b>{formatValue(stat.minQuality)}</b>
                    </span>
                  )}
                </>
              ) : (
                <span>{validation ? 'Inputs need attention' : 'Geometry preview'}</span>
              )}
              <span className="status-right">
                {fileBusy ? (
                  <>
                    <span className="spinner" />
                    {fileBusyLabel}
                  </>
                ) : busy ? (
                  <>
                    <span className="spinner" />
                    {progress?.stage ?? (busy === 'mesh' ? 'Starting mesher' : 'Starting solver')}
                    {progress?.progress != null && (
                      <progress max={1} value={progress.progress} aria-label="Engine progress" />
                    )}
                  </>
                ) : notice ? (
                  <>
                    <Check size={13} />
                    {notice}
                  </>
                ) : recovery.status ? (
                  <span>{recovery.status}</span>
                ) : null}
              </span>
            </div>
            {(problems.length > 0 || problemsOpen) && (
              <ProblemsPanel
                problems={problems}
                open={problemsOpen}
                onToggle={() => setProblemsOpen((value) => !value)}
                onAction={problemAction}
                onDismiss={() => setError(null)}
              />
            )}
            {(busy || (stage.id !== 'prepare' && (runExecution || currentData))) && (
              <RunWorkspace
                project={project}
                manifest={currentData?.manifest}
                recordedReference={!!referenceId}
                history={metrics}
                status={runStatus}
                execution={runExecution}
                elapsed={runElapsed}
                stage={busy ? progress?.stage : undefined}
                tab={runTab}
                onTab={(tab) => {
                  setRunTab(tab);
                  setRunExpanded(true);
                }}
                expanded={runExpanded}
                onToggle={() => setRunExpanded((value) => !value)}
              />
            )}
          </main>
        </div>
        {active && (
          <WorkbenchOverlays
            workbench={workbench}
            commandsOpen={commandsOpen && !modalBlocked}
            commands={commands}
            onCommandsClose={() => setCommandsOpen(false)}
          />
        )}
      </section>
    </NumericDraftContext.Provider>
  );
}
