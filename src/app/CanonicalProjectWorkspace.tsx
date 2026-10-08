import { useEffect, useState } from 'react';
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
import type { ProjectDefinition } from '../domain/contracts/types';
import type { Workbench } from './useWorkbench';
import { isNumericalProject } from '../domain/project/document';
import CreateStudyDialog from '../features/project/CreateStudyDialog';
import CadWorkspace from '../features/cad/CadWorkspace';
import ProjectWorkspaceBar from '../features/workbench/ProjectWorkspaceBar';
import WorkbenchOverlays from './WorkbenchOverlays';
import './CanonicalProjectWorkspace.css';

export function canPrepareCadStudy(
  project: ProjectDefinition,
  hasVerifiedCandidate: boolean,
  sourceNeedsReview = false,
) {
  return (
    hasVerifiedCandidate &&
    (!project.study || project.study.domain?.kind !== 'cad-solid' || sourceNeedsReview)
  );
}

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
  const [creatingStudy, setCreatingStudy] = useState<{
    kind: 'adapter' | 'cad-solid';
    source: string;
    dimension: '2d' | '3d';
  } | null>(null);
  const compatibility = w.cad.current?.receipt.analysisCompatibility;
  const canCreateStudy =
    !w.project.study && (compatibility?.state === 'supported' || !!w.cadStudyCandidate);
  const canPrepareCad = canPrepareCadStudy(w.project, !!w.cadStudyCandidate, !!w.cadSourceError);
  const source = studyPreparationSourceKey(w.project);
  const validDraft =
    !!creatingStudy &&
    creatingStudy.source === source &&
    (creatingStudy.kind === 'cad-solid'
      ? canPrepareCad
      : !w.project.study && compatibility?.state === 'supported');
  useEffect(() => {
    if (!active || !validDraft || w.help || w.confirmation) setCreatingStudy(null);
  }, [active, validDraft, w.help, w.confirmation]);
  const openStudy = (kind: 'adapter' | 'cad-solid') => {
    const dimension = kind === 'cad-solid' ? '3d' : compatibility?.dimension;
    if (dimension) setCreatingStudy({ kind, source, dimension });
  };
  const geometryLabel = empty
    ? 'No geometry'
    : w.project.geometry.kind === 'cad'
      ? `${w.project.geometry.features.length} CAD features`
      : w.project.geometry.kind === 'profile'
        ? 'Exact plane profile'
        : w.project.geometry.kind;
  const evaluated = isNumericalProject(w.project) || (!!w.cad.current && !w.cadSourceError);
  return (
    <section
      className="project-document-workspace canonical-project"
      hidden={!active}
      role="tabpanel"
      id={`document-panel-${documentId}`}
      aria-labelledby={`document-tab-${documentId}`}
    >
      {mode === 'cad' ? (
        <CadWorkspace
          persistenceControls={
            <ProjectWorkspaceBar
              compact
              path={w.path}
              dirty={w.dirty}
              desktop={w.desktop}
              canSave={
                !w.locked &&
                !w.nativeLocked &&
                !w.validation &&
                w.desktop &&
                !w.invalidDraftLabels.length
              }
              autosaveEnabled={w.autosaveEnabled}
              autosaveStatus={w.autosaveStatus}
              autosaveError={w.autosaveError}
              onAutosave={w.setAutosaveEnabled}
              onSave={() => void w.save()}
            />
          }
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
            meshPreview: w.cad.meshPreview,
            meshBusy: w.cad.meshBusy,
            inspectMesh: w.cad.inspectMesh,
            analysisStatus: w.project.study?.domain
              ? {
                  label: w.cadSourceError
                    ? 'Study source needs review'
                    : 'Solid FEM study prepared',
                  detail:
                    w.cadSourceError ??
                    'The study uses the complete exact face catalog. Assign material, supports and loads in the analysis workspace.',
                  ready: !w.cadSourceError,
                }
              : w.cadStudyCandidate
                ? {
                    label: 'Solid FEM preparation available',
                    detail:
                      'Current mesh inspection verifies every exact face. Choose Prepare analysis in Mesh inspection to create a source-bound solid study.',
                    ready: true,
                  }
                : undefined,
            onPrepareAnalysis: canPrepareCad ? () => openStudy('cad-solid') : undefined,
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
        <>
          <ProjectWorkspaceBar
            path={w.path}
            dirty={w.dirty}
            desktop={w.desktop}
            canSave={
              !w.locked &&
              !w.nativeLocked &&
              !w.validation &&
              w.desktop &&
              !w.invalidDraftLabels.length
            }
            autosaveEnabled={w.autosaveEnabled}
            autosaveStatus={w.autosaveStatus}
            autosaveError={w.autosaveError}
            onAutosave={w.setAutosaveEnabled}
            onSave={() => void w.save()}
          />
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
                      ? w.project.study?.domain
                        ? 'This solid study preserves the exact CAD source and its explicit face assignments.'
                        : 'This project uses a verified primitive or plane-profile analysis path.'
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
                      : canCreateStudy
                        ? compatibility?.state === 'supported'
                          ? 'The exact geometry has a supported analysis adapter. Supply material properties and a target mesh size.'
                          : 'Verified exact faces are ready for a solid FEM study. Supply material properties and a target mesh size.'
                        : compatibility?.state === 'unsupported'
                          ? 'Open Mesh inspection to check whether this closed solid can be prepared for FEM. Shells and assemblies remain unavailable.'
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
                    onClick={() =>
                      openStudy(compatibility?.state === 'supported' ? 'adapter' : 'cad-solid')
                    }
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
        </>
      )}
      {active && validDraft && creatingStudy && (
        <CreateStudyDialog
          dimension={creatingStudy.dimension}
          units={w.project.displayUnits}
          defaultSize={w.cad.meshPreview?.receipt.targetSize}
          previousStudy={w.project.study}
          locked={w.locked || w.nativeLocked}
          replacing={!!w.project.study}
          onCancel={() => setCreatingStudy(null)}
          onCreate={(material, thickness, size) => {
            if (
              validDraft &&
              w.createStudy(material, thickness, size, creatingStudy.kind === 'cad-solid')
            ) {
              setCreatingStudy(null);
              onAnalysis();
            }
          }}
        />
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

/** A material draft belongs to one source recipe and one study replacement target. */
export function studyPreparationSourceKey(project: ProjectDefinition): string {
  return JSON.stringify([project.id, project.geometry, project.study?.id ?? null]);
}
