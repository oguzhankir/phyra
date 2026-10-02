import { useEffect, useRef, useState } from 'react';
import type { Constraint, Load, Project } from '../domain/contracts/types';
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
import { useDesktopLifecycle } from './useDesktopLifecycle';
import { useExecutionSession, type ExecutionSession } from './useExecutionSession';
import { useProjectSession } from './useProjectSession';
import { useRecoverySession } from './useRecoverySession';
import { useVerificationWorkflow } from './useVerificationWorkflow';
import { useWorkbenchView, type WorkbenchView } from './useWorkbenchView';
import { useWorkbenchActivity } from './workbenchActivity';

const uid = () => crypto.randomUUID();

// Composes definition, execution and presentation owners. Cross-owner transitions
// live here; each feature consumes only its explicit view/edit contract.
export function useWorkbench() {
  const desktop = '__TAURI_INTERNALS__' in window;
  const activity = useWorkbenchActivity();
  const executionRef = useRef<ExecutionSession | null>(null);
  const viewRef = useRef<WorkbenchView | null>(null);
  const verificationRef = useRef(false);
  const clearRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const session = useProjectSession({
    desktop,
    activity,
    currentResult: () => executionRef.current?.data ?? null,
    clearRecovery: () => clearRecoveryRef.current(),
    beforeConfirmation: () => viewRef.current?.setHelp(false),
    onEdit: () => viewRef.current?.setProbe(null),
    onHistoryNavigate: (next, message) => {
      const currentView = viewRef.current;
      if (!currentView) return;
      const support = next.study.constraints.find((item) => item.id === currentView.constraintId);
      const load = next.study.loads.find((item) => item.id === currentView.loadId);
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
    onReplace: (_project, result) => {
      executionRef.current?.reset(result);
      viewRef.current?.reset(result);
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
  const execution = useExecutionSession({
    desktop,
    activity,
    verificationRef,
    project: session.project,
    projectRef: session.projectRef,
    invalidDraftsRef: session.invalidDraftsRef,
    validation: session.validation,
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
    project: session.project,
    currentData: execution.currentData,
    invalidDraftsRef: session.invalidDraftsRef,
    onError: setError,
  });
  viewRef.current = view;
  const { project, edit, invalidDraftsRef } = session;
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
  const is2D = project.study.dimension === '2d';
  const isPinn = project.study.solver.kind === 'pinn';
  const regions = regionNames(
    project.geometry.kind,
    project.study.dimension,
    project.geometry.profile,
  );
  const factor = lengthFactor(project.displayUnits);
  const constraint = project.study.constraints.find((item) => item.id === constraintId);
  const load = project.study.loads.find((item) => item.id === loadId);

  const { verification, verified, requestedOperation } = useVerificationWorkflow({
    desktop,
    project,
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
    if (requestedOperation) void execution.execute(requestedOperation);
  }, [requestedOperation]);
  useEffect(() => {
    if (section === 'solver' && !execution.devices && !verification && !execution.deviceError)
      void execution.refreshDevices();
  }, [section, execution.devices, desktop, verification, execution.deviceError]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const recovery = useRecoverySession({
    desktop,
    verification,
    project,
    dirty: session.dirty,
    invalidDrafts: session.invalidDraftLabels.length,
    blocked: !!execution.busy || !!session.fileBusy || execution.deviceBusy || session.confirmation,
    onRestore: (next) => {
      session.replace(next);
      session.setDirty(true);
      setNotice('Project definition recovered · recompute results');
    },
    onError: setError,
  });
  activity.recovery.current = recovery.pending || recovery.prompt || !recovery.ready;
  clearRecoveryRef.current = recovery.clearOwn;
  const locked =
    !!execution.busy || !!session.fileBusy || execution.deviceBusy || activity.recovery.current;
  const historyBlocked =
    locked ||
    session.confirmation ||
    view.help ||
    recovery.prompt ||
    session.invalidDraftLabels.length > 0;
  useModalFocus(
    session.confirmation || view.help || recovery.prompt,
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
  useDesktopLifecycle({
    desktop,
    busyRef: activity.execution,
    fileBusyRef: activity.file,
    confirmationRef: activity.confirmation,
    dirtyRef: session.dirtyRef,
    canReplaceRef: session.canReplaceRef,
    help: view.help,
    confirmation: session.confirmation,
    section,
    save: session.save,
    open: session.open,
    create: session.create,
    setHelpContext: view.setHelpContext,
    setHelp: view.setHelp,
    setError,
    undo: session.undo,
    redo: session.redo,
    historyBlocked,
  });

  const addConstraint = () => {
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before adding a support.');
      return;
    }
    const id = uid();
    edit((next) =>
      next.study.constraints.push({
        id,
        name: `Support ${next.study.constraints.length + 1}`,
        regions: assignedRegions(selected, regions[0]?.id ?? 'x0'),
        components: is2D ? [0, 0, null] : [0, 0, 0],
      }),
    );
    setConstraintId(id);
    setSection('constraints');
  };
  const addLoad = () => {
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before adding a load.');
      return;
    }
    const id = uid();
    edit((next) =>
      next.study.loads.push({
        id,
        name: `Load ${next.study.loads.length + 1}`,
        regions: assignedRegions(
          selected,
          regions.find((region) => region.id === 'x1')?.id ?? regions[0]?.id ?? 'x1',
        ),
        kind: 'force',
        vector: is2D ? [0, -100, 0] : [0, 0, -100],
        pressure: 0,
      }),
    );
    setLoadId(id);
    setSection('loads');
  };
  const editConstraint = (change: (item: Constraint) => void) =>
    edit((next) => {
      const item = next.study.constraints.find((candidate) => candidate.id === constraintId);
      if (item) change(item);
    });
  const editLoad = (change: (item: Load) => void) =>
    edit((next) => {
      const item = next.study.loads.find((candidate) => candidate.id === loadId);
      if (item) change(item);
    });
  const namedSelection = project.namedSelections.find((item) => item.id === namedSelectionId);
  const addNamedSelection = () => {
    if (invalidDraftsRef.current.size || locked) return;
    if (project.namedSelections.length >= 100) {
      setError(
        'A project supports at most 100 named selections. Delete an unused set before adding another.',
      );
      return;
    }
    const chosen = selectedBoundaries(project, selected);
    if (!chosen.length) {
      setError('Select boundaries before creating a named selection.');
      return;
    }
    const id = uid();
    edit(
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
    setSection('selections');
  };
  const editNamedSelection = (change: (item: NamedSelection) => void) =>
    edit((next) => {
      const item = next.namedSelections.find((candidate) => candidate.id === namedSelectionId);
      if (item) change(item);
    }, false);
  const useNamedSelection = (item: NamedSelection) => {
    if (!selectionIsCompatible(project, item)) {
      setError('This named selection belongs to another geometry. Repair its boundaries first.');
      return;
    }
    setSelected([...item.regions]);
  };
  const chooseDimension = (dimension: Project['study']['dimension']) => {
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before changing dimension.');
      return;
    }
    edit((next) => changeStudyDimension(next, dimension));
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setNamedSelectionId(null);
    setAnimate(false);
  };

  return {
    ...session,
    ...execution,
    ...view,
    desktop,
    recovery,
    locked,
    historyBlocked,
    error,
    setError,
    notice,
    setNotice,
    is2D,
    isPinn,
    regions,
    factor,
    constraint,
    load,
    namedSelection,
    namedSelectionId,
    addNamedSelection,
    editNamedSelection,
    useNamedSelection,
    chooseDimension,
    addConstraint,
    editConstraint,
    addLoad,
    editLoad,
    solved: !!execution.currentData && execution.currentData.manifest.operation !== 'mesh',
    stat: execution.currentData?.manifest.statistics,
    verification,
    verified,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
