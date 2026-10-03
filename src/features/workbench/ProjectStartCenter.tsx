import { ArrowRight, Box, FilePlus2, FolderOpen, GraduationCap, X } from 'lucide-react';
import { useState } from 'react';
import type { ExampleId } from '../examples/projects';
import type { ReferenceId } from '../examples/references';
import type { Project } from '../../domain/contracts/types';
import { useModalFocus } from '../../shared/ui/useModalFocus';

type Dimension = Project['study']['dimension'];
type Props = {
  desktop: boolean;
  canOpen?: boolean;
  openProjects?: { id: string; name: string; path: string | null; dirty: boolean }[];
  onContinueDocument?: (id: string) => void;
  locked: boolean;
  hasProject: boolean;
  projectName: string;
  projectPath: string | null;
  dirty: boolean;
  error: string | null;
  newProjectOpen: boolean;
  onRequestNew: () => void;
  onCancelNew: () => void;
  onContinue: () => void;
  onNew: (name: string, dimension: Dimension) => Promise<boolean>;
  onOpen: () => Promise<boolean>;
  onExample: (id: ExampleId) => Promise<boolean>;
  onReference: (id: ReferenceId) => Promise<void>;
  onHelp: () => void;
  onDismissError: () => void;
};

const examples: { id: ExampleId; title: string; detail: string; kind: string }[] = [
  { id: 'cantilever', title: 'Cantilever beam', detail: 'Fixed end · tip force', kind: '3D solid' },
  {
    id: 'plane-stress-tension',
    title: 'Plate in tension',
    detail: 'Axial force · plane stress',
    kind: '2D',
  },
  { id: 'bracket', title: 'L bracket', detail: 'Connected solid · applied load', kind: '3D solid' },
  {
    id: 'kirsch-quarter',
    title: 'Plate with a hole',
    detail: 'Quarter symmetry · SI reference',
    kind: '2D',
  },
  {
    id: 'cylinder',
    title: 'Axial cylinder',
    detail: 'Circular cross-section · axial load',
    kind: '3D solid',
  },
  {
    id: 'extension',
    title: 'Prescribed extension',
    detail: 'Displacement boundary condition',
    kind: '3D solid',
  },
];

// Illustrative geometry, not computed contours or scientific result evidence.
function ExampleGeometry({ id }: { id: ExampleId }) {
  return (
    <svg className="start-geometry" viewBox="0 0 180 100" aria-hidden="true">
      <path className="geometry-ground" d="M18 77H163M30 89L144 20M61 93L163 33M18 54L131 94" />
      {id === 'bracket' ? (
        <>
          <path className="geometry-face" d="M52 25L77 16L77 53L132 70L107 80L52 63Z" />
          <path className="geometry-side" d="M107 80L132 70V80L107 90L52 73V63Z" />
          <path className="geometry-top" d="M52 25L77 16L85 19L60 29V61L52 63Z" />
        </>
      ) : id === 'plane-stress-tension' ? (
        <>
          <path className="geometry-face" d="M44 32H136V72H44Z" />
          <path
            className="geometry-load"
            d="M18 52H37M25 47L18 52L25 57M143 52H162M155 47L162 52L155 57"
          />
        </>
      ) : id === 'kirsch-quarter' ? (
        <path className="geometry-face" d="M52 21H133V78H79A27 27 0 0 0 52 51Z" />
      ) : id === 'cylinder' ? (
        <>
          <path
            className="geometry-side"
            d="M58 35C58 23 86 17 99 25L139 58C149 68 122 87 108 79L63 48Z"
          />
          <ellipse
            className="geometry-face"
            cx="122"
            cy="68"
            rx="21"
            ry="13"
            transform="rotate(-25 122 68)"
          />
          <path className="geometry-edge" d="M59 35C62 43 79 48 91 38" />
        </>
      ) : (
        <>
          <path className="geometry-top" d="M35 34L58 23L146 56L124 67Z" />
          <path className="geometry-face" d="M35 34L124 67V81L35 48Z" />
          <path className="geometry-side" d="M124 67L146 56V70L124 81Z" />
          <path
            className="geometry-load"
            d="M29 28V53M23 31L29 28M23 37L29 34M23 43L29 40M23 49L29 46"
          />
        </>
      )}
    </svg>
  );
}

export default function ProjectStartCenter(props: Props) {
  const [name, setName] = useState('Untitled project');
  const [dimension, setDimension] = useState<Dimension>('3d');
  const [busy, setBusy] = useState(false);
  useModalFocus(props.newProjectOpen, props.onCancelNew, 'new-project');
  const run = async (action: () => Promise<unknown>) => {
    if (busy || props.locked) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  };
  const create = () => {
    props.onCancelNew();
    void run(() => props.onNew(name.trim() || 'Untitled project', dimension));
  };
  const disabled = busy || props.locked;
  return (
    <main className="project-start-center">
      <div className="start-layout">
        <aside className="start-sidebar">
          <h1>Projects</h1>
          <p className="start-subtitle">Your structural analysis workspace.</p>
          <button
            className="primary start-new-action"
            disabled={disabled}
            onClick={props.onRequestNew}
          >
            <FilePlus2 size={17} /> New project
          </button>
          <button
            className="secondary start-open-action"
            disabled={disabled || !(props.canOpen ?? props.desktop)}
            onClick={() => void run(props.onOpen)}
          >
            <FolderOpen size={17} /> Open project…
          </button>
          {!props.desktop && (
            <p className="start-preview-note">
              File access and solving are available in the desktop app.
            </p>
          )}
          <div className="start-sidebar-help">
            <GraduationCap size={18} />
            <strong>First time here?</strong>
            <p>Start with an example, then follow Prepare → Solve → Inspect.</p>
            <p>Find guides and formulations in Help · F1.</p>
          </div>
        </aside>
        <section className="start-content">
          {props.error && (
            <div className="start-error" role="alert">
              <span>{props.error}</span>
              <button aria-label="Dismiss error" onClick={props.onDismissError}>
                <X size={15} />
              </button>
            </div>
          )}
          {props.hasProject && (
            <section className="start-open-project">
              <h2>Open in this session</h2>
              {(
                props.openProjects ?? [
                  {
                    id: 'current',
                    name: props.projectName,
                    path: props.projectPath,
                    dirty: props.dirty,
                  },
                ]
              ).map((project) => (
                <button
                  key={project.id}
                  className="start-project-row"
                  onClick={() =>
                    props.onContinueDocument
                      ? props.onContinueDocument(project.id)
                      : props.onContinue()
                  }
                >
                  <FolderOpen size={22} />
                  <span>
                    <strong>{project.name}</strong>
                    <small>{project.path ?? 'Draft · choose a file location with Save'}</small>
                  </span>
                  <span className="start-project-state">
                    {project.dirty ? 'Unsaved changes' : project.path ? 'Saved' : 'Draft'}
                  </span>
                  <ArrowRight size={16} />
                </button>
              ))}
            </section>
          )}
          <div className="start-section-heading">
            <div>
              <h2>Example projects</h2>
              <p>Open an editable model to explore the workflow.</p>
            </div>
            <span>Static structural</span>
          </div>
          <div className="start-example-grid">
            {examples.map((example) => (
              <button
                className="start-example-card"
                key={example.id}
                disabled={disabled}
                onClick={() => void run(() => props.onExample(example.id))}
              >
                <ExampleGeometry id={example.id} />
                <div className="start-example-copy">
                  <div>
                    <strong>{example.title}</strong>
                    <span>{example.kind}</span>
                  </div>
                  <small>{example.detail}</small>
                </div>
              </button>
            ))}
          </div>
          <p className="start-material-note">
            Examples use illustrative material values. Review the model before solving.
          </p>
          {!props.desktop && (
            <div className="start-reference-actions">
              <Box size={16} />
              <span>Explore recorded CPU results</span>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => void run(() => props.onReference('3d'))}
              >
                3D FEM <ArrowRight size={12} />
              </button>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => void run(() => props.onReference('2d-compare'))}
              >
                2D FEM / PINN <ArrowRight size={12} />
              </button>
            </div>
          )}
        </section>
      </div>
      {props.newProjectOpen && (
        <div className="modal-backdrop">
          <form
            className="modal new-project-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-project-title"
            onSubmit={(event) => {
              event.preventDefault();
              create();
            }}
          >
            <div className="new-project-heading">
              <FilePlus2 size={21} />
              <h2 id="new-project-title">New project</h2>
              <button
                type="button"
                className="icon-button"
                aria-label="Cancel new project"
                onClick={props.onCancelNew}
              >
                <X size={17} />
              </button>
            </div>
            <label className="new-project-name">
              Project name
              <input
                value={name}
                maxLength={120}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <fieldset>
              <legend>Analysis type</legend>
              <div className="start-dimension-options">
                {(['3d', '2d'] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={dimension === value}
                    className={dimension === value ? 'selected' : ''}
                    onClick={() => setDimension(value)}
                  >
                    <strong>{value === '3d' ? '3D solid' : '2D plane stress'}</strong>
                    <small>Static structural</small>
                  </button>
                ))}
              </div>
            </fieldset>
            <p className="new-project-note">
              {props.desktop
                ? 'Save once to choose a file location. Auto-save keeps that file up to date afterward.'
                : 'You can edit this model in the preview. File access and solving require the desktop app.'}
            </p>
            <div className="modal-actions">
              <button type="button" className="secondary" onClick={props.onCancelNew}>
                Cancel
              </button>
              <button className="primary" type="submit" disabled={disabled}>
                Create project
              </button>
            </div>
          </form>
        </div>
      )}
    </main>
  );
}
