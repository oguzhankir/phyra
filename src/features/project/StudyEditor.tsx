import { Activity, BrainCircuit } from 'lucide-react';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function StudyEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const { project, edit, is2D, chooseDimension, factor, selectSection, isPinn } = workbench;
  return (
    <>
      <Group title="Static structural study">
        <label className="field-label">
          <span>Project name</span>
          <input
            value={project.name}
            maxLength={200}
            onChange={(event) =>
              edit((next) => {
                next.name = event.target.value;
              }, false)
            }
          />
        </label>
        <label className="field-label">
          <span>Dimension</span>
        </label>
        <div className="segmented">
          <button className={is2D ? 'active' : ''} onClick={() => chooseDimension('2d')}>
            2D
          </button>
          <button className={!is2D ? 'active' : ''} onClick={() => chooseDimension('3d')}>
            3D
          </button>
        </div>
        <div className="info-card">
          <Activity size={18} />
          <div>
            <strong>{is2D ? 'Plane stress' : '3D solid elasticity'}</strong>
            <p>
              {is2D
                ? 'In-plane X/Y deformation with σzz = 0. Thickness defines the physical cross-section of the 2D domain.'
                : 'Three displacement components in a connected 3D solid, with homogeneous isotropic material.'}
            </p>
          </div>
        </div>
        {is2D && (
          <NumberInput
            label="Physical thickness"
            value={project.study.thickness * factor}
            unit={project.displayUnits}
            onChange={(value) =>
              edit((next) => {
                next.study.thickness = value / factor;
              })
            }
          />
        )}
        <p className="property-hint">
          Static, small-strain linear elasticity. Changing dimension clears incompatible boundary
          assignments.
        </p>
      </Group>
      <Group title="Solution method">
        <button className="secondary full" onClick={() => selectSection('solver')}>
          <BrainCircuit size={15} />
          {isPinn ? 'Configure experimental PINN' : 'Configure finite element method'}
        </button>
        <p className="property-hint">
          {is2D && project.geometry.kind === 'profile'
            ? 'Profiles support plane-stress FEM and experimental potential-energy PINN with compatible straight-edge prescribed components. Compare physical fields and balance.'
            : is2D
              ? 'Use FEM and PINN on the same physical definition, then compare at shared evaluation locations.'
              : 'The 3D study uses finite elements. The experimental PINN method supports 2D plane stress.'}
        </p>
      </Group>
    </>
  );
}
