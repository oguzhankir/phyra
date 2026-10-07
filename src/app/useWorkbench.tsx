import { useEffect, useMemo, useRef, useState } from 'react';
import type { Constraint, Load, Project, ProjectDefinition } from '../domain/contracts/types';
import {
  nextSelectionName,
  selectedBoundaries,
  selectionIsCompatible,
  type NamedSelection,
} from '../domain/project/namedSelections';
import { assignedRegions, regionNames } from '../domain/project/regions';
import { changeStudyDimension } from '../domain/project/study';
import { lengthFactor } from '../domain/units';
import { useModalFocus } from '../shared/ui/useModalFocus';
import { useExecutionSession, type ExecutionSession } from './useExecutionSession';
import { useCadVerificationWorkflow } from './useCadVerificationWorkflow';
import { useCadSession } from './useCadSession';
import { useProjectSession } from './useProjectSession';
import { useRecoverySession } from './useRecoverySession';
import { useVerificationWorkflow } from './useVerificationWorkflow';
import { useWorkbenchView, type WorkbenchView } from './useWorkbenchView';
import { useWorkbenchActivity, type NativeActivity } from './workbenchActivity';
import type { useTheme } from '../features/workbench/theme';
import type { ProjectDocumentSeed } from './projectDocuments';
import { isNumericalProject, documentPreparation } from '../domain/project/document';
import { prepareStudy } from '../domain/project/readiness';
import { makeProject } from '../features/examples/projects';
import { closeProject } from '../platform/desktop/bridge';

const uid = () => crypto.randomUUID();

// Composes definition, execution and presentation owners. Cross-owner transitions
// live here; each feature consumes only its explicit view/edit contract.
type WorkbenchOptions = {
  seed: ProjectDocumentSeed;
  nativeActivity: NativeActivity;
  appearance: ReturnType<typeof useTheme>;
  active: boolean;
  windowClosing: boolean;
  onProjectActivated: () => void;
  onNewProjectRequested: () => void;
  onRecoveryRestored?: () => void;
  onRecoveryFailed?: (message: string) => void;
};
export function useWorkbench({
  seed,
  nativeActivity,
  appearance,
  active,
  windowClosing,
  onProjectActivated,
  onNewProjectRequested,
  onRecoveryRestored,
  onRecoveryFailed,
}: WorkbenchOptions) {
  const desktop = '__TAURI_INTERNALS__' in window;
  const activity = useWorkbenchActivity(nativeActivity);
  const executionRef = useRef<ExecutionSession | null>(null);
  const viewRef = useRef<WorkbenchView | null>(null);
  const verificationRef = useRef(false);
  const cadReport = useRef<Record<string, unknown> | null>(null);
  const clearRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const releaseRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const prepareCloseRef = useRef<() => Promise<void>>(async () => {});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(seed.notice ?? null);

  const session = useProjectSession({
    documentId: seed.id,
    initialProject: seed.project,
    initialPath: seed.path,
    initialDirty: seed.dirty,
    initialReferenceId: seed.referenceId,
    desktop,
    activity,
    currentResult: () => executionRef.current?.data ?? null,
    clearRecovery: () => clearRecoveryRef.current(),
    prepareDocumentClose: () => prepareCloseRef.current(),
    retireDocument: async () => {
      if (desktop) {
        await releaseRecoveryRef.current();
        await closeProject(seed.id);
      }
    },
    beforeConfirmation: () => viewRef.current?.setHelp(false),
    onEdit: () => viewRef.current?.setProbe(null),
    onHistoryNavigate: (next, message) => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const support = next.study?.constraints.find((item) => item.id === currentView.constraintId);
      const load = next.study?.loads.find((item) => item.id === currentView.loadId);
      const selection = next.namedSelections.find(
        (item) => item.id === currentView.namedSelectionId,
      );
      if (!support) currentView.setConstraintId(null);
      if (!load) currentView.setLoadId(null);
      if (!selection) currentView.setNamedSelectionId(null);
      currentView.setSelected(
        currentView.section === 'constraints'
          ? (support?.regions ?? [])
          : currentView.section === 'loads'
            ? (load?.regions ?? [])
            : currentView.section === 'selections' &&
                selection &&
                selectionIsCompatible(next, selection)
              ? [...selection.regions]
              : [],
      );
      currentView.setAnimate(false);
      setNotice(message);
    },
    onReplace: (definition, result) => {
      executionRef.current?.reset(result);
      viewRef.current?.reset(result, definition);
      setError(null);
    },
    onReference: (id) => {
      viewRef.current?.setSection('results');
      viewRef.current?.setFieldSource(id === '2d-compare' ? 'fem' : 'primary');
      executionRef.current?.setRunTab(id === '2d-compare' ? 'comparison' : 'run');
      executionRef.current?.setRunExpanded(false);
    },
    onError: setError,
    onNotice: setNotice,
  });
  const cad = useCadSession({
    documentId: seed.id,
    desktop,
    project: session.project,
    projectRef: session.projectRef,
    activity,
    invalidDraftsRef: session.invalidDraftsRef,
    edit: session.edit,
    reportDraft: session.reportDraftValidity,
    onError: setError,
    onNotice: setNotice,
  });
  const compatibility = cad.current?.receipt.analysisCompatibility;
  const analysisProject = useMemo<Project | null>(
    () =>
      isNumericalProject(session.project)
        ? session.project
        : session.project.geometry.kind === 'cad' &&
            session.project.study &&
            compatibility?.state === 'supported' &&
            session.project.study.dimension === compatibility.dimension &&
            compatibility.numericalGeometry
          ? {
              ...session.project,
              geometry: structuredClone(compatibility.numericalGeometry),
              study: session.project.study,
            }
          : null,
    [session.project, compatibility],
  );
  const execution = useExecutionSession({
    documentId: seed.id,
    initialData: seed.data,
    desktop,
    activity,
    verificationRef,
    project: session.project,
    analysisProject,
    projectRef: session.projectRef,
    invalidDraftsRef: session.invalidDraftsRef,
    onStart: (operation) => {
      viewRef.current?.setProbe(null);
      viewRef.current?.setAnimate(false);
      viewRef.current?.setFieldSource(operation === 'compare' ? 'fem' : 'primary');
    },
    onComplete: (manifest) => {
      viewRef.current?.setFieldId(manifest.operation === 'mesh' ? 'geometry' : 'displacement-mag');
      if (manifest.operation !== 'mesh') viewRef.current?.setSection('results');
      session.setDirty(true);
    },
    onError: setError,
    onNotice: setNotice,
  });
  executionRef.current = execution;
  const view = useWorkbenchView({
    appearance,
    project: analysisProject ?? session.project,
    currentData: execution.currentData,
    invalidDraftsRef: session.invalidDraftsRef,
    onError: setError,
  });
  viewRef.current = view;
  const { project, edit, invalidDraftsRef } = session;
  const preparation = useMemo(
    () =>
      analysisProject
        ? prepareStudy(analysisProject, session.invalidDraftLabels.length)
        : documentPreparation(project, session.invalidDraftLabels.length),
    [project, analysisProject, session.invalidDraftLabels.length],
  );
  const {
    section,
    selected,
    setSelected,
    constraintId,
    setConstraintId,
    loadId,
    setLoadId,
    namedSelectionId,
    setNamedSelectionId,
    setSection,
    setAnimate,
  } = view;
  const is2D =
    project.study?.dimension === '2d' ||
    ((project.geometry.kind === 'empty' || project.geometry.kind === 'cad') &&
      project.geometry.dimension === '2d');
  const isPinn = project.study?.solver.kind === 'pinn';
  const regions = analysisProject
    ? regionNames(
        analysisProject.geometry.kind,
        analysisProject.study.dimension,
        analysisProject.geometry.profile,
      )
    : [];
  const factor = lengthFactor(project.displayUnits);
  const constraint = project.study?.constraints.find((item) => item.id === constraintId);
  const load = project.study?.loads.find((item) => item.id === loadId);

  const { verification, verified, requestedOperation, verificationConfiguration } =
    useVerificationWorkflow({
      desktop: desktop && !!seed.verification,
      project: session.project,
      cadReport,
      currentData: execution.currentData,
      liveMetrics: execution.liveMetrics,
      fieldSource: view.fieldSource,
      fieldId: view.fieldId,
      replace: session.replace,
      setDeformation: view.setDeformation,
      setFieldId: view.setFieldId,
      setFieldSource: view.setFieldSource,
      setError,
    });
  verificationRef.current = verification;
  useEffect(() => {
    if (requestedOperation) {
      onProjectActivated?.();
      void execution.execute(requestedOperation);
    }
  }, [requestedOperation]);
  useEffect(() => {
    if (
      active &&
      section === 'solver' &&
      !execution.devices &&
      !verification &&
      !execution.deviceError
    )
      void execution.refreshDevices();
  }, [active, section, execution.devices, desktop, verification, execution.deviceError]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const recovery = useRecoverySession({
    documentId: seed.id,
    discover: false,
    desktop,
    verification,
    project,
    dirty: session.dirty,
    invalidDrafts: session.invalidDraftLabels.length,
    blocked:
      cad.busy ||
      !!execution.busy ||
      !!session.fileBusy ||
      execution.deviceBusy ||
      session.confirmation ||
      session.transitioning ||
      windowClosing,
    onRestore: (next) => {
      session.replace(next);
      session.setDirty(true);
      setNotice('Project definition recovered · recompute results');
      onProjectActivated?.();
    },
    onError: setError,
  });
  activity.recovery.current = recovery.pending || recovery.prompt || !recovery.ready;
  clearRecoveryRef.current = recovery.clearOwn;
  releaseRecoveryRef.current = recovery.release;
  prepareCloseRef.current = recovery.prepareClose;
  const locked =
    cad.busy ||
    !!execution.busy ||
    !!session.fileBusy ||
    session.transitioning ||
    execution.deviceBusy ||
    activity.recovery.current ||
    windowClosing;
  const nativeLocked =
    !!nativeActivity.cad?.current ||
    !!nativeActivity.execution.current ||
    !!nativeActivity.file.current ||
    nativeActivity.device.current;
  const historyBlocked =
    locked ||
    session.confirmation ||
    view.help ||
    recovery.prompt ||
    session.invalidDraftLabels.length > 0;
  useModalFocus(
    active && (session.confirmation || view.help || recovery.prompt),
    () => {
      if (session.confirmation) {
        session.setConfirmation(false);
        session.confirmResolver.current?.('cancel');
        session.confirmResolver.current = null;
      } else if (view.help) view.setHelp(false);
      else if (!recovery.pending) recovery.setPrompt(false);
    },
    session.confirmation ? 'unsaved' : view.help ? 'help' : recovery.prompt ? 'recovery' : null,
  );
  const restored = useRef(false);
  useEffect(() => {
    if (!seed.recoveryRecord || restored.current || !recovery.ready || locked) return;
    restored.current = true;
    void recovery.restore(seed.recoveryRecord).then(async (success) => {
      if (success) onRecoveryRestored?.();
      else {
        try {
          await recovery.release();
        } catch (cause) {
          setError(`Recovery lease cleanup failed: ${String(cause)}`);
        }
        onRecoveryFailed?.('Recovery restore failed. The original recovery copy was preserved.');
      }
    });
  }, [seed.recoveryRecord, recovery.ready, locked]);
  useEffect(() => {
    if (!seed.referenceId) return;
    view.setSection('results');
    view.setFieldSource(seed.referenceId === '2d-compare' ? 'fem' : 'primary');
    execution.setRunTab(seed.referenceId === '2d-compare' ? 'comparison' : 'run');
  }, [seed.referenceId]);

  const numericalEdit = (mutation: (next: Project) => void, physical = true) => {
    if (!analysisProject) return;
    edit((next: ProjectDefinition) => {
      if (isNumericalProject(next)) {
        mutation(next);
        return;
      }
      if (next.geometry.kind !== 'cad' || !next.study) return;
      const projection: Project = {
        ...next,
        geometry: structuredClone(analysisProject.geometry),
        study: next.study,
      };
      mutation(projection);
      if (JSON.stringify(projection.geometry) !== JSON.stringify(analysisProject.geometry))
        throw new Error('Edit the source geometry in the CAD workspace.');
      next.study = projection.study;
      next.namedSelections = projection.namedSelections;
      next.name = projection.name;
      next.displayUnits = projection.displayUnits;
    }, physical);
  };
  const createStudy = (
    material: { name: string; young: number; poisson: number },
    thickness: number,
    meshSize: number,
  ) => {
    if (locked || !compatibility || compatibility.state !== 'supported') return;
    const template = makeProject(
      compatibility.dimension === '2d' ? 'plane-stress-tension' : 'cantilever',
    ).study;
    template.id = uid();
    template.material = structuredClone(material);
    template.thickness = thickness;
    template.mesh.size = meshSize;
    template.constraints = [];
    template.loads = [];
    template.solver.kind = 'fem';
    edit((next) => {
      next.study = template;
    });
    setSection('material');
  };

  const addConstraint = (boundaries = selected) => {
    if (locked) return;
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before adding a support.');
      return;
    }
    const id = uid();
    numericalEdit((next) =>
      next.study.constraints.push({
        id,
        name: `Support ${next.study.constraints.length + 1}`,
        regions: assignedRegions(boundaries, regions[0]?.id ?? 'x0'),
        components: is2D ? [0, 0, null] : [0, 0, 0],
      }),
    );
    setConstraintId(id);
    setSelected(assignedRegions(boundaries, regions[0]?.id ?? 'x0'));
    setSection('constraints');
  };
  const addLoad = (boundaries = selected) => {
    if (locked) return;
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before adding a load.');
      return;
    }
    const id = uid();
    numericalEdit((next) =>
      next.study.loads.push({
        id,
        name: `Load ${next.study.loads.length + 1}`,
        regions: assignedRegions(
          boundaries,
          regions.find((region) => region.id === 'x1')?.id ?? regions[0]?.id ?? 'x1',
        ),
        kind: 'force',
        vector: is2D ? [0, -100, 0] : [0, 0, -100],
        pressure: 0,
      }),
    );
    setLoadId(id);
    setSelected(
      assignedRegions(
        boundaries,
        regions.find((region) => region.id === 'x1')?.id ?? regions[0]?.id ?? 'x1',
      ),
    );
    setSection('loads');
  };
  const editConstraint = (change: (item: Constraint) => void) =>
    numericalEdit((next) => {
      const item = next.study.constraints.find((candidate) => candidate.id === constraintId);
      if (item) change(item);
    });
  const editLoad = (change: (item: Load) => void) =>
    numericalEdit((next) => {
      const item = next.study.loads.find((candidate) => candidate.id === loadId);
      if (item) change(item);
    });
  const namedSelection = project.namedSelections.find((item) => item.id === namedSelectionId);
  const addNamedSelection = (boundaries = selected) => {
    if (invalidDraftsRef.current.size || locked) return;
    if (project.namedSelections.length >= 100) {
      setError(
        'A project supports at most 100 named selections. Delete an unused set before adding another.',
      );
      return;
    }
    const chosen = analysisProject ? selectedBoundaries(analysisProject, boundaries) : [];
    if (!chosen.length) {
      setError('Select boundaries before creating a named selection.');
      return;
    }
    const id = uid();
    numericalEdit(
      (next) =>
        next.namedSelections.push({
          id,
          name: nextSelectionName(next),
          geometryKind: next.geometry.kind,
          dimension: next.study.dimension,
          regions: assignedRegions(chosen, 'x0'),
        }),
      false,
    );
    setNamedSelectionId(id);
    setSelected(chosen);
    setSection('selections');
  };
  const editNamedSelection = (change: (item: NamedSelection) => void) =>
    numericalEdit((next) => {
      const item = next.namedSelections.find((candidate) => candidate.id === namedSelectionId);
      if (item) change(item);
    }, false);
  const useNamedSelection = (item: NamedSelection) => {
    if (!analysisProject || !selectionIsCompatible(analysisProject, item)) {
      setError('This named selection belongs to another geometry. Repair its boundaries first.');
      return;
    }
    setSelected([...item.regions]);
  };
  const chooseDimension = (dimension: Project['study']['dimension']) => {
    if (project.geometry.kind === 'cad') {
      setError('Change the source geometry dimension in the CAD workspace.');
      return;
    }
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before changing dimension.');
      return;
    }
    numericalEdit((next) => changeStudyDimension(next, dimension));
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setNamedSelectionId(null);
    setAnimate(false);
  };

  const deleteModelItem = (kind: 'support' | 'load' | 'selection', id: string) => {
    if (locked) return;
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before deleting a model item.');
      return;
    }
    numericalEdit((next) => {
      if (kind === 'support')
        next.study.constraints = next.study.constraints.filter((item) => item.id !== id);
      else if (kind === 'load')
        next.study.loads = next.study.loads.filter((item) => item.id !== id);
      else next.namedSelections = next.namedSelections.filter((item) => item.id !== id);
    }, kind !== 'selection');
    if (kind === 'support' && constraintId === id) setConstraintId(null);
    if (kind === 'load' && loadId === id) setLoadId(null);
    if (kind === 'selection' && namedSelectionId === id) setNamedSelectionId(null);
    setSelected([]);
  };

  const cadVerification = useCadVerificationWorkflow({
    documentId: seed.id,
    enabled: verificationConfiguration === 'cad',
    ready: recovery.ready && !locked && !nativeLocked,
    project,
    projectRef: session.projectRef,
    analysisProject,
    currentData: execution.currentData,
    cad,
    report: cadReport,
    edit,
    numericalEdit,
    undo: session.undo,
    createStudy,
    execute: execution.execute,
    error,
  });

  return {
    ...session,
    cadVerification,
    documentId: seed.id,
    cad,
    analysisProject,
    createStudy,
    cadBusy: cad.busy,
    ...execution,
    ...view,
    desktop,
    recovery,
    locked,
    nativeLocked,
    preparation,
    historyBlocked,
    error,
    setError,
    notice,
    setNotice,
    is2D,
    isPinn,
    regions,
    factor,
    numericalEdit,
    constraint,
    load,
    namedSelection,
    namedSelectionId,
    addNamedSelection: () => addNamedSelection(),
    addNamedSelectionOn: addNamedSelection,
    editNamedSelection,
    useNamedSelection,
    chooseDimension,
    addConstraint: () => addConstraint(),
    addConstraintOn: addConstraint,
    editConstraint,
    addLoad: () => addLoad(),
    addLoadOn: addLoad,
    editLoad,
    deleteSupport: (id: string) => deleteModelItem('support', id),
    deleteLoad: (id: string) => deleteModelItem('load', id),
    deleteSelection: (id: string) => deleteModelItem('selection', id),
    solved: !!execution.currentData && execution.currentData.manifest.operation !== 'mesh',
    stat: execution.currentData?.manifest.statistics,
    verification,
    verified,
    requestNewProject: onNewProjectRequested,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
