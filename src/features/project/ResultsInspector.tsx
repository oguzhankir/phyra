import DetailDialog from '../../shared/ui/DetailDialog';
import { Activity, Pause, Play } from 'lucide-react';
import { displayValue, formatValue } from '../../domain/units';
import { Group, Metric, NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';

import type { ProjectInspectorModel } from './model';
export default function ResultsInspector({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    solved,
    currentData,
    data,
    locked,
    selectSection,
    project,
    deformation,
    setDeformation,
    customScale,
    setCustomScale,
    animate,
    setAnimate,
    probe,
    factor,
    is2D,
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
      <button className="secondary full" disabled={locked} onClick={() => selectSection('solver')}>
        <Play size={14} />
        Review solution method
      </button>
    </div>
  ) : (
    <>
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
          <DetailDialog title={<> Equilibrium and execution details </>}>
            <div className="inspector-disclosure-body">
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
                <code>
                  {currentData.manifest.summary.totalReaction.map(formatValue).join(', ')}
                </code>
              </div>
              <Metric
                label="Execution time"
                value={currentData.manifest.summary.elapsedSeconds}
                unit="s"
              />
              <p className="property-hint">
                {is2D
                  ? 'Extrema include the complete 2D domain.'
                  : 'Extrema include the full volume.'}{' '}
                {currentData.manifest.operation === 'train'
                  ? 'PINN reactions integrate learned support tractions. The PDE residual is the RMS of dimensionless stress divergence at interior collocation points.'
                  : 'FEM reactions use the original equilibrium equations.'}{' '}
                Stresses use tensor shear components.
              </p>
            </div>
          </DetailDialog>
          <p className="property-hint">
            {currentData.manifest.operation === 'train'
              ? 'Learned fields require independent comparison before engineering interpretation.'
              : 'Stress maxima near idealized restraints or re-entrant corners may not converge.'}
          </p>
        </Group>
      )}
      {currentData.manifest.reference && (
        <Group title="Independent Kirsch reference">
          {currentData.manifest.reference.displacement.relativeL2 === null ? (
            <p className="property-hint">
              Displacement relative L2: undefined (zero reference scale).
            </p>
          ) : (
            <Metric
              label="Displacement error · relative L2"
              value={currentData.manifest.reference.displacement.relativeL2 * 100}
              unit="%"
            />
          )}
          {currentData.manifest.reference.stress.relativeL2 === null ? (
            <p className="property-hint">Stress relative L2: undefined (zero reference scale).</p>
          ) : (
            <Metric
              label="Stress error · relative L2"
              value={currentData.manifest.reference.stress.relativeL2 * 100}
              unit="%"
            />
          )}
          <DetailDialog title={<> Reference errors and assumptions </>}>
            <div className="inspector-disclosure-body">
              <Metric
                label="Maximum displacement error"
                value={currentData.manifest.reference.displacement.maxAbsolute * factor}
                unit={project.displayUnits}
              />
              <Metric
                label="Maximum stress error"
                value={currentData.manifest.reference.stress.maxAbsolute}
                unit="Pa"
              />
              <Metric
                label="Free-hole traction RMS"
                value={currentData.manifest.reference.holeTraction.rms}
                unit="Pa"
              />
              {currentData.manifest.reference.holeTraction.relativeRms === null ? (
                <p className="property-hint">
                  Free-hole traction / remote tension: undefined (zero reference scale).
                </p>
              ) : (
                <Metric
                  label="Free-hole traction / remote tension"
                  value={currentData.manifest.reference.holeTraction.relativeRms}
                />
              )}
              <p className="property-hint">
                {currentData.manifest.reference.mapping}. These compare this FEM result with an
                independent analytical field at matching physical points. Refine the mesh to assess
                convergence; these errors do not reproduce nEPINN training or its reported
                performance.
              </p>
              <p className="property-hint">
                SI realization: coordinates in m, modulus and tension in Pa, with user-chosen
                physical thickness. The paper and linked implementation do not state the units or
                thickness.
              </p>
            </div>
          </DetailDialog>
          <p className="property-hint">
            Agreement with an independent analytical field. Refine the mesh to assess convergence.
          </p>
        </Group>
      )}
      <Group title="Deformation display">
        <label className="field-label">
          <span>Deformation</span>
          <Select
            aria-label="Deformation"
            value={deformation}
            options={[
              { value: 'off', label: 'Undeformed' },
              { value: 'actual', label: 'Actual scale · ×1' },
              { value: 'auto', label: 'Auto amplification' },
              { value: 'custom', label: 'Custom amplification' },
            ]}
            onChange={(value) => setDeformation(value as typeof deformation)}
          />
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
          Animation cycles a static solution, not a dynamic simulation.
        </p>
        <DetailDialog title={<> About deformation scale </>}>
          <div className="inspector-disclosure-body">
            <p className="property-hint">
              Amplification uses displacement and model size, independent of the contour field. Gray
              edges show the undeformed outline.
            </p>
          </div>
        </DetailDialog>
      </Group>
      <p className="property-hint">
        Export retains authoritative SI values and element stress fields.
      </p>
    </>
  );
}
