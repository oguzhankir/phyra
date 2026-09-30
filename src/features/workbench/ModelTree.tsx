import {
  Activity,
  Bookmark,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  Layers3,
  LockKeyhole,
  Magnet,
  Plus,
  Settings2,
} from 'lucide-react';
import type { Project } from '../../domain/contracts/types';
import { selectionIsCompatible } from '../../domain/project/namedSelections';
import type { ExampleId } from '../examples/projects';
import type { Section } from './navigation';

type Props = {
  project: Project;
  section: Section;
  constraintId: string | null;
  loadId: string | null;
  namedSelectionId: string | null;
  locked: boolean;
  cells?: number;
  solved: boolean;
  stale: boolean;
  onSection: (section: Section, id?: string) => void;
  onExample: (id: ExampleId) => void;
  onAddSupport: () => void;
  onAddLoad: () => void;
  onAddSelection: () => void;
  hasSelection: boolean;
};

export default function ModelTree(props: Props) {
  const { project, section, onSection } = props;
  const is2D = project.study.dimension === '2d';
  const row = (id: Section, icon: React.ReactNode, label: string, detail: string) => (
    <button
      className={`tree-row ${section === id ? 'active' : ''}`}
      aria-current={section === id ? 'page' : undefined}
      onClick={() => onSection(id)}
    >
      {icon}
      <span>
        {label}
        <small>{detail}</small>
      </span>
      <ChevronRight size={12} />
    </button>
  );
  return (
    <>
      <div className="panel-heading">
        <span>Model</span>
        <select
          aria-label="Load example"
          disabled={props.locked}
          value=""
          onChange={(event) => props.onExample(event.target.value as ExampleId)}
        >
          <option value="">Examples</option>
          <option value="plane-stress-tension">2D plane-stress tension</option>
          <option value="cantilever">3D cantilever beam</option>
          <option value="cylinder">Axial cylinder</option>
          <option value="bracket">L bracket</option>
          <option value="extension">Prescribed extension</option>
        </select>
      </div>
      <nav className="model-tree" aria-label="Engineering model">
        <button
          className={`study-root ${section === 'study' ? 'active' : ''}`}
          onClick={() => onSection('study')}
          aria-current={section === 'study' ? 'page' : undefined}
        >
          <Activity size={17} />
          <span>
            <strong>Static structural</strong>
            <small>{is2D ? '2D · Plane stress' : '3D · Solid elasticity'}</small>
          </span>
        </button>
        <div className="tree-category">Model definition</div>
        {row(
          'geometry',
          <Box size={16} />,
          'Geometry',
          is2D
            ? 'Rectangle'
            : project.geometry.kind === 'box'
              ? 'Rectangular solid'
              : project.geometry.kind === 'cylinder'
                ? 'Cylinder'
                : 'L bracket',
        )}
        {row('material', <Layers3 size={16} />, 'Material', project.study.material.name)}
        <div className={`tree-group-label ${section === 'selections' ? 'selected-group' : ''}`}>
          <button onClick={() => onSection('selections')}>
            <Bookmark size={15} />
            Named selections <span>{project.namedSelections.length}</span>
          </button>
          <button
            aria-label="Save boundary selection"
            title="Select boundaries, then save a named set"
            disabled={props.locked || !props.hasSelection || project.namedSelections.length >= 100}
            onClick={props.onAddSelection}
          >
            <Plus size={14} />
          </button>
        </div>
        {project.namedSelections.map((item) => (
          <button
            key={item.id}
            className={`tree-row child ${section === 'selections' && props.namedSelectionId === item.id ? 'active' : ''}`}
            aria-current={
              section === 'selections' && props.namedSelectionId === item.id ? 'page' : undefined
            }
            onClick={() => onSection('selections', item.id)}
            title={item.name}
          >
            <span className="tree-branch" />
            <span>
              {item.name}
              <small>
                {selectionIsCompatible(project, item)
                  ? `${item.regions.length} ${item.regions.length === 1 ? 'boundary' : 'boundaries'}`
                  : 'Repair required · geometry changed'}
              </small>
            </span>
          </button>
        ))}
        <div className="tree-category">Boundary conditions</div>
        <div className={`tree-group-label ${section === 'constraints' ? 'selected-group' : ''}`}>
          <button onClick={() => onSection('constraints')}>
            <LockKeyhole size={15} />
            Supports <span>{project.study.constraints.length}</span>
          </button>
          <button
            aria-label="Add support"
            title="Add support"
            disabled={props.locked}
            onClick={props.onAddSupport}
          >
            <Plus size={14} />
          </button>
        </div>
        {project.study.constraints.map((item) => (
          <button
            key={item.id}
            className={`tree-row child ${section === 'constraints' && props.constraintId === item.id ? 'active' : ''}`}
            aria-current={
              section === 'constraints' && props.constraintId === item.id ? 'page' : undefined
            }
            onClick={() => onSection('constraints', item.id)}
            title={item.name}
          >
            <span className="tree-branch" />
            <span>
              {item.name}
              <small>{item.regions.join(', ')}</small>
            </span>
          </button>
        ))}
        <div className={`tree-group-label ${section === 'loads' ? 'selected-group' : ''}`}>
          <button onClick={() => onSection('loads')}>
            <ArrowUpRight size={15} />
            Loads <span>{project.study.loads.length}</span>
          </button>
          <button
            aria-label="Add load"
            title="Add load"
            disabled={props.locked}
            onClick={props.onAddLoad}
          >
            <Plus size={14} />
          </button>
        </div>
        {project.study.loads.map((item) => (
          <button
            key={item.id}
            className={`tree-row child ${section === 'loads' && props.loadId === item.id ? 'active' : ''}`}
            aria-current={section === 'loads' && props.loadId === item.id ? 'page' : undefined}
            onClick={() => onSection('loads', item.id)}
            title={item.name}
          >
            <span className="tree-branch" />
            <span>
              {item.name}
              <small>
                {item.kind === 'force'
                  ? is2D
                    ? 'Total edge force'
                    : 'Total surface force'
                  : 'Normal pressure'}
              </small>
            </span>
          </button>
        ))}
        <div className="tree-category">Analysis</div>
        {row(
          'mesh',
          <Magnet size={16} />,
          'Mesh',
          props.cells
            ? `${props.cells.toLocaleString()} ${is2D ? 'triangles' : 'tetrahedra'}`
            : 'Not generated',
        )}
        {row(
          'solver',
          <Settings2 size={16} />,
          'Solution method',
          project.study.solver.kind === 'pinn' ? 'PINN · experimental' : 'Finite element method',
        )}
        <div className="tree-category">Evaluation</div>
        <button
          className={`tree-row ${section === 'results' ? 'active' : ''}`}
          aria-current={section === 'results' ? 'page' : undefined}
          onClick={() => onSection('results')}
        >
          <Activity size={16} />
          <span>
            Results
            <small>
              {props.solved
                ? 'Current solution'
                : props.stale
                  ? 'Stale · inputs changed'
                  : 'No solution yet'}
            </small>
          </span>
          {props.solved && <Check size={14} className="success" />}
        </button>
      </nav>
      <div className="model-footer">
        <span className="scope-label">Linear static elasticity</span>
        <p>
          Small strain · isotropic material
          <br />
          Local execution · authoritative SI fields
        </p>
      </div>
    </>
  );
}
