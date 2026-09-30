import { BrainCircuit, Cpu, GitCompareArrows, Play } from 'lucide-react';
import type { Project } from '../../domain/contracts/types';
import { changeStudySolver, primaryOperation } from '../../domain/project/study';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function SolverEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const {
    isPinn,
    edit,
    is2D,
    project,
    devices,
    desktop,
    locked,
    refreshDevices,
    deviceBusy,
    deviceError,
    validation,
    execute,
  } = workbench;
  return (
    <>
      <Group title="Solution method">
        <div className="segmented">
          <button
            className={!isPinn ? 'active' : ''}
            onClick={() => edit((next) => changeStudySolver(next, 'fem'))}
          >
            FEM
          </button>
          {is2D && (
            <button
              className={isPinn ? 'active' : ''}
              onClick={() => edit((next) => changeStudySolver(next, 'pinn'))}
            >
              PINN
            </button>
          )}
        </div>
        <p className="property-hint">
          {isPinn
            ? 'Learn a displacement field from elasticity equilibrium and boundary-condition residuals.'
            : `Sparse linear elasticity using ${is2D ? 'first-order triangles' : 'first-order tetrahedra'}.`}
        </p>
        {isPinn && (
          <div className="experimental-note">
            Experimental Physics ML. Training convergence is problem-dependent. Inspect losses and
            compare with the classical reference before interpreting a result.
          </div>
        )}
      </Group>
      {is2D && (
        <>
          <Group title="PINN training configuration">
            <div className="form-grid">
              {(
                [
                  { key: 'layers', label: 'Hidden layers' },
                  { key: 'width', label: 'Layer width' },
                  { key: 'steps', label: 'Training steps' },
                  { key: 'seed', label: 'Seed' },
                ] as const
              ).map((setting) => (
                <NumberInput
                  key={setting.key}
                  label={setting.label}
                  value={project.study.solver.pinn[setting.key]}
                  onChange={(value) =>
                    edit((next) => {
                      next.study.solver.pinn[setting.key] = value;
                    })
                  }
                />
              ))}
            </div>
            <NumberInput
              label="Learning rate"
              value={project.study.solver.pinn.learningRate}
              onChange={(value) =>
                edit((next) => {
                  next.study.solver.pinn.learningRate = value;
                })
              }
            />
            <div className="form-grid">
              <NumberInput
                label="Interior samples"
                value={project.study.solver.pinn.interiorPoints}
                onChange={(value) =>
                  edit((next) => {
                    next.study.solver.pinn.interiorPoints = value;
                  })
                }
              />
              <NumberInput
                label="Boundary samples"
                value={project.study.solver.pinn.boundaryPoints}
                onChange={(value) =>
                  edit((next) => {
                    next.study.solver.pinn.boundaryPoints = value;
                  })
                }
              />
            </div>
            <p className="property-hint">
              Tanh activation · Adam optimizer. These settings also apply to the PINN leg of
              Compare.
            </p>
          </Group>
          <Group title="Compute device">
            <label className="field-label">
              <span>Training device</span>
              <select
                value={project.study.solver.pinn.device}
                onChange={(event) =>
                  edit((next) => {
                    next.study.solver.pinn.device = event.target
                      .value as Project['study']['solver']['pinn']['device'];
                  })
                }
              >
                <option value="auto">Auto · CPU · float64</option>
                {devices?.devices
                  .filter(
                    (device) => device.available && ['cpu', 'mps', 'cuda'].includes(device.id),
                  )
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.label} · {device.precision}
                    </option>
                  ))}
                {project.study.solver.pinn.device !== 'auto' &&
                  !devices?.devices.some(
                    (device) => device.available && device.id === project.study.solver.pinn.device,
                  ) && (
                    <option value={project.study.solver.pinn.device} hidden>
                      Saved preference · {project.study.solver.pinn.device.toUpperCase()}{' '}
                      (availability unconfirmed)
                    </option>
                  )}
              </select>
            </label>
            <button
              className="secondary full"
              disabled={!desktop || locked}
              onClick={() => void refreshDevices()}
            >
              <Cpu size={14} />
              {deviceBusy ? 'Detecting devices…' : 'Refresh available devices'}
            </button>
            {deviceError && (
              <p className="draft-error">
                Device list unavailable. Refresh available devices to retry.
              </p>
            )}
            {devices ? (
              <p className="property-hint">
                {devices.devices
                  .filter((device) => device.available)
                  .map((device) => `${device.label}: ${device.precision}`)
                  .join(' · ')}
                <br />
                The completed run records the device and precision actually used.
              </p>
            ) : (
              <p className="property-hint">
                Device availability is queried from the installed numerical runtime. Opening a
                project does not require a GPU.
              </p>
            )}
          </Group>
        </>
      )}
      <Group title="Execute">
        <button
          className="primary full"
          disabled={!desktop || !!validation}
          onClick={() => void execute(primaryOperation(project))}
        >
          {isPinn ? <BrainCircuit size={15} /> : <Play size={15} />}
          {isPinn ? 'Train PINN' : 'Run FEM'}
        </button>
        {is2D && (
          <button
            className="secondary full"
            style={{ marginTop: 9 }}
            disabled={!desktop || !!validation}
            onClick={() => void execute('compare')}
          >
            <GitCompareArrows size={15} />
            Compare FEM + PINN
          </button>
        )}
      </Group>
    </>
  );
}
