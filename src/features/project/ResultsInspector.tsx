import { Activity, ArrowDownToLine, Pause, Play } from 'lucide-react';
import { primaryOperation } from '../../domain/project/study';
import { type FieldId } from '../../domain/results/fields';
import { displayValue, formatValue } from '../../domain/units';
import { Group, Metric, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function ResultsInspector({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    solved,
    currentData,
    data,
    locked,
    validation,
    desktop,
    execute,
    project,
    isPinn,
    fieldId,
    setFieldId,
    setProbe,
    availableFields,
    deformation,
    setDeformation,
    customScale,
    setCustomScale,
    animate,
    setAnimate,
    probe,
    factor,
    is2D,
    exportFields,
  } = workbench;
  return !solved || !currentData ? (
    <div className="empty-state result-empty">
      <Activity size={30} />
      <h3>
        {data && data.manifest.operation !== 'mesh' ? 'Solution is stale' : 'No solution yet'}
      </h3>
      <p>
        {data && data.manifest.operation !== 'mesh'
          ? 'The inputs have changed. Solve again to inspect current physical fields.'
          : 'Define your material, boundary supports, and loading, then solve the model.'}
      </p>
      <button
        className="primary full"
        disabled={locked || !!validation || !desktop}
        onClick={() => void execute(primaryOperation(project))}
      >
        <Play size={14} />
        {isPinn ? 'Train PINN' : 'Run FEM'}
      </button>
    </div>
  ) : (
    <>
      <Group title="Field visualization">
        <label className="field-label">
          <span>Contour</span>
          <select
            value={fieldId}
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
        </label>
        <label className="field-label">
          <span>Deformation</span>
          <select
            value={deformation}
            onChange={(event) => setDeformation(event.target.value as typeof deformation)}
          >
            <option value="off">Undeformed</option>
            <option value="actual">Actual scale · ×1</option>
            <option value="auto">Auto amplification</option>
            <option value="custom">Custom amplification</option>
          </select>
        </label>
        {deformation === 'custom' && (
          <NumberInput
            label="Scale factor"
            value={customScale}
            physical={false}
            unit="×"
            onChange={(value) => setCustomScale(Math.max(0, value))}
          />
        )}
        <div className="animation-control">
          <button
            className="secondary full"
            aria-pressed={animate}
            onClick={() => {
              if (!animate && deformation === 'off') setDeformation('auto');
              setAnimate((value) => !value);
            }}
          >
            {animate ? <Pause size={14} /> : <Play size={14} />}
            {animate ? 'Pause static deformation' : 'Play static deformation'}
          </button>
        </div>
        <p className="property-hint">
          Amplification uses displacement and model size, independent of the contour field. Gray
          edges show the undeformed outline. Animation cycles the static field; it is not a dynamic
          simulation.
        </p>
      </Group>
      {probe && (
        <Group title="Probe">
          <div className="probe-value">
            {formatValue(displayValue(probe.value, probe.units, project.displayUnits).value)}{' '}
            <span>{displayValue(0, probe.units, project.displayUnits).units}</span>
          </div>
          <p className="property-hint">
            {probe.association === 'cell' ? 'Element' : 'Nearest surface node'} #{probe.id} ·
            boundary {probe.region}
          </p>
          {probe.association === 'node' && (
            <p className="property-hint">
              Reference position:{' '}
              {probe.position.map((value) => formatValue(value * factor)).join(', ')}{' '}
              {project.displayUnits}
            </p>
          )}
        </Group>
      )}
      {currentData.manifest.summary && (
        <Group
          title={
            currentData.manifest.operation === 'compare'
              ? 'FEM reference summary'
              : 'Physical summary'
          }
        >
          <Metric
            label="Maximum displacement"
            value={currentData.manifest.summary.maxDisplacement * factor}
            unit={project.displayUnits}
          />
          <Metric
            label="Maximum von Mises"
            value={currentData.manifest.summary.maxVonMises / 1e6}
            unit="MPa"
          />
          <Metric
            label="Strain energy"
            value={currentData.manifest.summary.strainEnergy}
            unit="J"
          />
          <Metric
            label="Force imbalance"
            value={Math.hypot(...currentData.manifest.summary.forceBalance)}
            unit="N"
          />
          <Metric
            label="Moment imbalance"
            value={Math.hypot(...currentData.manifest.summary.momentBalance)}
            unit="N·m"
          />
          <Metric
            label={
              currentData.manifest.operation === 'train'
                ? 'PINN PDE residual · RMS'
                : 'Relative free-DOF residual'
            }
            value={currentData.manifest.summary.relativeResidual}
          />
          <div className="vector-summary">
            <span>Total applied force [N]</span>
            <code>{currentData.manifest.summary.totalForce.map(formatValue).join(', ')}</code>
            <span>Total support reaction [N]</span>
            <code>{currentData.manifest.summary.totalReaction.map(formatValue).join(', ')}</code>
          </div>
          <Metric
            label="Execution time"
            value={currentData.manifest.summary.elapsedSeconds}
            unit="s"
          />
          <p className="property-hint">
            {is2D ? 'Extrema include the complete 2D domain.' : 'Extrema include the full volume.'}{' '}
            {currentData.manifest.operation === 'train'
              ? 'PINN reactions integrate learned support tractions. The PDE residual is the RMS of dimensionless stress divergence at interior collocation points.'
              : 'FEM reactions use the original equilibrium equations.'}{' '}
            Stresses use tensor shear components.
          </p>
        </Group>
      )}
      <button
        className="secondary full"
        disabled={locked || !desktop}
        onClick={() => void exportFields()}
      >
        <ArrowDownToLine size={15} />
        Export physical fields
      </button>
      <p className="property-hint">
        Export retains authoritative SI values and element stress fields. Idealized restraints and
        re-entrant corners can produce nonconvergent stress maxima.
      </p>
    </>
  );
}
