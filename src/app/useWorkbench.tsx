import { invokeVerification as invoke } from '../platform/desktop/verification';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Constraint,
  Devices,
  Load,
  Operation,
  Progress,
  Project,
  TrainingMetric,
} from '../domain/contracts/types';
import {
  appendTrainingMetric,
  resultIsCurrent,
  type RunExecution,
} from '../domain/execution/presentation';
import { assignedRegions, regionNames, type RegionId } from '../domain/project/regions';
import { changeStudyDimension } from '../domain/project/study';
import { inputError } from '../domain/project/validation';
import {
  createHistory,
  recordEdit,
  undo as undoEdit,
  redo as redoEdit,
} from '../domain/project/history';
import {
  nextSelectionName,
  selectedBoundaries,
  selectionIsCompatible,
  type NamedSelection,
} from '../domain/project/namedSelections';
import {
  extractField,
  fieldOptions,
  type FieldId,
  type FieldSource,
  type ResultData,
} from '../domain/results/fields';
import type { Probe } from '../domain/results/probe';
import { lengthFactor } from '../domain/units';
import { makeProject, type ExampleId } from '../features/examples/projects';
import { loadReference, type ReferenceId } from '../features/examples/references';
import type { HelpContext } from '../features/help/content';
import { type RunStatus, type RunTab } from '../features/runs/RunWorkspace';
import { type Section } from '../features/workbench/navigation';
import { useTheme } from '../features/workbench/theme';
import {
  cancelJob,
  exportResults,
  getDevices,
  openProject,
  readBuffer,
  runJob,
  saveProject,
  subscribeMetrics,
  subscribeProgress,
} from '../platform/desktop/bridge';
import { useModalFocus } from '../shared/ui/useModalFocus';
import { useDesktopLifecycle } from './useDesktopLifecycle';
import { useRecoverySession } from './useRecoverySession';
import { useVerificationWorkflow } from './useVerificationWorkflow';

const uid = () => crypto.randomUUID();
export function useWorkbench() {
  const [project, setProject] = useState<Project>(() => makeProject('plane-stress-tension'));
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef<ReturnType<typeof createHistory> | null>(null);
  if (!historyRef.current) historyRef.current = createHistory(project);
  const [dirty, setDirtyState] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const setDirty = useCallback((value: boolean) => {
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  const invalidDraftsRef = useRef(new Map<string, string>());
  const [invalidDraftLabels, setInvalidDraftLabels] = useState<string[]>([]);
  const reportDraftValidity = useCallback((id: string, label: string | null) => {
    const drafts = invalidDraftsRef.current;
    if (label === null) {
      if (!drafts.delete(id)) return;
    } else {
      if (drafts.get(id) === label) return;
      drafts.set(id, label);
      setDirty(true);
    }
    setInvalidDraftLabels(Array.from(drafts.values()));
  }, []);
  const [path, setPath] = useState<string | null>(null);
  const [referenceId, setReferenceId] = useState<ReferenceId | null>(null);
  const [data, setData] = useState<ResultData | null>(null);
  const [section, setSection] = useState<Section>('study');
  const [selected, setSelected] = useState<RegionId[]>([]);
  const [selectionMode, setSelectionMode] = useState<'replace' | 'add' | 'toggle'>('replace');
  const [constraintId, setConstraintId] = useState<string | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [namedSelectionId, setNamedSelectionId] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<FieldId>('geometry');
  const [edges, setEdges] = useState(true);
  const [deformation, setDeformation] = useState<'off' | 'actual' | 'auto' | 'custom'>('auto');
  const [customScale, setCustomScale] = useState(10);
  const [animate, setAnimate] = useState(false);
  const [fieldSource, setFieldSource] = useState<FieldSource>('primary');
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState<Operation | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [fileBusy, setFileBusy] = useState<'open' | 'save' | 'export' | 'reference' | null>(null);
  const fileBusyRef = useRef(fileBusy);
  fileBusyRef.current = fileBusy;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [devices, setDevices] = useState<Devices | null>(null);
  const [deviceBusy, setDeviceBusy] = useState(false);
  const deviceBusyRef = useRef(false);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<TrainingMetric[]>([]);
  const liveMetrics = useRef<TrainingMetric[]>([]);
  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [runExecution, setRunExecution] = useState<RunExecution | null>(null);
  const [runElapsed, setRunElapsed] = useState(0);
  const runStarted = useRef<number | null>(null);
  const [runTab, setRunTab] = useState<RunTab>('run');
  const [runExpanded, setRunExpanded] = useState(false);
  const active = useRef<{ token: number; cancelled: boolean; jobId?: string } | null>(null);
  const serial = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const confirmationRef = useRef(false);
  const confirmResolver = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);
  const [leftWidth, setLeftWidth] = useState(224);
  const [rightWidth, setRightWidth] = useState(304);
  const [help, setHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('overview');
  const { theme, preference, setPreference } = useTheme();
  const showHelp = (context: HelpContext = section) => {
    setHelpContext(context);
    setHelp(true);
  };
  const desktop = '__TAURI_INTERNALS__' in window;
  const recoveryBusyRef = useRef(false);
  const clearRecoveryRef = useRef<() => Promise<void>>(async () => {});
  const fileBusyLabel =
    fileBusy === 'open'
      ? 'Opening project'
      : fileBusy === 'save'
        ? 'Saving project'
        : fileBusy === 'reference'
          ? 'Loading saved CPU reference'
          : 'Exporting fields';
  const currentData = resultIsCurrent(project, data) ? data : null;
  const solved = !!currentData && currentData.manifest.operation !== 'mesh';
  const is2D = project.study.dimension === '2d';
  const isPinn = project.study.solver.kind === 'pinn';
  const field = useMemo(
    () => extractField(currentData, fieldId, fieldSource),
    [currentData, fieldId, fieldSource],
  );
  const availableFields = fieldOptions.filter(
    (option) =>
      (!is2D ||
        !['displacement-z', 'stress-zz', 'stress-yz', 'stress-xz', 'reactions-z'].includes(
          option.id,
        )) &&
      (!option.id.startsWith('reactions') ||
        (currentData?.manifest.arrays.reactions &&
          fieldSource !== 'pinn' &&
          fieldSource !== 'difference' &&
          fieldSource !== 'relative')),
  );
  const validation = invalidDraftLabels.length
    ? `${invalidDraftLabels[0]} has an incomplete or nonfinite numeric draft. Complete it, or press Escape to revert before continuing.`
    : inputError(project);
  const regions = regionNames(project.geometry.kind, project.study.dimension).filter(
    (region) => !is2D || ['x0', 'x1', 'y0', 'y1'].includes(region.id),
  );
  const factor = lengthFactor(project.displayUnits);
  const constraint = project.study.constraints.find((item) => item.id === constraintId);
  const load = project.study.loads.find((item) => item.id === loadId);
  const namedSelection = project.namedSelections.find((item) => item.id === namedSelectionId);

  const edit = useCallback((change: (next: Project) => void, physical = true) => {
    if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return;
    try {
      const previous = projectRef.current;
      const next = structuredClone(previous);
      change(next);
      const transition = recordEdit(historyRef.current!, previous, next, physical);
      if (!transition.changed) return;
      historyRef.current = transition.history;
      projectRef.current = transition.project;
      setProject(transition.project);
      setDirty(true);
      setProbe(null);
      setError(null);
      if (transition.notice) setNotice(transition.notice);
    } catch (cause) {
      setError(String(cause));
    }
  }, []);
  const navigateHistory = (direction: 'undo' | 'redo') => {
    if (
      busyRef.current ||
      fileBusyRef.current ||
      recoveryBusyRef.current ||
      deviceBusyRef.current ||
      confirmationRef.current ||
      help ||
      invalidDraftsRef.current.size
    )
      return;
    try {
      const entry =
        direction === 'undo' ? historyRef.current!.past.at(-1) : historyRef.current!.future.at(-1);
      const transition = (direction === 'undo' ? undoEdit : redoEdit)(
        historyRef.current!,
        projectRef.current,
      );
      if (!transition.changed) return;
      historyRef.current = transition.history;
      projectRef.current = transition.project;
      setProject(transition.project);
      setDirty(true);
      setProbe(null);
      setAnimate(false);
      setError(null);
      const next = transition.project;
      const support = next.study.constraints.find((item) => item.id === constraintId);
      const appliedLoad = next.study.loads.find((item) => item.id === loadId);
      const group = next.namedSelections.find((item) => item.id === namedSelectionId);
      if (!support) setConstraintId(null);
      if (!appliedLoad) setLoadId(null);
      if (!group) setNamedSelectionId(null);
      setSelected(
        section === 'constraints'
          ? (support?.regions ?? [])
          : section === 'loads'
            ? (appliedLoad?.regions ?? [])
            : section === 'selections' && group && selectionIsCompatible(next, group)
              ? [...group.regions]
              : [],
      );
      setNotice(
        entry?.physical
          ? 'Inputs restored · recompute the analysis'
          : direction === 'undo'
            ? 'Edit undone'
            : 'Edit restored',
      );
    } catch (cause) {
      setError(String(cause));
    }
  };
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (!desktop || busyRef.current || fileBusyRef.current || recoveryBusyRef.current)
        return false;
      if (invalidDraftsRef.current.size) {
        setError('Complete or revert the invalid numeric input before saving.');
        return false;
      }
      fileBusyRef.current = 'save';
      setFileBusy('save');
      try {
        const current = structuredClone(projectRef.current);
        const cache = data && resultIsCurrent(current, data) ? data.manifest.jobId : undefined;
        const saved = await saveProject(current, cache, saveAs);
        if (!saved) return false;
        setPath(saved);
        setDirty(false);
        try {
          await clearRecoveryRef.current();
        } catch (cause) {
          setError(`Recovery cleanup failed after saving: ${String(cause)}`);
        }
        setNotice(`Saved ${saved.split(/[\\/]/).pop()}`);
        return true;
      } catch (cause) {
        setError(String(cause));
        return false;
      } finally {
        fileBusyRef.current = null;
        setFileBusy(null);
      }
    },
    [data, desktop],
  );
  const canReplace = useCallback(async (): Promise<boolean> => {
    if (
      busyRef.current ||
      fileBusyRef.current ||
      confirmationRef.current ||
      recoveryBusyRef.current
    )
      return false;
    if (!dirtyRef.current) return true;
    confirmationRef.current = true;
    setHelp(false);
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmation(true);
    });
    confirmationRef.current = false;
    if (choice === 'cancel') return false;
    if (choice === 'save') return await save();
    try {
      await clearRecoveryRef.current();
      return true;
    } catch (cause) {
      setError(`Recovery cleanup failed: ${String(cause)}`);
      return false;
    }
  }, [save]);
  const canReplaceRef = useRef(canReplace);
  canReplaceRef.current = canReplace;
  const replace = (next: Project, result: ResultData | null = null) => {
    historyRef.current = createHistory(next);
    projectRef.current = next;
    setProject(next);
    setData(result);
    setDirty(false);
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setNamedSelectionId(null);
    setSection('study');
    setAnimate(false);
    setFieldSource('primary');
    setMetrics([]);
    liveMetrics.current = [];
    setRunStatus('idle');
    setRunExecution(null);
    setRunElapsed(0);
    setRunTab('run');
    setFieldId(result && result.manifest.operation !== 'mesh' ? 'displacement-mag' : 'geometry');
    setProbe(null);
    setProgress(null);
    setError(null);
    setPath(null);
    setReferenceId(null);
  };
  const create = useCallback(
    async (example?: ExampleId) => {
      if (await canReplace()) {
        try {
          await clearRecoveryRef.current();
          replace(makeProject(example));
        } catch (cause) {
          setError(`Recovery cleanup failed: ${String(cause)}`);
        }
      }
    },
    [canReplace],
  );
  const open = useCallback(async () => {
    if (!desktop || !(await canReplace())) return;
    if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return;
    fileBusyRef.current = 'open';
    setFileBusy('open');
    try {
      const opened = await openProject();
      if (!opened) return;
      replace(
        opened.project,
        opened.manifest && opened.buffer
          ? { manifest: opened.manifest, buffer: opened.buffer }
          : null,
      );
      setPath(opened.path ?? null);
      setNotice(opened.notice ?? 'Project opened');
      try {
        await clearRecoveryRef.current();
      } catch (cause) {
        setError(
          `Recovery cleanup: the opened project is active; the earlier recovery copy was preserved. ${String(cause)}`,
        );
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  }, [canReplace, desktop]);
  const inspectReference = async (id: ReferenceId) => {
    if (desktop || deviceBusyRef.current || !(await canReplace())) return;
    if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return;
    fileBusyRef.current = 'reference';
    setFileBusy('reference');
    setError(null);
    try {
      const saved = await loadReference(id);
      replace(saved.project, saved.data);
      setReferenceId(id);
      setSection('results');
      setFieldSource(id === '2d-compare' ? 'fem' : 'primary');
      setRunTab(id === '2d-compare' ? 'comparison' : 'run');
      setRunExpanded(true);
      setNotice('Saved CPU reference loaded');
    } catch (cause) {
      setError(`Reference result could not be opened: ${String(cause)}`);
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  };
  const exportFields = async () => {
    if (!desktop || !currentData || busyRef.current || fileBusyRef.current) return;
    fileBusyRef.current = 'export';
    setFileBusy('export');
    try {
      const saved = await exportResults(currentData.manifest.jobId);
      if (saved) setNotice('Physical fields exported');
    } catch (cause) {
      setError(String(cause));
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  };
  const execute = async (operation: Operation) => {
    if (
      !desktop ||
      busyRef.current ||
      fileBusyRef.current ||
      confirmationRef.current ||
      invalidDraftsRef.current.size ||
      validation ||
      deviceBusyRef.current ||
      recoveryBusyRef.current
    )
      return;
    const snapshot = structuredClone(project);
    const job = {
      token: ++serial.current,
      cancelled: false,
      jobId: undefined as string | undefined,
    };
    active.current = job;
    setRunExecution({ project: snapshot, operation });
    setBusy(operation);
    busyRef.current = operation;
    setCancelling(false);
    setProgress(null);
    setError(null);
    setNotice(null);
    setProbe(null);
    setAnimate(false);
    setFieldSource(operation === 'compare' ? 'fem' : 'primary');
    setMetrics([]);
    liveMetrics.current = [];
    setRunStatus('preparing');
    runStarted.current = performance.now();
    setRunElapsed(0);
    if (operation === 'train' || operation === 'compare') {
      setRunExpanded(true);
      setRunTab('training');
    }
    try {
      const manifest = await runJob(operation, snapshot);
      if (verification)
        void invoke('verification_trace', { message: 'frontend manifest received' });
      if (job.cancelled || active.current?.token !== job.token) return;
      job.jobId = manifest.jobId;
      setRunExecution((previous) => (previous ? { ...previous, jobId: manifest.jobId } : previous));
      const buffer = await readBuffer(manifest.jobId);
      if (verification)
        void invoke('verification_trace', {
          message: `frontend buffer received ${buffer.byteLength}`,
        });
      if (
        job.cancelled ||
        active.current?.token !== job.token ||
        projectRef.current.id !== snapshot.id ||
        projectRef.current.revision !== snapshot.revision ||
        manifest.projectId !== snapshot.id ||
        manifest.studyId !== snapshot.study.id ||
        manifest.revision !== snapshot.revision
      )
        return;
      setData({ manifest, buffer });
      setRunExecution({ project: snapshot, operation, jobId: manifest.jobId, manifest });
      if (verification) void invoke('verification_trace', { message: 'frontend result set' });
      setFieldId(operation === 'mesh' ? 'geometry' : 'displacement-mag');
      if (operation !== 'mesh') setSection('results');
      setRunStatus('completed');
      if (manifest.training) setMetrics(manifest.training.history);
      if (operation === 'compare') setRunTab('comparison');
      setDirty(true);
      setNotice(
        operation === 'train'
          ? 'PINN training complete'
          : operation === 'compare'
            ? 'FEM + PINN comparison complete'
            : operation === 'solve'
              ? 'Analysis complete'
              : 'Mesh generated',
      );
    } catch (cause) {
      if (!job.cancelled) {
        setRunStatus('failed');
        setError(String(cause));
        if (verification)
          void invoke('verification_complete', { report: { error: String(cause) } });
      } else {
        setRunStatus('cancelled');
        setNotice('Job cancelled; worker stopped');
      }
    } finally {
      if (active.current?.token === job.token) {
        active.current = null;
        setBusy(null);
        busyRef.current = null;
        setCancelling(false);
        if (runStarted.current !== null)
          setRunElapsed((performance.now() - runStarted.current) / 1000);
      }
    }
  };
  const cancel = async () => {
    if (!active.current || cancelling) return;
    active.current.cancelled = true;
    setCancelling(true);
    try {
      await cancelJob();
      setRunStatus('cancelled');
      setNotice('Cancellation acknowledged; worker stopped');
    } catch (cause) {
      setError(`Cancellation failed: ${String(cause)}`);
      setCancelling(false);
    }
  };
  const { verification, verified } = useVerificationWorkflow({
    desktop,
    project,
    currentData,
    liveMetrics,
    fieldSource,
    fieldId,
    replace,
    execute,
    setDeformation,
    setFieldId,
    setFieldSource,
    setError,
  });
  useEffect(() => {
    if (!desktop) return;
    let dispose: (() => void) | undefined;
    let dead = false;
    subscribeProgress((event) => {
      const job = active.current;
      if (!job || job.cancelled || (job.jobId && job.jobId !== event.jobId)) return;
      job.jobId = event.jobId;
      setRunExecution((previous) => (previous ? { ...previous, jobId: event.jobId } : previous));
      setProgress(event);
      setRunStatus('running');
    })
      .then((unsubscribe) => {
        if (dead) unsubscribe();
        else dispose = unsubscribe;
      })
      .catch((cause) => setError(`Progress connection failed: ${String(cause)}`));
    return () => {
      dead = true;
      dispose?.();
    };
  }, [desktop]);
  useEffect(() => {
    if (!desktop) return;
    let dead = false;
    let dispose: (() => void) | undefined;
    subscribeMetrics((sample) => {
      const job = active.current;
      if (!job || job.cancelled || (job.jobId && sample.jobId !== job.jobId)) return;
      job.jobId = sample.jobId;
      setRunExecution((previous) => (previous ? { ...previous, jobId: sample.jobId } : previous));
      setRunStatus('running');
      liveMetrics.current = appendTrainingMetric(liveMetrics.current, sample, job.jobId);
      setMetrics((history) => appendTrainingMetric(history, sample, job.jobId));
    })
      .then((unsubscribe) => {
        if (dead) unsubscribe();
        else dispose = unsubscribe;
      })
      .catch((cause) => setError(`Training metric connection failed: ${String(cause)}`));
    return () => {
      dead = true;
      dispose?.();
    };
  }, [desktop]);
  useEffect(() => {
    if (!busy) return;
    const interval = window.setInterval(() => {
      if (runStarted.current !== null)
        setRunElapsed((performance.now() - runStarted.current) / 1000);
    }, 500);
    return () => window.clearInterval(interval);
  }, [busy]);
  const refreshDevices = async () => {
    if (!desktop || busyRef.current || fileBusyRef.current || deviceBusyRef.current) return;
    deviceBusyRef.current = true;
    setDeviceBusy(true);
    try {
      setDeviceError(null);
      setDevices(await getDevices(structuredClone(projectRef.current)));
    } catch (cause) {
      setDeviceError(String(cause));
      setError(`Device detection failed: ${String(cause)}`);
    } finally {
      deviceBusyRef.current = false;
      setDeviceBusy(false);
    }
  };
  useEffect(() => {
    if (section === 'solver' && !devices && !verification && !deviceError) void refreshDevices();
  }, [section, devices, desktop, verification, deviceError]);
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  const recovery = useRecoverySession({
    desktop,
    verification,
    project,
    dirty,
    invalidDrafts: invalidDraftLabels.length,
    blocked: !!busy || !!fileBusy || deviceBusy || confirmation,
    onRestore: (next) => {
      replace(next);
      setDirty(true);
      setNotice('Project definition recovered · recompute results');
    },
    onError: (message) => setError(message),
  });
  recoveryBusyRef.current = recovery.pending || recovery.prompt || !recovery.ready;
  clearRecoveryRef.current = recovery.clearOwn;
  const locked = !!busy || !!fileBusy || deviceBusy || recoveryBusyRef.current;
  useModalFocus(
    confirmation || help || recovery.prompt,
    () => {
      if (confirmation) {
        setConfirmation(false);
        confirmResolver.current?.('cancel');
        confirmResolver.current = null;
      } else if (help) setHelp(false);
      else if (!recovery.pending) recovery.setPrompt(false);
    },
    confirmation ? 'unsaved' : help ? 'help' : recovery.prompt ? 'recovery' : null,
  );
  useDesktopLifecycle({
    desktop,
    busyRef,
    fileBusyRef,
    confirmationRef,
    dirtyRef,
    canReplaceRef,
    help,
    confirmation,
    section,
    save,
    open,
    create,
    setHelpContext,
    setHelp,
    setError,
    undo: () => navigateHistory('undo'),
    redo: () => navigateHistory('redo'),
    historyBlocked: locked || confirmation || help || invalidDraftLabels.length > 0,
  });

  const resize = (event: React.PointerEvent<HTMLDivElement>, side: 'left' | 'right') => {
    event.preventDefault();
    const start = event.clientX;
    const width = side === 'left' ? leftWidth : rightWidth;
    const move = (pointer: PointerEvent) => {
      const next = Math.max(
        side === 'left' ? 184 : 260,
        Math.min(
          side === 'left' ? 360 : 430,
          width + (pointer.clientX - start) * (side === 'left' ? 1 : -1),
        ),
      );
      (side === 'left' ? setLeftWidth : setRightWidth)(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  };
  const selectRegion = (region: RegionId) =>
    setSelected((previous) =>
      previous.includes(region)
        ? previous.filter((item) => item !== region)
        : [...previous, region],
    );
  const selectSection = (next: Section, id?: string) => {
    if (
      invalidDraftsRef.current.size &&
      (next !== section ||
        (next === 'constraints' && id !== constraintId) ||
        (next === 'loads' && id !== loadId) ||
        (next === 'selections' && id !== namedSelectionId))
    ) {
      setError('Complete the numeric input, or press Escape to revert it before changing editors.');
      return;
    }
    setSection(next);
    if (next === 'constraints' && id) {
      setConstraintId(id);
      setSelected(project.study.constraints.find((item) => item.id === id)?.regions ?? []);
    }
    if (next === 'loads' && id) {
      setLoadId(id);
      setSelected(project.study.loads.find((item) => item.id === id)?.regions ?? []);
    }
    if (next === 'selections' && id) {
      setNamedSelectionId(id);
      const item = project.namedSelections.find((candidate) => candidate.id === id);
      setSelected(item && selectionIsCompatible(project, item) ? [...item.regions] : []);
    }
  };
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
        regions: assignedRegions(selected, 'x0'),
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
        regions: assignedRegions(selected, 'x1'),
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
  const boundaryEditor = (item: Constraint | Load, change: (regions: RegionId[]) => void) => (
    <>
      {project.namedSelections.length > 0 && (
        <label className="field-label">
          <span>Copy a named selection</span>
          <select
            value=""
            onChange={(event) => {
              const group = project.namedSelections.find(
                (candidate) => candidate.id === event.target.value,
              );
              if (group && selectionIsCompatible(project, group)) {
                change([...group.regions]);
                setSelected([...group.regions]);
              }
            }}
          >
            <option value="">Choose boundary set…</option>
            {project.namedSelections.map((group) => (
              <option
                key={group.id}
                value={group.id}
                disabled={!selectionIsCompatible(project, group)}
              >
                {group.name}
                {selectionIsCompatible(project, group) ? '' : ' · repair required'}
              </option>
            ))}
          </select>
          <small className="property-hint">
            Copies the boundaries. Later group edits do not change this assignment.
          </small>
        </label>
      )}
      <div className="boundary-list">
        {regions.map((region) => (
          <label key={region.id}>
            <input
              type="checkbox"
              checked={item.regions.includes(region.id)}
              onChange={() =>
                change(
                  item.regions.includes(region.id)
                    ? item.regions.filter((candidate) => candidate !== region.id)
                    : [...item.regions, region.id],
                )
              }
            />
            <span>{region.name}</span>
            <code>{region.id}</code>
          </label>
        ))}
      </div>
      <button
        className="secondary full"
        disabled={!selected.length}
        onClick={() => change([...selected])}
      >
        Use viewport selection ({selected.length})
      </button>
    </>
  );
  const stat = currentData?.manifest.statistics;
  const chooseDimension = (dimension: Project['study']['dimension']) => {
    if (invalidDraftsRef.current.size) {
      setError('Complete or revert the numeric input before changing dimension.');
      return;
    }
    if (dimension === project.study.dimension) return;
    const count = project.study.constraints.length + project.study.loads.length;
    edit((next) => changeStudyDimension(next, dimension));
    setNotice(
      `Study dimension changed · ${count} boundary assignments cleared. Undo restores the previous definition.`,
    );
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setNamedSelectionId(null);
    setAnimate(false);
  };
  const chooseSource = (source: FieldSource) => {
    setFieldSource(source);
    setProbe(null);
    if (source !== 'fem' && source !== 'primary' && fieldId.startsWith('reactions'))
      setFieldId('displacement-mag');
  };

  return {
    selectionMode,
    setSelectionMode,
    undo: () => navigateHistory('undo'),
    redo: () => navigateHistory('redo'),
    canUndo:
      !locked &&
      !confirmation &&
      !help &&
      invalidDraftLabels.length === 0 &&
      !!historyRef.current?.past.length,
    canRedo:
      !locked &&
      !confirmation &&
      !help &&
      invalidDraftLabels.length === 0 &&
      !!historyRef.current?.future.length,
    undoLabel: historyRef.current?.past.at(-1)?.label ?? '',
    redoLabel: historyRef.current?.future.at(-1)?.label ?? '',
    namedSelectionId,
    namedSelection,
    addNamedSelection,
    editNamedSelection,
    useNamedSelection,
    setNamedSelectionId,
    setNotice,
    recovery,
    rightWidth,
    section,
    showHelp,
    locked,
    project,
    edit,
    is2D,
    chooseDimension,
    factor,
    selectSection,
    isPinn,
    devices,
    desktop,
    refreshDevices,
    deviceBusy,
    deviceError,
    validation,
    execute,
    invalidDraftsRef,
    setError,
    setSelected,
    setConstraintId,
    setLoadId,
    regions,
    selected,
    selectRegion,
    stat,
    addConstraint,
    constraint,
    editConstraint,
    boundaryEditor,
    addLoad,
    load,
    editLoad,
    solved,
    data,
    fieldId,
    setFieldId,
    setProbe,
    availableFields,
    deformation,
    setDeformation,
    customScale,
    setCustomScale,
    animate,
    setAnimate,
    probe,
    currentData,
    exportFields,
    fileBusy,
    busy,
    dirty,
    reportDraftValidity,
    path,
    theme,
    preference,
    setPreference,
    create,
    open,
    save,
    leftWidth,
    constraintId,
    loadId,
    resize,
    cancelling,
    cancel,
    referenceId,
    inspectReference,
    error,
    edges,
    setEdges,
    fieldSource,
    chooseSource,
    field,
    verification,
    verified,
    fileBusyLabel,
    progress,
    notice,
    metrics,
    runStatus,
    runExecution,
    runElapsed,
    runTab,
    setRunTab,
    setRunExpanded,
    runExpanded,
    confirmation,
    setConfirmation,
    confirmResolver,
    help,
    helpContext,
    setHelp,
  };
}
export type Workbench = ReturnType<typeof useWorkbench>;
