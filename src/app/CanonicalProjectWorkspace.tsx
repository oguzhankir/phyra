import { useState } from 'react';
import {
  ArrowRight,
  Box,
  CheckCircle2,
  Circle,
  FileInput,
  Layers,
  LockKeyhole,
  Play,
} from 'lucide-react';
import type { Workbench } from './useWorkbench';
import { isNumericalProject } from '../domain/project/document';
import CadWorkspace from '../features/cad/CadWorkspace';
import ProjectWorkspaceBar from '../features/workbench/ProjectWorkspaceBar';
import WorkbenchOverlays from './WorkbenchOverlays';
import './CanonicalProjectWorkspace.css';

export default function CanonicalProjectWorkspace({
  workbench,
  mode,
  active,
  documentId,
  onMode,
  onAnalysis,
}: {
  workbench: Workbench;
  mode: 'overview' | 'cad';
  active: boolean;
  documentId: string;
  onMode: (mode: 'overview' | 'cad') => void;
  onAnalysis: () => void;
}) {
  const w = workbench,
    numerical = !!w.analysisProject,
    empty = w.project.geometry.kind === 'empty';
  const [creatingStudy, setCreatingStudy] = useState(false);
  const compatibility = w.cad.current?.receipt.analysisCompatibility;
  const canCreateStudy = !w.project.study && compatibility?.state === 'supported';
  const geometryLabel = empty
    ? 'No geometry'
    : w.project.geometry.kind === 'cad'
      ? `${w.project.geometry.features.length} CAD features`
      : w.project.geometry.kind === 'profile'
        ? 'Exact plane profile'
        : w.project.geometry.kind;
  const evaluated = numerical || !!w.cad.evaluation;
  return (
    <section
      className="project-document-workspace canonical-project"
      hidden={!active}
      role="tabpanel"
      id={`document-panel-${documentId}`}
      aria-labelledby={`document-tab-${documentId}`}
    >
      <ProjectWorkspaceBar
        path={w.path}
        dirty={w.dirty}
        desktop={w.desktop}
        canSave={
          !w.locked && !w.nativeLocked && !w.validation && w.desktop && !w.invalidDraftLabels.length
        }
        autosaveEnabled={w.autosaveEnabled}
        autosaveStatus={w.autosaveStatus}
        autosaveError={w.autosaveError}
        onAutosave={w.setAutosaveEnabled}
        onSave={() => void w.save()}
      />
      {mode === 'cad' ? (
        <CadWorkspace
          model={{
            project: w.project,
            desktop: w.desktop,
            locked: w.locked,
            nativeLocked: w.nativeLocked,
            draftBlocked: w.invalidDraftLabels.length > 0,
            dark: w.theme === 'dark',
            busy: w.cad.busy,
            cancellable: w.cad.cancellable,
            command: w.cad.command,
            error: w.error,
            evaluation: w.cad.evaluation,
            retainedPreview: w.cad.retainedPreview,
            sketchSolve: w.cad.sketchSolve,
            solveSketch: w.cad.solveSketch,
            editGeometry: (change) =>
              w.edit((next) => {
                if (next.geometry.kind === 'cad') change(next.geometry);
              }),
            replaceGeometry: (geometry) =>
              w.edit((next) => {
                next.geometry = structuredClone(geometry);
              }),
            importSource: w.cad.importSource,
            evaluate: w.cad.evaluate,
            cancel: w.cad.cancel,
            exportShape: w.cad.exportShape,
            reportDraft: w.reportDraftValidity,
            onError: w.setError,
            onReturn: () => onMode('overview'),
            onRendered: w.cadVerification.rendered,
            onHelp: () => w.showHelp('cad'),
            onUndo: w.undo,
            onRedo: w.redo,
            canUndo: w.canUndo && !w.historyBlocked,
            canRedo: w.canRedo && !w.historyBlocked,
          }}
        />
      ) : (
        <main className="project-overview">
          <header className="overview-heading">
            <div>
              <p>Project workflow</p>
              <h1>{w.project.name}</h1>
              <span>Create geometry, prepare a supported study, then inspect its results.</span>
            </div>
            <button className="primary" disabled={w.locked} onClick={() => onMode('cad')}>
              <Box size={16} /> Open CAD workspace
            </button>
          </header>
          <label className="overview-project-name">
            <span>Project name</span>
            <input
              aria-label="Project name"
              maxLength={200}
              disabled={w.locked}
              value={w.project.name}
              onChange={(event) =>
                w.edit((next) => {
                  next.name = event.target.value;
                }, false)
              }
            />
          </label>
          <div className="overview-stages">
            <article className={`overview-stage ${evaluated ? 'complete' : ''}`}>
              <div className="overview-stage-icon">
                <Box size={24} />
              </div>
              <div className="overview-stage-step">01 · Geometry</div>
              <h2>{empty ? 'Start your geometry' : geometryLabel}</h2>
              <p>
                {empty
                  ? 'Draw in a dedicated workspace or import a STEP source. No material, mesh or analysis has been created.'
                  : numerical
                    ? 'This project uses a verified primitive or plane-profile analysis path.'
                    : evaluated
                      ? 'Exact geometry evaluated by the local CAD kernel. Analysis compatibility is checked separately.'
                      : 'CAD definition saved. Evaluate it to validate the exact shape.'}
              </p>
              <span className="overview-stage-state">
                {evaluated ? <CheckCircle2 size={14} /> : <Circle size={14} />}{' '}
                {empty ? 'Not started' : evaluated ? 'Geometry available' : 'Evaluation required'}
              </span>
              <button className="secondary" disabled={w.locked} onClick={() => onMode('cad')}>
                Edit geometry <ArrowRight size={14} />
              </button>
              {isNumericalProject(w.project) && (
                <button
                  className="text-button"
                  onClick={() => {
                    w.selectSection('geometry');
                    onAnalysis();
                  }}
                >
                  Open current geometry editor
                </button>
              )}
            </article>
            <article className={!numerical ? 'overview-stage blocked' : 'overview-stage'}>
              <div className="overview-stage-icon">
                <Layers size={24} />
              </div>
              <div className="overview-stage-step">02 · Preparation</div>
              <h2>Materials & conditions</h2>
              <p>
                {numerical
                  ? 'Assign elastic properties, supports and loads to this study’s stable boundaries.'
                  : empty
                    ? 'Create geometry before preparing a study.'
                    : compatibility?.state === 'unsupported'
                      ? compatibility.reason
                      : canCreateStudy
                        ? 'The exact geometry has a supported analysis path. Create a study with your material and mesh definitions.'
                        : 'Evaluate the exact geometry to check its available analysis paths.'}
              </p>
              <span className="overview-stage-state">
                {numerical ? <Circle size={14} /> : <LockKeyhole size={14} />}{' '}
                {numerical
                  ? `${w.preparation.completed}/${w.preparation.total} definition checks`
                  : canCreateStudy
                    ? 'Supported geometry · study not created'
                    : compatibility?.state === 'unsupported'
                      ? 'Saved CAD · analysis unsupported'
                      : 'Geometry evaluation required'}
              </span>
              {canCreateStudy ? (
                <button
                  className="secondary"
                  disabled={w.locked}
                  onClick={() => setCreatingStudy(true)}
                >
                  Create analysis <ArrowRight size={14} />
                </button>
              ) : (
                <button
                  className="secondary"
                  disabled={!numerical || w.locked}
                  onClick={() => {
                    w.selectSection('material');
                    onAnalysis();
                  }}
                >
                  Prepare study <ArrowRight size={14} />
                </button>
              )}
            </article>
            <article className={!numerical ? 'overview-stage blocked' : 'overview-stage'}>
              <div className="overview-stage-icon">
                <Play size={24} />
              </div>
              <div className="overview-stage-step">03 · Analysis</div>
              <h2>Mesh & method</h2>
              <p>
                {numerical
                  ? 'Generate a mesh and configure a supported FEM or experimental PINN method.'
                  : 'Meshing and numerical methods stay locked until this exact geometry has a supported study.'}
              </p>
              <span className="overview-stage-state">
                {numerical ? <Circle size={14} /> : <LockKeyhole size={14} />}{' '}
                {numerical
                  ? w.preparation.canRun
                    ? 'Definition ready'
                    : 'Preparation required'
                  : 'Geometry compatibility required'}
              </span>
              <button
                className="secondary"
                disabled={!numerical || w.locked}
                onClick={() => {
                  w.selectSection('mesh');
                  onAnalysis();
                }}
              >
                Open analysis <ArrowRight size={14} />
              </button>
            </article>
            <article className={!w.solved ? 'overview-stage blocked' : 'overview-stage complete'}>
              <div className="overview-stage-icon">
                <FileInput size={24} />
              </div>
              <div className="overview-stage-step">04 · Results</div>
              <h2>Inspect & export</h2>
              <p>
                {w.solved && !numerical
                  ? 'Saved current fields are preserved. Reevaluate the exact CAD source to prepare their geometry view before inspecting them.'
                  : 'Review current physical fields, numerical diagnostics and SI exports. Geometry evaluation does not produce scientific fields.'}
              </p>
              <span className="overview-stage-state">
                {w.solved ? <CheckCircle2 size={14} /> : <LockKeyhole size={14} />}{' '}
                {w.solved
                  ? numerical
                    ? 'Current result available'
                    : 'Saved fields · geometry view required'
                  : 'No current result'}
              </span>
              <button
                className="secondary"
                disabled={!w.solved || !numerical || w.locked}
                onClick={() => {
                  w.selectSection('results');
                  onAnalysis();
                }}
              >
                Inspect results <ArrowRight size={14} />
              </button>
            </article>
          </div>
          {creatingStudy && canCreateStudy && (
            <CreateStudyForm
              dimension={compatibility!.dimension}
              locked={w.locked}
              onCancel={() => setCreatingStudy(false)}
              onCreate={(material, thickness, size) => {
                w.createStudy(material, thickness, size);
                setCreatingStudy(false);
                onAnalysis();
              }}
            />
          )}
          {w.error && (
            <div className="overview-message error" role="alert">
              {w.error}
            </div>
          )}
          {w.notice && (
            <div className="overview-message" role="status">
              {w.notice}
            </div>
          )}
          {!w.desktop && (
            <p className="overview-browser-note">
              Browser preview · the desktop app is required for native CAD import, evaluation,
              project files and computation.
            </p>
          )}
        </main>
      )}
      {active && (
        <WorkbenchOverlays
          workbench={w}
          commandsOpen={false}
          commands={[]}
          onCommandsClose={() => {}}
        />
      )}
    </section>
  );
}

function CreateStudyForm({
  dimension,
  locked,
  onCancel,
  onCreate,
}: {
  dimension: '2d' | '3d';
  locked: boolean;
  onCancel: () => void;
  onCreate: (
    material: { name: string; young: number; poisson: number },
    thickness: number,
    size: number,
  ) => void;
}) {
  const [name, setName] = useState(''),
    [young, setYoung] = useState(''),
    [poisson, setPoisson] = useState(''),
    [thickness, setThickness] = useState(''),
    [mesh, setMesh] = useState('');
  const e = Number(young),
    nu = Number(poisson),
    t = dimension === '2d' ? Number(thickness) / 1000 : 1,
    size = Number(mesh) / 1000;
  const valid =
    name.trim().length > 0 &&
    young.trim() !== '' &&
    Number.isFinite(e) &&
    e > 0 &&
    poisson.trim() !== '' &&
    Number.isFinite(nu) &&
    nu > -1 &&
    nu < 0.5 &&
    Number.isFinite(t) &&
    t > 0 &&
    mesh.trim() !== '' &&
    Number.isFinite(size) &&
    size > 0;
  return (
    <form
      className="overview-study-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onCreate({ name: name.trim(), young: e, poisson: nu }, t, size);
      }}
    >
      <h2>Create a {dimension === '2d' ? 'plane-stress' : 'solid elasticity'} study</h2>
      <p>Supply elastic properties for the intended material. Supports and loads start empty.</p>
      <fieldset disabled={locked}>
        <label>
          Material name
          <input
            value={name}
            maxLength={200}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </label>
        <label>
          Young’s modulus · Pa
          <input
            inputMode="decimal"
            value={young}
            onChange={(event) => setYoung(event.target.value)}
            required
          />
        </label>
        <label>
          Poisson’s ratio
          <input
            inputMode="decimal"
            value={poisson}
            onChange={(event) => setPoisson(event.target.value)}
            required
          />
        </label>
        {dimension === '2d' && (
          <label>
            Study thickness · mm
            <input
              inputMode="decimal"
              value={thickness}
              onChange={(event) => setThickness(event.target.value)}
              required
            />
          </label>
        )}
        <label>
          Target mesh size · mm
          <input
            inputMode="decimal"
            value={mesh}
            onChange={(event) => setMesh(event.target.value)}
            required
          />
        </label>
        <div>
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={!valid}>
            Create study
          </button>
        </div>
      </fieldset>
    </form>
  );
}
