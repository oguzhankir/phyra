import { Layers3 } from 'lucide-react';
import { Group, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function MaterialEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const { project, edit } = workbench;
  return (
    <>
      <Group title="Isotropic material">
        <label className="field-label">
          <span>Name</span>
          <input
            value={project.study.material.name}
            maxLength={200}
            onChange={(event) =>
              edit((next) => {
                next.study.material.name = event.target.value;
              })
            }
          />
        </label>
        <NumberInput
          label="Young’s modulus"
          value={project.study.material.young / 1e9}
          unit="GPa"
          onChange={(value) =>
            edit((next) => {
              next.study.material.young = value * 1e9;
            })
          }
        />
        <NumberInput
          label="Poisson’s ratio"
          value={project.study.material.poisson}
          onChange={(value) =>
            edit((next) => {
              next.study.material.poisson = value;
            })
          }
        />
      </Group>
      <div className="info-card">
        <Layers3 size={18} />
        <div>
          <strong>Homogeneous linear elasticity</strong>
          <p>
            One isotropic material for the entire domain. Generic example properties are editable
            demonstration inputs, not certified material data.
          </p>
        </div>
      </div>
      <p className="property-hint">
        Supported ratio: −1 &lt; ν ≤ 0.45. Near incompressibility and idealized stress singularities
        require careful interpretation.
      </p>
    </>
  );
}
