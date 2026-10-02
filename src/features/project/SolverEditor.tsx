import { Cpu } from 'lucide-react';
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import type { Project } from '../../domain/contracts/types';
import { changeStudySolver, supportsPinn } from '../../domain/project/study';
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
    invalidDraftsRef,
    setError,
  } = workbench;
  const pinnAvailable = supportsPinn(project);
  const advancedSettings = useRef<HTMLDetailsElement>(null);
  const deviceSettings = useRef<HTMLDetailsElement>(null);
  const trainingConfigurationInvalid = /PINN architecture|learning rate/i.test(validation ?? '');
  const configuringPinn = pinnAvailable && isPinn;
  const [repairingSavedSettings, setRepairingSavedSettings] = useState(
    trainingConfigurationInvalid && !configuringPinn,
  );
  const showTrainingSettings =
    configuringPinn || trainingConfigurationInvalid || repairingSavedSettings;
  useEffect(() => {
    if (trainingConfigurationInvalid && !configuringPinn) setRepairingSavedSettings(true);
    if (
      advancedSettings.current &&
      (trainingConfigurationInvalid ||
        advancedSettings.current.querySelector('input[aria-invalid="true"]'))
    )
      advancedSettings.current.open = true;
    if (deviceError && deviceSettings.current) deviceSettings.current.open = true;
  }, [validation, deviceError, trainingConfigurationInvalid, configuringPinn]);
  const chooseMethod = (kind: Project['study']['solver']['kind']) => {
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before changing solution method.');
      return;
    }
    edit((next) => changeStudySolver(next, kind));
  };
  const requestedDevice = project.study.solver.pinn.device;
  const selectedDevice = devices?.devices.find(
    (device) => device.available && device.id === requestedDevice,
  );
  const deviceLabel =
    requestedDevice === 'auto'
      ? 'Auto · CPU · float64'
      : selectedDevice
        ? `${selectedDevice.label} · ${selectedDevice.precision}`
        : `${requestedDevice.toUpperCase()} · availability unconfirmed`;
  const keepInvalidInputsVisible = (event: SyntheticEvent<HTMLDetailsElement>) => {
    const details = event.currentTarget;
    if (!details.open && details.querySelector('input[aria-invalid="true"]')) details.open = true;
  };
  return (
    <>
      <Group title="Solution method">
        <div className="segmented" role="group" aria-label="Solution method">
          <button
            className={!isPinn ? 'active' : ''}
            aria-pressed={!isPinn}
            onClick={() => chooseMethod('fem')}
          >
            FEM
          </button>
          {pinnAvailable && (
            <button
              className={isPinn ? 'active' : ''}
              aria-pressed={isPinn}
              onClick={() => chooseMethod('pinn')}
            >
              {isPinn ? 'PINN' : 'Configure PINN'}
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
      {showTrainingSettings && (
        <>
          {!configuringPinn && (
            <div
              className="experimental-note"
              role={trainingConfigurationInvalid ? 'alert' : 'status'}
            >
              <strong>
                {trainingConfigurationInvalid
                  ? 'Saved PINN settings need repair'
                  : 'Saved PINN settings'}
              </strong>
              <p>
                These values remain part of the project definition and must be valid before saving
                or running FEM. Correct them below; this keeps the selected solution method.
              </p>
              {trainingConfigurationInvalid && <p>{validation}</p>}
            </div>
          )}
          <Group title={configuringPinn ? 'Training budget' : 'Saved PINN settings'}>
            <NumberInput
              label="Training steps"
              value={project.study.solver.pinn.steps}
              onChange={(value) =>
                edit((next) => {
                  next.study.solver.pinn.steps = value;
                })
              }
            />
            {configuringPinn && (
              <p className="property-hint">
                More steps change the training budget; they do not guarantee accurate fields.
              </p>
            )}
          </Group>
          <details
            className="inspector-disclosure"
            ref={advancedSettings}
            open={repairingSavedSettings || undefined}
            onToggle={(event) => {
              keepInvalidInputsVisible(event);
              if (trainingConfigurationInvalid) event.currentTarget.open = true;
            }}
          >
            <summary>Advanced training settings</summary>
            <div className="inspector-disclosure-body">
              <div className="form-grid">
                {(
                  [
                    { key: 'layers', label: 'Hidden layers' },
                    { key: 'width', label: 'Layer width' },
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
                {configuringPinn
                  ? 'Tanh activation · Adam optimizer. These settings also apply to the PINN leg of Compare.'
                  : 'Editing saved settings does not enable PINN training or change the selected solution method.'}
              </p>
            </div>
          </details>
          {!configuringPinn && (
            <button
              className="secondary full"
              disabled={trainingConfigurationInvalid || invalidDraftsRef.current.size > 0}
              onClick={() => setRepairingSavedSettings(false)}
            >
              Finish repair
            </button>
          )}
        </>
      )}
      {configuringPinn && (
        <>
          <details
            className="inspector-disclosure"
            ref={deviceSettings}
            onToggle={(event) => {
              keepInvalidInputsVisible(event);
              if (deviceError) event.currentTarget.open = true;
            }}
          >
            <summary>
              Compute device <small>{deviceLabel}</small>
            </summary>
            <div className="inspector-disclosure-body">
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
                      (device) =>
                        device.available && device.id === project.study.solver.pinn.device,
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
            </div>
          </details>
          <p className="property-hint method-device-note">
            Auto uses CPU float64. Available devices report their precision; each completed run
            records the device and precision actually used.
          </p>
        </>
      )}
      {is2D && !pinnAvailable && (
        <p className="property-hint">
          Profiles and spatial traction use FEM. PINN training and FEM/PINN comparison support
          rectangular force/pressure studies.
        </p>
      )}
      {pinnAvailable && !isPinn && (
        <p className="property-hint">
          Compare evaluates FEM and PINN at shared locations. Configure PINN above to adjust the
          training settings used for comparison.
        </p>
      )}
    </>
  );
}
