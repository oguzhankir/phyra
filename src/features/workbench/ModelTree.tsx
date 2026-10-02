import {
  Activity,
  ArrowUpRight,
  Box,
  Bookmark,
  Check,
  ChevronRight,
  Layers3,
  LockKeyhole,
  Magnet,
  Plus,
  Settings2,
} from 'lucide-react';
import type { Project } from '../../domain/contracts/types';
import { prepareStudy } from '../../domain/project/readiness';
import { selectionIsCompatible } from '../../domain/project/namedSelections';
import { stageForSection, workflowStages, type Section } from './navigation';

type Props = {
  documentId?: string;
  project: Project;
  section: Section;
  constraintId: string | null;
  loadId: string | null;
  namedSelectionId: string | null;
  hasSelection: boolean;
  locked: boolean;
  cells?: number;
  solved: boolean;
  stale: boolean;
  onSection: (section: Section, id?: string) => void;
  onAddSupport: () => void;
  onAddLoad: () => void;
  onAddSelection: () => void;
};

export default function ModelTree(props: Props) {
  const { project, section, onSection } = props;
  const stagePanelId = (stageId: string) =>
    `workflow-stage-${props.documentId ? `${props.documentId}-` : ''}${stageId}-sections`;
  const is2D = project.study.dimension === '2d';
  const activeStage = stageForSection(section);
  const preparation = prepareStudy(project);
  const resultStatus = props.solved
    ? 'Current solution'
    : props.stale
      ? 'Stale · inputs changed'
      : 'No solution yet';
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
      </div>
      <nav className="model-tree workflow-stages" aria-label="Study workflow">
        {workflowStages.map((stage) => {
          const active = stage.id === activeStage.id;
          return (
            <div className={`workflow-stage-group ${active ? 'active' : ''}`} key={stage.id}>
              <button
                className={`workflow-stage ${active ? 'active' : ''}`}
                aria-current={active ? 'step' : undefined}
                aria-expanded={active}
                aria-controls={stagePanelId(stage.id)}
                title={`${stage.title}: ${stage.description}`}
                onClick={() => onSection(stage.entrySection)}
              >
                <span className="workflow-stage-number">{stage.number}</span>
                <span className="workflow-stage-copy">
                  <strong>{stage.title}</strong>
                  <small>{stage.description}</small>
                  {stage.id === 'prepare' && (
                    <span className="workflow-stage-status">
                      {preparation.canRun
                        ? 'Definition complete'
                        : `${preparation.completed}/${preparation.total} checks complete`}
                    </span>
                  )}
                  {stage.id === 'inspect' && (
                    <span className={`workflow-stage-status ${props.stale ? 'stale' : ''}`}>
                      {resultStatus}
                    </span>
                  )}
                </span>
                <ChevronRight size={13} aria-hidden="true" />
              </button>
              <div
                id={stagePanelId(stage.id)}
                className="stage-sections"
                data-stage={stage.id}
                hidden={!active}
              >
                {active && stage.id === 'prepare' && (
                  <>
                    <button
                      className={`study-root ${section === 'study' ? 'active' : ''}`}
                      onClick={() => onSection('study')}
                      aria-current={section === 'study' ? 'page' : undefined}
                    >
                      <Activity size={17} />
                      <span>
                        <strong>Study definition</strong>
                        <small>{is2D ? '2D plane stress' : '3D solid'} · Static structural</small>
                      </span>
                    </button>
                    {row(
                      'geometry',
                      <Box size={16} />,
                      'Geometry',
                      is2D
                        ? project.geometry.kind === 'profile'
                          ? 'Line / arc profile'
                          : 'Rectangle'
                        : project.geometry.kind === 'box'
                          ? 'Rectangular solid'
                          : project.geometry.kind === 'cylinder'
                            ? 'Cylinder'
                            : 'L bracket',
                    )}
                    {row(
                      'material',
                      <Layers3 size={16} />,
                      'Material',
                      project.study.material.name,
                    )}
                    <div
                      className={`tree-group-label ${section === 'selections' ? 'selected-group' : ''}`}
                    >
                      <button
                        aria-current={
                          section === 'selections' && !props.namedSelectionId ? 'page' : undefined
                        }
                        onClick={() => onSection('selections')}
                        aria-expanded={section === 'selections'}
                      >
                        <Bookmark size={15} />
                        Named boundaries <span>{project.namedSelections.length}</span>
                      </button>
                      <button
                        aria-label="Save boundary selection"
                        title="Select boundaries, then save a named set"
                        disabled={
                          props.locked ||
                          !props.hasSelection ||
                          project.namedSelections.length >= 100
                        }
                        onClick={props.onAddSelection}
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    {section === 'selections' &&
                      project.namedSelections.map((item) => (
                        <button
                          key={item.id}
                          className={`tree-row child ${section === 'selections' && props.namedSelectionId === item.id ? 'active' : ''}`}
                          aria-current={
                            section === 'selections' && props.namedSelectionId === item.id
                              ? 'page'
                              : undefined
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
                    <div
                      className={`tree-group-label ${section === 'constraints' ? 'selected-group' : ''}`}
                    >
                      <button
                        aria-current={
                          section === 'constraints' && !props.constraintId ? 'page' : undefined
                        }
                        aria-expanded={true}
                        onClick={() => onSection('constraints')}
                      >
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
                          section === 'constraints' && props.constraintId === item.id
                            ? 'page'
                            : undefined
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
                    {!project.study.constraints.length && (
                      <p className="condition-empty">Add a support, then choose its boundaries.</p>
                    )}
                    <div
                      className={`tree-group-label ${section === 'loads' ? 'selected-group' : ''}`}
                    >
                      <button
                        aria-current={section === 'loads' && !props.loadId ? 'page' : undefined}
                        aria-expanded={true}
                        onClick={() => onSection('loads')}
                      >
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
                        aria-current={
                          section === 'loads' && props.loadId === item.id ? 'page' : undefined
                        }
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
                              : item.kind === 'pressure'
                                ? 'Normal pressure'
                                : 'Spatial vector traction'}
                          </small>
                        </span>
                      </button>
                    ))}
                    {!project.study.loads.length && (
                      <p className="condition-empty">Add a load, then choose its boundaries.</p>
                    )}
                  </>
                )}
                {active && stage.id === 'solve' && (
                  <>
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
                      project.study.solver.kind === 'pinn'
                        ? 'PINN · experimental'
                        : 'Finite element method',
                    )}
                  </>
                )}
                {active && stage.id === 'inspect' && (
                  <button
                    className={`tree-row ${section === 'results' ? 'active' : ''}`}
                    aria-current={section === 'results' ? 'page' : undefined}
                    onClick={() => onSection('results')}
                  >
                    <Activity size={16} />
                    <span>
                      Results
                      <small>{resultStatus}</small>
                    </span>
                    {props.solved && <Check size={14} className="success" />}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </nav>
    </>
  );
}
