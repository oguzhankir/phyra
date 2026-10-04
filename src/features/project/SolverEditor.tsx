import { Cpu } from 'lucide-react';
import { useEffect, useState } from 'react';
import DetailDialog from '../../shared/ui/DetailDialog';
import type { Project } from '../../domain/contracts/types';
import { changeStudySolver, supportsPinn } from '../../domain/project/study';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';
import Select from '../../shared/ui/Select';

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
  const trainingConfigurationInvalid = /PINN architecture|learning rate/i.test(validation ?? '');
  const configuringPinn = pinnAvailable && isPinn;
  const [repairingSavedSettings, setRepairingSavedSettings] = useState(
    trainingConfigurationInvalid && !configuringPinn,
  );
  const showTrainingSettings =
    configuringPinn || trainingConfigurationInvalid || repairingSavedSettings;
  useEffect(() => {
    if (trainingConfigurationInvalid && !configuringPinn) setRepairingSavedSettings(true);
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
  return (
    <>
      <Group title="Solution method">
        {is2D && (
          <label className="field-label">
            <span>Physics ML formulation</span>
            <Select
              aria-label="Physics ML formulation"
              value={project.study.solver.pinn.formulation}
              options={[
                { value: 'strong-form', label: 'Strong-form residual · rectangle' },
                { value: 'potential-energy', label: 'Potential energy · rectangle / profile' },
              ]}
              onChange={(value) => {
                if (invalidDraftsRef.current.size) {
                  setError('Complete or revert the numeric input before changing formulation.');
                  return;
                }
                edit((next) => {
                  next.study.solver.pinn.formulation =
                    value as Project['study']['solver']['pinn']['formulation'];
                });
              }}
            />
          </label>
        )}
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
            ? project.study.solver.pinn.formulation === 'potential-energy'
              ? 'Minimize integrated elastic potential energy with exact supported displacement conditions. Natural conditions enter through external work.'
              : 'Learn a displacement field from elasticity equilibrium and boundary-condition residuals.'
            : `Sparse linear elasticity using ${is2D ? 'first-order triangles' : 'first-order tetrahedra'}.`}
        </p>
        {isPinn && (
          <div className="experimental-note">
            Experimental Physics ML. Training convergence is problem-dependent. Inspect losses and
            compare with the classical reference before interpreting a result.
          </div>
        )}
      </Group>
      {is2D && project.study.solver.pinn.formulation === 'potential-energy' && (
        <p className="property-hint">
          Experimental homogeneous plane stress. Prescribed components can use compatible constant
          values on finite straight exterior segments, including partial edges. Curved supports and
          conflicting values at intersections are rejected. Mesh quadrature approximates curved
          boundaries; compare with FEM and inspect the independent integration audit.
        </p>
      )}
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
          <DetailDialog
            title="Advanced training settings"
            forceOpen={trainingConfigurationInvalid || repairingSavedSettings}
          >
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
          </DetailDialog>
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
          <DetailDialog
            title={
              <>
                Compute device <small>{deviceLabel}</small>
              </>
            }
            forceOpen={!!deviceError}
          >
            <div className="inspector-disclosure-body">
              <label className="field-label">
                <span>Training device</span>
                <Select
                  aria-label="Training device"
                  value={project.study.solver.pinn.device}
                  options={[
                    { value: 'auto', label: 'Auto · CPU · float64' },
                    ...(devices?.devices
                      .filter(
                        (device) => device.available && ['cpu', 'mps', 'cuda'].includes(device.id),
                      )
                      .map((device) => ({
                        value: device.id,
                        label: `${device.label} · ${device.precision}`,
                      })) ?? []),
                    ...(requestedDevice !== 'auto' && !selectedDevice
                      ? [
                          {
                            value: requestedDevice,
                            label: `Saved preference · ${requestedDevice.toUpperCase()} (availability unconfirmed)`,
                            disabled: true,
                          },
                        ]
                      : []),
                  ]}
                  onChange={(value) =>
                    edit((next) => {
                      next.study.solver.pinn.device =
                        value as Project['study']['solver']['pinn']['device'];
                    })
                  }
                />
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
          </DetailDialog>
          <p className="property-hint method-device-note">
            Auto uses CPU float64. Available devices report their precision; each completed run
            records the device and precision actually used.
          </p>
        </>
      )}
      {is2D && !pinnAvailable && (
        <p className="property-hint">
          Select the potential-energy formulation above to train and compare profiles or spatial
          traction. The strong-form method supports rectangular force/pressure studies.
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
