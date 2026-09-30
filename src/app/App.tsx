import { Check, GitCompareArrows, Magnet, Play, Save, Square, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { primaryOperation } from '../domain/project/study';
import { type FieldId } from '../domain/results/fields';
import { displayValue, formatValue } from '../domain/units';
import { referenceLabels } from '../features/examples/references';
import HelpPanel from '../features/help/HelpPanel';
import {
  classifyProblem,
  validationProblem,
  warningProblem,
  type Problem,
} from '../features/problems/problems';
import ProblemsPanel from '../features/problems/ProblemsPanel';
import RecoveryDialog from '../features/project/RecoveryDialog';
import RunWorkspace from '../features/runs/RunWorkspace';
import { contourGradient } from '../features/viewport/contours';
import Viewport from '../features/viewport/Viewport';
import ModelTree from '../features/workbench/ModelTree';
import { sectionDescriptions, sectionTitles } from '../features/workbench/navigation';
import WorkbenchHeader from '../features/workbench/WorkbenchHeader';
import { NumericDraftContext } from '../shared/forms/PropertyControls';

import PropertyInspector from '../features/project/PropertyInspector';
import { useWorkbench } from './useWorkbench';
export default function App() {
  const workbench = useWorkbench();
  const {
    recovery,
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
    section,
    constraintId,
    loadId,
    stat,
    data,
    selectSection,
    addConstraint,
    addLoad,
    resize,
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
    setConfirmation,
    confirmResolver,
    help,
    helpContext,
    setHelp,
  } = workbench;
  const [problemsOpen, setProblemsOpen] = useState(false);
  const problems = useMemo(() => {
    const items: Problem[] = [];
    if (validation) items.push(validationProblem(validation));
    if (error) items.push(classifyProblem(error));
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
    if (error) setProblemsOpen(true);
  }, [error]);
  const problemAction = (problem: Problem) => {
    const invalid = document.querySelector<HTMLInputElement>('input[aria-invalid="true"]');
    if (invalid && (problem.id === 'validation' || problem.message.includes('numeric'))) {
      invalid.focus();
      invalid.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (problem.section) selectSection(problem.section);
    else showHelp(problem.help ?? 'overview');
  };
  return (
    <NumericDraftContext.Provider value={reportDraftValidity}>
      <div className="app-shell">
        <WorkbenchHeader
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
        />
        <div className="workspace">
          <aside className="model-panel" style={{ width: leftWidth }}>
            <ModelTree
              project={project}
              section={section}
              constraintId={constraintId}
              loadId={loadId}
              locked={locked}
              cells={stat?.cells}
              solved={solved}
              stale={!!data && !currentData}
              onSection={selectSection}
              onExample={(example) => void create(example)}
              onAddSupport={addConstraint}
              onAddLoad={addLoad}
            />
          </aside>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize model panel"
            onPointerDown={(event) => resize(event, 'left')}
          />
          <main className="work-area">
            <div className="work-heading">
              <div>
                <h1 title={sectionDescriptions[section]}>{sectionTitles[section]}</h1>
                <span className="eyebrow">
                  {is2D ? '2D PLANE STRESS' : '3D SOLID'} · STATIC STRUCTURAL
                </span>
              </div>
              <div className="run-actions">
                <button
                  className="secondary"
                  disabled={locked || !!validation || !desktop}
                  onClick={() => void execute('mesh')}
                >
                  <Magnet size={15} />
                  Mesh
                </button>
                {is2D && !busy && (
                  <button
                    className="secondary"
                    disabled={locked || !!validation || !desktop}
                    onClick={() => void execute('compare')}
                  >
                    <GitCompareArrows size={15} />
                    Compare
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
                ) : (
                  <button
                    className="primary"
                    disabled={locked || !!validation || !desktop}
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
                {is2D ? 'RECTANGLE' : project.geometry.kind.toUpperCase()}
              </div>
              <label className="edge-toggle">
                <input
                  type="checkbox"
                  checked={edges}
                  onChange={(event) => setEdges(event.target.checked)}
                />
                Mesh edges
              </label>
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
                    className="icon-button"
                    aria-label="Clear selection"
                    onClick={() => setSelected([])}
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
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
                  <span title={stat.qualityMetric}>
                    Minimum quality <b>{formatValue(stat.minQuality)}</b>
                  </span>
                </>
              ) : (
                <span>Geometry ready · generate a mesh to inspect discretization</span>
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
            <ProblemsPanel
              problems={problems}
              open={problemsOpen}
              onToggle={() => setProblemsOpen((value) => !value)}
              onAction={problemAction}
              onDismiss={() => setError(null)}
            />
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
          </main>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize properties panel"
            onPointerDown={(event) => resize(event, 'right')}
          />
          <PropertyInspector workbench={workbench} />
        </div>
        {recovery.prompt && !confirmation && !help && (
          <RecoveryDialog
            records={recovery.records}
            pending={recovery.pending}
            onRestore={(record) => void recovery.restore(record)}
            onDiscard={(record) => void recovery.discard(record)}
            onLater={() => recovery.setPrompt(false)}
          />
        )}
        {confirmation && (
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
              <div className="modal-icon">
                <Save size={23} />
              </div>
              <h2 id="unsaved-title">Save your changes?</h2>
              <p>
                Your current project has unsaved changes. Save before continuing, or discard them.
              </p>
              <div className="modal-actions">
                {(['cancel', 'discard', 'save'] as const).map((choice) => (
                  <button
                    key={choice}
                    className={choice === 'save' ? 'primary' : 'secondary'}
                    disabled={choice === 'save' && (!!validation || !desktop)}
                    onClick={() => {
                      setConfirmation(false);
                      confirmResolver.current?.(choice);
                      confirmResolver.current = null;
                    }}
                  >
                    {choice === 'save'
                      ? 'Save changes'
                      : choice === 'discard'
                        ? 'Discard'
                        : 'Cancel'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {help && !confirmation && (
          <div className="modal-backdrop help-backdrop">
            <div
              className="modal help-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Phyra help"
            >
              <HelpPanel open={help} context={helpContext} onClose={() => setHelp(false)} />
            </div>
          </div>
        )}
      </div>
    </NumericDraftContext.Provider>
  );
}
