import { Check, ChevronDown, ChevronUp, Circle, Cpu, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
import type { Manifest, Project, TrainingMetric } from '../../domain/contracts/types';
import { displayValue, formatValue } from '../../domain/units';
import { supportsPinn } from '../../domain/project/study';
import TrainingPlot, { EnergyPlot } from './TrainingPlot';
import { presentRun, type RunExecution, type RunStatus } from '../../domain/execution/presentation';

export type { RunStatus } from '../../domain/execution/presentation';
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
  const bodyId = useId();
  const pinnAvailable = supportsPinn(project);
  const visibleTab = !pinnAvailable && tab !== 'run' ? 'run' : tab;
  const training = manifest?.training;
  const comparison = manifest?.comparison;
  const last = history.at(-1);
  const visibleStatus = presentation.status;
  const energy = visibleStatus === 'completed' ? training?.energy : undefined;
  const energyFormulation =
    (training?.configuration.formulation ?? project.study.solver.pinn.formulation) ===
    'potential-energy';
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
        <div className="run-tabs" role="group" aria-label="Run views">
          <button
            className={visibleTab === 'run' ? 'active' : ''}
            aria-pressed={visibleTab === 'run'}
            onClick={() => onTab('run')}
          >
            Run overview
          </button>
          {pinnAvailable && (
            <>
              <button
                className={visibleTab === 'training' ? 'active' : ''}
                aria-pressed={visibleTab === 'training'}
                aria-label={recordedReference ? 'Stored training history' : 'Training metrics'}
                title={
                  recordedReference
                    ? 'Stored training history from the recorded CPU run'
                    : 'Training metrics for the latest execution'
                }
                onClick={() => onTab('training')}
              >
                {recordedReference ? 'Training history' : 'Training metrics'}
                {history.length > 0 && <span className="tree-dot" />}
              </button>
              <button
                className={visibleTab === 'comparison' ? 'active' : ''}
                aria-pressed={visibleTab === 'comparison'}
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
          <span className={visibleStatus} role="status">
            {recordedReference && visibleStatus === 'completed'
              ? 'Recorded CPU run'
              : visibleStatus === 'idle'
                ? 'No active run'
                : visibleStatus[0].toUpperCase() + visibleStatus.slice(1)}
          </span>
          {presentation.retainedJobId && (
            <span className="run-retained-note">Previous fields retained</span>
          )}
          <button
            aria-label={expanded ? 'Collapse run workspace' : 'Expand run workspace'}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={onToggle}
          >
            {expanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>
      <div className="run-workspace-body" id={bodyId} hidden={!expanded}>
        {presentation.retainedJobId && (
          <p className="property-hint run-fact wide">
            The viewport retains the previous result: {presentation.retainedJobId}. This workspace
            describes the latest execution.
          </p>
        )}
        {visibleTab === 'training' ? (
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
                <span>{energyFormulation ? 'Total residual diagnostic' : 'Total loss'}</span>
                <strong>{lossValue(last?.total)}</strong>
              </div>
              <div className="run-fact">
                <span>
                  {energyFormulation ? 'PDE / boundary diagnostics' : 'PDE / boundary loss'}
                </span>
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
            <TrainingPlot history={history} diagnostics={energyFormulation} />
            {energyFormulation && (
              <section className="energy-objective">
                <h3>Potential-energy objective</h3>
                <p>
                  Adam minimizes signed potential energy. The residual curves above measure PDE and
                  boundary diagnostics; their total is not this optimizer’s objective.
                </p>
                {energy ? (
                  <>
                    <EnergyPlot history={energy.history} />
                    <h4>Finer integration audit · final trained model</h4>
                    <div className="energy-audit-values">
                      <span>Potential</span>
                      <b>{formatValue(energy.audit.potential * energy.physicalScale)} J</b>
                      <span>Strain energy</span>
                      <b>{formatValue(energy.audit.strain * energy.physicalScale)} J</b>
                      <span>Boundary external work</span>
                      <b>{formatValue(energy.audit.work * energy.physicalScale)} J</b>
                      <span>Relative integration difference</span>
                      <b>{formatValue(energy.relativeIntegrationDifference * 100)} %</b>
                    </div>
                    <p>
                      The audit evaluates the same final model with finer quadrature. Its difference
                      measures integration sensitivity, separately from residuals and FEM field
                      comparison; it is not a field-error bound.
                    </p>
                    <section className="run-details">
                      <h4>Energy units and quadrature</h4>
                      <p>
                        {energy.definition}. One dimensionless energy unit corresponds to{' '}
                        {formatValue(energy.physicalScale)} J.
                      </p>
                      <p>
                        Training: {energy.trainingQuadrature} ·{' '}
                        {energy.interiorPoints.toLocaleString()} interior points ·{' '}
                        {energy.boundaryPoints.toLocaleString()} boundary points.
                      </p>
                      <p>Audit: {energy.auditQuadrature}.</p>
                    </section>
                  </>
                ) : (
                  <p>
                    The signed objective history and integration audit appear after a successful
                    run.
                  </p>
                )}
              </section>
            )}
            {training && (
              <section className="heldout-residuals">
                <h3>Independent-point residuals</h3>
                {training.validation ? (
                  <>
                    <div>
                      <span>PDE</span>
                      <b>{formatValue(training.validation.pde)}</b>
                      <span>Boundary</span>
                      <b>{formatValue(training.validation.boundary)}</b>
                      <span>Displacement / traction</span>
                      <b>
                        {formatValue(training.validation.displacement)} /{' '}
                        {formatValue(training.validation.traction)}
                      </b>
                    </div>
                    <p>
                      Normalized losses at separately sampled points of this problem after
                      optimization. These are not field-accuracy bounds.
                    </p>
                  </>
                ) : (
                  <p>Not recorded in this saved run.</p>
                )}
              </section>
            )}
          </>
        ) : visibleTab === 'comparison' ? (
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
                  negligible reference norm. Difference measures agreement, not validated accuracy.
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
                <section className="run-details run-fact wide">
                  <h4>Run identity</h4>
                  <code className="run-id">{jobId}</code>
                </section>
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
                <section className="run-details run-fact wide">
                  <h4>Provenance</h4>
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
                </section>
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
                        network · {project.study.solver.pinn.steps.toLocaleString()} training steps
                        <br />
                        Requested device: {project.study.solver.pinn.device}. The engine reports the
                        device actually used when execution begins.
                      </>
                    )}
                  </p>
                  <p className="property-hint">This execution has no published result.</p>
                </div>
              </div>
            ) : (
              <div className="run-empty">
                <strong>No run yet</strong>
                <p>
                  {pinnAvailable
                    ? 'Prepare the geometry, material, supports and loads. Run FEM or train an experimental PINN on this 2D plane-stress problem.'
                    : 'Prepare the geometry, material, supports and loads, then run a finite element analysis.'}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
