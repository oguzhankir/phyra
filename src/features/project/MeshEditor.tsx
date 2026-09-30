import { Magnet } from 'lucide-react';
import { Group, Metric, NumberInput } from '../../shared/forms/PropertyControls';

import type { ProjectInspectorModel } from './model';
export default function MeshEditor({ workbench }: { workbench: ProjectInspectorModel }) {
  const { is2D, project, factor, edit, stat, desktop, validation, execute } = workbench;
  return (
    <>
      <Group title={is2D ? 'Area discretization' : 'Volume discretization'}>
        <NumberInput
          label="Target element size"
          value={project.study.mesh.size * factor}
          unit={project.displayUnits}
          onChange={(value) =>
            edit((next) => {
              next.study.mesh.size = value / factor;
            })
          }
        />
        <p className="property-hint">
          {is2D
            ? 'Generate a real triangular area mesh for plane-stress FEM and shared field evaluation.'
            : 'Generate connected 3D tetrahedra with a target edge scale that adapts to boundaries.'}
        </p>
      </Group>
      {stat && (
        <Group title="Mesh statistics">
          <Metric label="Nodes" value={stat.nodes} />
          <Metric label={is2D ? 'Triangular cells' : 'Tetrahedral cells'} value={stat.cells} />
          {is2D ? (
            <Metric label="Boundary edges" value={stat.boundaryEdges ?? 0} />
          ) : (
            <Metric label="Surface triangles" value={stat.surfaceTriangles} />
          )}
          <Metric label="Minimum quality" value={stat.minQuality} />
          <p className="property-hint">Quality metric: {stat.qualityMetric}</p>
        </Group>
      )}
      <div className="info-card">
        <Magnet size={18} />
        <div>
          <strong>{is2D ? 'First-order triangles' : 'First-order tetrahedra'}</strong>
          <p>
            Stress is constant per element. Refine and compare meshes for bending; a visually smooth
            contour does not establish convergence.
          </p>
        </div>
      </div>
      <button
        className="secondary full"
        disabled={!desktop || !!validation}
        onClick={() => void execute('mesh')}
      >
        <Magnet size={15} />
        Generate mesh
      </button>
    </>
  );
}
