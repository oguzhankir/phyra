import { Check, ChevronDown, ChevronUp, Circle, Cpu, TriangleAlert } from 'lucide-react';
import type { Manifest, Project, TrainingMetric } from '../../types';
import { displayValue, formatValue } from '../../fields';
import TrainingPlot from './TrainingPlot';
import { presentRun, type RunExecution, type RunStatus } from '../../studyUI';

export type { RunStatus } from '../../studyUI';
export type RunTab = 'run' | 'training' | 'comparison';
type Props = {
  project: Project;
  manifest?: Manifest;
  history: TrainingMetric[];
  status: RunStatus;
  execution: RunExecution | null;
  elapsed: number;
  stage?: string;
  tab: RunTab;
  onTab: (tab: RunTab) => void;
  expanded: boolean;
  onToggle: () => void;
  recordedReference?: boolean;
};
export default function RunWorkspace({
  project: currentProject,
  manifest: retainedManifest,
  history: runHistory,
  status: runStatus,
  execution,
  elapsed,
  stage,
  tab,
  onTab,
  expanded,
  onToggle,
  recordedReference = false,
}: Props) {
  const presentation = presentRun(
    currentProject,
    retainedManifest,
    execution,
    runHistory,
    runStatus,
    elapsed,
  );
  const { project, manifest, history, operation, device, jobId } = presentation;
  const training = manifest?.training;
  const comparison = manifest?.comparison;
  const last = history.at(-1);
  const visibleStatus = presentation.status;
  const timing = training?.timings;
  const lossValue = (value?: number) => (value === undefined ? '—' : formatValue(value));
  const operationLabel =
    operation === 'train'
      ? 'PINN training'
      : operation === 'compare'
        ? 'FEM + PINN comparison'
        : operation === 'mesh'
          ? 'Meshing'
          : 'Finite element solve';
  return (
    <section className="run-workspace" aria-label="Run and training workspace">
      <div className="run-workspace-header">
        <div className="run-tabs">
          <button className={tab === 'run' ? 'active' : ''} onClick={() => onTab('run')}>
            Run overview
          </button>
          {project.study.dimension === '2d' && (
            <>
              <button
                className={tab === 'training' ? 'active' : ''}
                onClick={() => onTab('training')}
              >
                {recordedReference ? 'Stored training history' : 'Training metrics'}
                {history.length > 0 && <span className="tree-dot" />}
              </button>
              <button
                className={tab === 'comparison' ? 'active' : ''}
                onClick={() => onTab('comparison')}
              >
                Comparison
              </button>
            </>
          )}
        </div>
        <div className="run-state">
          {visibleStatus === 'completed' ? (
            <Check size={13} className="completed" />
          ) : visibleStatus === 'failed' ? (
            <TriangleAlert size={13} className="failed" />
          ) : visibleStatus === 'running' || visibleStatus === 'preparing' ? (
            <span className="spinner" />
          ) : (
            <Circle size={9} />
          )}
          <span className={visibleStatus}>
            {recordedReference && visibleStatus === 'completed'
              ? 'Recorded CPU run'
              : visibleStatus === 'idle'
                ? 'No active run'
                : visibleStatus[0].toUpperCase() + visibleStatus.slice(1)}
          </span>
          <button
            aria-label={expanded ? 'Collapse run workspace' : 'Expand run workspace'}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="run-workspace-body">
          {presentation.retainedJobId && (
            <p className="property-hint run-fact wide">
              The viewport retains the previous result: {presentation.retainedJobId}. This workspace
              describes the latest execution.
            </p>
          )}
          {tab === 'training' ? (
            <>
              <div className="run-facts">
                <div className="run-fact">
                  <span>Training step</span>
                  <strong>
                    {last ? last.step.toLocaleString() : '—'}{' '}
                    <small>
                      /{' '}
                      {(
                        training?.configuration.steps ?? project.study.solver.pinn.steps
                      ).toLocaleString()}
                    </small>
                  </strong>
                </div>
                <div className="run-fact">
                  <span>Device</span>
                  <strong>{device ?? 'Not selected yet'}</strong>
                </div>
                <div className="run-fact">
                  <span>Total loss</span>
                  <strong>{lossValue(last?.total)}</strong>
                </div>
                <div className="run-fact">
                  <span>PDE / boundary loss</span>
                  <strong>
                    {lossValue(last?.pde)} <small>/ {lossValue(last?.boundary)}</small>
                  </strong>
                </div>
                <div className="run-fact wide">
                  <span>
                    {(visibleStatus === 'running' || visibleStatus === 'preparing') && stage
                      ? stage
                      : presentation.trainingStage}
                  </span>
                  <strong>
                    {formatValue(last?.elapsed ?? timing?.trainingSeconds ?? elapsed)}{' '}
                    <small>s elapsed</small>
                  </strong>
                  {last && (visibleStatus === 'running' || visibleStatus === 'preparing') && (
                    <progress
                      className="run-progress"
                      value={last.step}
                      max={project.study.solver.pinn.steps}
                      aria-label="Training steps completed"
                    />
                  )}
                </div>
              </div>
              <TrainingPlot history={history} />
            </>
          ) : tab === 'comparison' ? (
            <>
              <div className="run-facts">
                <div className="run-fact">
                  <span>FEM solve</span>
                  <strong>
                    {comparison ? formatValue(comparison.femSeconds) : '—'} <small>s</small>
                  </strong>
                </div>
                <div className="run-fact">
                  <span>PINN training</span>
                  <strong>
                    {comparison ? formatValue(comparison.trainingSeconds) : '—'} <small>s</small>
                  </strong>
                </div>
                <div className="run-fact">
                  <span>PINN evaluation</span>
                  <strong>
                    {comparison ? formatValue(comparison.inferenceSeconds) : '—'} <small>s</small>
                  </strong>
                </div>
                <div className="run-fact">
                  <span>Training device</span>
                  <strong>{comparison?.device ?? '—'}</strong>
                </div>
                <p className="property-hint run-fact wide">
                  {comparison
                    ? comparison.mapping
                    : 'Compare solves the same 2D problem with FEM and PINN, then evaluates both at shared physical locations.'}
                </p>
              </div>
              {comparison ? (
                <div className="comparison-metrics">
                  <div className="comparison-metric">
                    <span>Displacement · relative L2</span>
                    <strong>
                      {comparison.displacement.relativeL2 === null
                        ? 'Not defined'
                        : formatValue(comparison.displacement.relativeL2)}{' '}
                      <small>dimensionless</small>
                    </strong>
                  </div>
                  <div className="comparison-metric">
                    <span>Stress · relative L2</span>
                    <strong>
                      {comparison.stress.relativeL2 === null
                        ? 'Not defined'
                        : formatValue(comparison.stress.relativeL2)}
                    </strong>
                  </div>
                  <div className="comparison-metric">
                    <span>Maximum displacement difference</span>
                    <strong>
                      {formatValue(
                        displayValue(comparison.displacement.maxAbsolute, 'm', project.displayUnits)
                          .value,
                      )}{' '}
                      <small>{project.displayUnits}</small>
                    </strong>
                  </div>
                  <div className="comparison-metric">
                    <span>Von Mises · relative L2</span>
                    <strong>
                      {comparison.vonMises.relativeL2 === null
                        ? 'Not defined'
                        : formatValue(comparison.vonMises.relativeL2)}
                    </strong>
                  </div>
                  <div className="comparison-metric">
                    <span>Maximum stress tensor difference</span>
                    <strong>
                      {formatValue(comparison.stress.maxAbsolute / 1e6)} <small>MPa</small>
                    </strong>
                  </div>
                  <div className="comparison-metric">
                    <span>Maximum von Mises difference</span>
                    <strong>
                      {formatValue(comparison.vonMises.maxAbsolute / 1e6)} <small>MPa</small>
                    </strong>
                  </div>
                  <p className="property-hint run-fact wide">
                    Relative L2 = ‖PINN − FEM‖₂ / ‖FEM‖₂ over the matched samples. Undefined for a
                    negligible reference norm. Difference measures agreement, not validated
                    accuracy.
                  </p>
                  {manifest.pinnSummary && (
                    <>
                      <div className="comparison-metric">
                        <span>Learned force imbalance</span>
                        <strong>
                          {formatValue(manifest.pinnSummary.relativeForceBalance * 100)}{' '}
                          <small>%</small>
                        </strong>
                      </div>
                      <div className="comparison-metric">
                        <span>Learned moment imbalance</span>
                        <strong>
                          {formatValue(manifest.pinnSummary.relativeMomentBalance * 100)}{' '}
                          <small>%</small>
                        </strong>
                      </div>
                      <div className="comparison-metric">
                        <span>PINN PDE residual · RMS</span>
                        <strong>{formatValue(manifest.pinnSummary.relativeResidual)}</strong>
                      </div>
                      <p className="property-hint run-fact wide">
                        {manifest.training?.residualDefinition ??
                          'RMS of dimensionless stress divergence at the interior collocation points.'}{' '}
                        Learned boundary tractions define the force and moment balance.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <div className="run-empty">
                  <strong>No comparison yet</strong>
                  <p>
                    Run Compare on a 2D plane-stress study to inspect classical and learned fields,
                    absolute differences, and runtime costs.
                  </p>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="run-facts">
                <div className="run-fact wide">
                  <span>Execution</span>
                  <strong>
                    {manifest?.operation === 'train'
                      ? 'Physics-informed neural network'
                      : manifest?.operation === 'compare'
                        ? 'FEM + PINN comparison'
                        : operationLabel}
                  </strong>
                </div>
                <div className="run-fact">
                  <span>Duration</span>
                  <strong>
                    {formatValue(presentation.duration)} <small>s</small>
                  </strong>
                </div>
                <div className="run-fact">
                  <span>Compute</span>
                  <strong>
                    <Cpu size={12} /> {device ?? 'Awaiting execution'}
                  </strong>
                </div>
                {jobId && (
                  <div className="run-fact wide">
                    <span>Run identity</span>
                    <code className="run-id">{jobId}</code>
                  </div>
                )}
              </div>
              {manifest ? (
                <div className="run-facts">
                  <div className="run-fact">
                    <span>Evaluation nodes</span>
                    <strong>{manifest.statistics.nodes.toLocaleString()}</strong>
                  </div>
                  <div className="run-fact">
                    <span>
                      {project.study.dimension === '2d' ? 'Triangular cells' : 'Tetrahedral cells'}
                    </span>
                    <strong>{manifest.statistics.cells.toLocaleString()}</strong>
                  </div>
                  <div className="run-fact wide">
                    <span>Provenance</span>
                    <strong>Study revision {manifest.revision}</strong>
                    <p className="property-hint">
                      {project.study.formulation === 'plane-stress'
                        ? '2D plane stress · explicit thickness'
                        : '3D isotropic solid'}{' '}
                      ·{' '}
                      {manifest.training
                        ? `${manifest.training.precision} training`
                        : 'float64 mechanics'}
                      <br />
                      {manifest.startedAt
                        ? new Date(manifest.startedAt).toLocaleString()
                        : 'This run belongs to the exact saved input definition.'}
                    </p>
                  </div>
                </div>
              ) : execution ? (
                <div className="run-facts">
                  <div className="run-fact wide">
                    <span>Execution input snapshot</span>
                    <strong>Study revision {project.revision}</strong>
                    <p className="property-hint">
                      {project.study.dimension === '2d' ? '2D plane stress' : '3D solid elasticity'}
                      {(operation === 'train' || operation === 'compare') && (
                        <>
                          {' '}
                          · {project.study.solver.pinn.layers} × {project.study.solver.pinn.width}{' '}
                          network · {project.study.solver.pinn.steps.toLocaleString()} training
                          steps
                          <br />
                          Requested device: {project.study.solver.pinn.device}. The engine reports
                          the device actually used when execution begins.
                        </>
                      )}
                    </p>
                    <p className="property-hint">This execution has no published result.</p>
                  </div>
                </div>
              ) : (
                <div className="run-empty">
                  <strong>A physical problem. Two solution methods.</strong>
                  <p>
                    Define the study, boundaries, and material. Use FEM for classical simulation or
                    train an experimental PINN on a 2D plane-stress problem.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
