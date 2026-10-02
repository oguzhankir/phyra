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
import { useEffect, useMemo, useState } from 'react';
import { primaryOperation, supportsPinn } from '../domain/project/study';
import { selectionIsCompatible } from '../domain/project/namedSelections';
import { type FieldId } from '../domain/results/fields';
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
import Viewport from '../features/viewport/Viewport';
import ModelTree from '../features/workbench/ModelTree';
import {
  sectionDescriptions,
  sectionTitles,
  stageForSection,
  workflowStages,
} from '../features/workbench/navigation';
import WorkbenchHeader from '../features/workbench/WorkbenchHeader';
import { NumericDraftContext } from '../shared/forms/PropertyControls';
import { useModalFocus } from '../shared/ui/useModalFocus';

import PropertyInspector from '../features/project/PropertyInspector';
import { useWorkbench } from './useWorkbench';
import { createWorkbenchCommands } from './workbenchCommands';
import WorkbenchOverlays from './WorkbenchOverlays';
export default function App() {
  const workbench = useWorkbench();
  const {
    recovery,
    undo,
    redo,
    canUndo,
    canRedo,
    undoLabel,
    redoLabel,
    historyBlocked,
    namedSelectionId,
    addNamedSelection,
    selectionMode,
    setSelectionMode,
    reportDraftValidity,
    project,
    path,
    dirty,
    locked,
    desktop,
    validation,
    solved,
    currentData,
    isPinn,
    theme,
    preference,
    setPreference,
    create,
    open,
    save,
    exportFields,
    showHelp,
    leftWidth,
    rightWidth,
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
    inspectReference,
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
  const stage = stageForSection(section);
  const sections = workflowStages.flatMap((item) => item.sections);
  const nextSection = sections[sections.indexOf(section) + 1] ?? 'results';
  const canCompute = !locked && !validation && desktop;
  useModalFocus(commandsOpen && !help && !confirmation && !recovery.prompt, () =>
    setCommandsOpen(false),
  );
  useEffect(() => {
    const search = (event: KeyboardEvent) => {
      if ((!event.metaKey && !event.ctrlKey) || event.key.toLowerCase() !== 'k') return;
      event.preventDefault();
      if (!help && !confirmation && !recovery.prompt && !fileBusy)
        setCommandsOpen((value) => !value);
    };
    window.addEventListener('keydown', search);
    return () => window.removeEventListener('keydown', search);
  }, [help, confirmation, recovery.prompt, fileBusy]);
  useEffect(() => {
    if (help || confirmation || recovery.prompt || fileBusy) setCommandsOpen(false);
  }, [help, confirmation, recovery.prompt, fileBusy]);
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
    const invalid = document.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
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
  const commands = createWorkbenchCommands(workbench);
  return (
    <NumericDraftContext.Provider value={reportDraftValidity}>
      <div className="app-shell">
        <WorkbenchHeader
          canUndo={canUndo && !historyBlocked}
          canRedo={canRedo && !historyBlocked}
          undoLabel={undoLabel}
          redoLabel={redoLabel}
          onUndo={undo}
          onRedo={redo}
          name={project.name}
          path={path}
          dirty={dirty}
          locked={locked}
          canUseFiles={desktop}
          canSave={!locked && !validation && desktop}
          canExport={!locked && solved && desktop}
          device={
            currentData?.manifest.training?.device ??
            (isPinn
              ? project.study.solver.pinn.device === 'auto'
                ? 'CPU · float64 (Auto)'
                : project.study.solver.pinn.device.toUpperCase()
              : 'FEM · CPU')
          }
          theme={theme}
          preference={preference}
          onTheme={setPreference}
          onNew={() => void create()}
          onOpen={() => void open()}
          onSave={(saveAs) => void save(saveAs)}
          onExport={() => void exportFields()}
          onHelp={() => showHelp()}
          onFilesHelp={() => showHelp('files')}
          onCommands={() => setCommandsOpen(true)}
        />
        <div className="workspace">
          <aside id="workbench-model-panel" className="model-panel" style={{ width: leftWidth }}>
            <ModelTree
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
              onExample={(example) => void create(example)}
              onAddSupport={addConstraint}
              onAddLoad={addLoad}
              onAddSelection={addNamedSelection}
            />
          </aside>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize model panel"
            aria-orientation="vertical"
            aria-controls="workbench-model-panel"
            aria-valuemin={184}
            aria-valuemax={360}
            aria-valuenow={leftWidth}
            tabIndex={0}
            title="Drag or use the left and right arrow keys to resize"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              adjustPanel('left', event.key === 'ArrowRight' ? 20 : -20);
            }}
            onPointerDown={(event) => resize(event, 'left')}
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
                <h1 title={sectionDescriptions[section]}>{sectionTitles[section]}</h1>
                <p className="work-subtitle">{sectionDescriptions[section]}</p>
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
                  <button className="primary" onClick={() => selectSection(nextSection)}>
                    Next: {sectionTitles[nextSection]}
                    <ArrowRight size={15} />
                  </button>
                ) : section === 'mesh' ? (
                  <>
                    <button className="secondary" onClick={() => selectSection('solver')}>
                      Method <ArrowRight size={14} />
                    </button>
                    <button
                      className="primary"
                      disabled={!canCompute}
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
                      disabled={locked || !solved || !desktop}
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
                <div className="reference-actions">
                  <button disabled={locked} onClick={() => void inspectReference('3d')}>
                    Inspect 3D reference
                  </button>
                  <button disabled={locked} onClick={() => void inspectReference('2d-compare')}>
                    Inspect 2D comparison
                  </button>
                </div>
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
              <select
                aria-label="Boundary selection mode"
                value={selectionMode}
                onChange={(event) =>
                  setSelectionMode(event.target.value as 'replace' | 'add' | 'toggle')
                }
                title="Click replaces; Shift adds; Ctrl/Command toggles"
              >
                <option value="replace">Replace selection</option>
                <option value="add">Add to selection</option>
                <option value="toggle">Toggle selection</option>
              </select>
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
                <select
                  aria-label="Displayed result field"
                  disabled={!solved || locked}
                  value={solved ? fieldId : 'geometry'}
                  onChange={(event) => {
                    setFieldId(event.target.value as FieldId);
                    setProbe(null);
                  }}
                >
                  {availableFields.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
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
            <div className="viewport-wrap">
              <Viewport
                selectionMode={selectionMode}
                onSelectionChange={setSelected}
                theme={theme}
                project={project}
                data={currentData}
                field={field}
                selected={selected}
                onSelect={selectRegion}
                onProbe={setProbe}
                onVerified={verification ? verified : undefined}
                edges={edges}
                source={fieldSource}
                animate={animate}
                deformation={deformation}
                customScale={customScale}
              />
              {field && (
                <div className="contour-legend">
                  <strong>{field.label}</strong>
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
                    <button className="text-button" disabled={locked} onClick={addConstraint}>
                      Add support
                    </button>
                    <button className="text-button" disabled={locked} onClick={addLoad}>
                      Add load
                    </button>
                    <button
                      className="text-button"
                      disabled={locked || project.namedSelections.length >= 100}
                      onClick={addNamedSelection}
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
                ) : (
                  <>
                    <span className="status-dot" />
                    {recovery.status ?? 'Ready'}
                  </>
                )}
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
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize properties panel"
            aria-orientation="vertical"
            aria-controls="workbench-properties-panel"
            aria-valuemin={260}
            aria-valuemax={430}
            aria-valuenow={rightWidth}
            tabIndex={0}
            title="Drag or use the left and right arrow keys to resize"
            onKeyDown={(event) => {
              if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
              event.preventDefault();
              adjustPanel('right', event.key === 'ArrowLeft' ? 20 : -20);
            }}
            onPointerDown={(event) => resize(event, 'right')}
          />
          <PropertyInspector workbench={workbench} />
        </div>
        <WorkbenchOverlays
          workbench={workbench}
          commandsOpen={commandsOpen}
          commands={commands}
          onCommandsClose={() => setCommandsOpen(false)}
        />
      </div>
    </NumericDraftContext.Provider>
  );
}
