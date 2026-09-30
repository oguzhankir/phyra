import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  CircleHelp,
  Layers3,
  LockKeyhole,
  Magnet,
  Play,
  Plus,
  Save,
  Square,
  Trash2,
  TriangleAlert,
  Cpu,
  BrainCircuit,
  GitCompareArrows,
  Pause,
  X,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { makeProject, type ExampleId } from './examples';
import {
  cancelJob,
  exportResults,
  openProject,
  readBuffer,
  runJob,
  saveProject,
  subscribeProgress,
  subscribeMetrics,
  getDevices,
} from './bridge';
import type {
  Constraint,
  Devices,
  Load,
  Operation,
  Progress,
  Project,
  TrainingMetric,
} from './types';
import {
  displayValue,
  extractField,
  fieldOptions,
  formatValue,
  lengthFactor,
  regionNames,
  type FieldId,
  type RegionId,
  type ResultData,
  type FieldSource,
} from './fields';
import Viewport, { type Probe } from './features/viewport/Viewport';
import {
  NumericDraftContext,
  NumberInput,
  Group,
  Metric,
} from './features/workbench/PropertyControls';
import { sectionTitles, sectionDescriptions, type Section } from './features/workbench/navigation';
import { useTheme } from './features/workbench/theme';
import WorkbenchHeader from './features/workbench/WorkbenchHeader';
import ModelTree from './features/workbench/ModelTree';
import HelpPanel from './features/help/HelpPanel';
import type { HelpContext } from './features/help/content';
import { loadReference, referenceLabels, type ReferenceId } from './features/examples/references';
import { contourGradient } from './features/viewport/contours';
import {
  appendTrainingMetric,
  changeStudyDimension,
  changeStudySolver,
  primaryOperation,
  resultIsCurrent,
  type RunExecution,
} from './studyUI';
import RunWorkspace, { type RunStatus, type RunTab } from './features/runs/RunWorkspace';

const uid = () => crypto.randomUUID();
function assignedRegions(values: RegionId[], fallback: RegionId): Constraint['regions'] {
  return values.length ? [values[0], ...values.slice(1)] : [fallback];
}
function inputError(project: Project): string | null {
  const g = project.geometry;
  const dimensions =
    project.study.dimension === '2d'
      ? [g.length, g.width, project.study.thickness]
      : g.kind === 'cylinder'
        ? [g.length, g.radius]
        : g.kind === 'bracket'
          ? [g.length, g.width, g.height, g.thickness]
          : [g.length, g.width, g.height];
  if (dimensions.some((value) => !Number.isFinite(value) || value <= 0 || value > 1000))
    return 'Geometry dimensions must be finite, positive, and at most 1,000 m.';
  if (g.kind === 'bracket' && g.thickness >= Math.min(g.length, g.width))
    return 'Bracket thickness must be smaller than both leg dimensions.';
  if (!(project.study.material.young > 0) || project.study.material.young > 1e15)
    return 'Young’s modulus must be positive and at most 1,000,000 GPa.';
  if (!(project.study.material.poisson > -1 && project.study.material.poisson <= 0.45))
    return 'Poisson’s ratio must be greater than −1 and at most 0.45 for this formulation.';
  if (!(project.study.mesh.size > 0) || project.study.mesh.size > 1000)
    return 'Mesh size must be positive and at most 1,000 m.';
  if (project.study.solver.kind === 'pinn' && project.study.dimension !== '2d')
    return 'PINN is supported for 2D plane stress only.';
  const settings = project.study.solver.pinn;
  if (
    ![
      settings.layers,
      settings.width,
      settings.steps,
      settings.interiorPoints,
      settings.boundaryPoints,
      settings.seed,
    ].every(Number.isInteger) ||
    settings.layers < 1 ||
    settings.layers > 6 ||
    settings.width < 4 ||
    settings.width > 128 ||
    settings.steps < 1 ||
    settings.steps > 20000 ||
    settings.interiorPoints < 8 ||
    settings.interiorPoints > 4096 ||
    settings.boundaryPoints < 4 ||
    settings.boundaryPoints > 1024 ||
    settings.seed < 0 ||
    settings.seed > 2147483647
  )
    return 'PINN architecture, sample counts, training steps, and seed must be supported integers.';
  if (!(settings.learningRate >= 1e-6 && settings.learningRate <= 0.05))
    return 'Learning rate must be between 0.000001 and 0.05.';
  if (
    project.study.constraints.some(
      (item) => !item.regions.length || item.components.every((component) => component === null),
    )
  )
    return 'Each support needs at least one boundary and one prescribed component.';
  if (project.study.loads.some((item) => !item.regions.length))
    return 'Each load needs at least one boundary.';
  if (
    !project.name.trim() ||
    !project.study.material.name.trim() ||
    project.study.constraints.some((item) => !item.name.trim()) ||
    project.study.loads.some((item) => !item.name.trim())
  )
    return 'Project, material, support, and load names cannot be empty.';
  return null;
}

export default function App() {
  const [project, setProject] = useState<Project>(() => makeProject('plane-stress-tension'));
  const projectRef = useRef(project);
  projectRef.current = project;
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
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
  const [constraintId, setConstraintId] = useState<string | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
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
  const [leftWidth, setLeftWidth] = useState(236);
  const [rightWidth, setRightWidth] = useState(328);
  const [help, setHelp] = useState(false);
  const [helpContext, setHelpContext] = useState<HelpContext>('overview');
  const { theme, preference, setPreference } = useTheme();
  const showHelp = (context: HelpContext = section) => {
    setHelpContext(context);
    setHelp(true);
  };
  const [verification, setVerification] = useState(false);
  const verificationStarted = useRef(false);
  const verificationSent = useRef(false);
  const [verificationConfiguration, setVerificationConfiguration] = useState<
    '3d' | '2d-compare' | null
  >(null);
  const verificationReports = useRef<Record<string, Record<string, unknown>>>({});
  const verificationDisplacement = useRef<Record<string, unknown> | null>(null);
  const desktop = '__TAURI_INTERNALS__' in window;
  const locked = !!busy || !!fileBusy || deviceBusy;
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
  const regions = regionNames(project.geometry.kind).filter(
    (region) => !is2D || ['x0', 'x1', 'y0', 'y1'].includes(region.id),
  );
  const factor = lengthFactor(project.displayUnits);
  const constraint = project.study.constraints.find((item) => item.id === constraintId);
  const load = project.study.loads.find((item) => item.id === loadId);

  const edit = useCallback((change: (next: Project) => void, physical = true) => {
    if (busyRef.current || fileBusyRef.current) return;
    setProject((previous) => {
      const next = structuredClone(previous);
      change(next);
      if (physical) next.revision++;
      return next;
    });
    setDirty(true);
    setProbe(null);
    setError(null);
  }, []);
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (!desktop || busyRef.current || fileBusyRef.current) return false;
      if (invalidDraftsRef.current.size) {
        setError('Complete or revert the invalid numeric input before saving.');
        return false;
      }
      fileBusyRef.current = 'save';
      setFileBusy('save');
      try {
        const current = structuredClone(projectRef.current);
        const cache =
          data &&
          data.manifest.projectId === current.id &&
          data.manifest.revision === current.revision
            ? data.manifest.jobId
            : undefined;
        const saved = await saveProject(current, cache, saveAs);
        if (!saved) return false;
        setPath(saved);
        setDirty(false);
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
    if (busyRef.current || fileBusyRef.current || confirmationRef.current) return false;
    if (!dirtyRef.current) return true;
    confirmationRef.current = true;
    setHelp(false);
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmation(true);
    });
    confirmationRef.current = false;
    if (choice === 'cancel') return false;
    return choice === 'save' ? await save() : true;
  }, [save]);
  const canReplaceRef = useRef(canReplace);
  canReplaceRef.current = canReplace;
  const replace = (next: Project, result: ResultData | null = null) => {
    setProject(next);
    setData(result);
    setDirty(false);
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
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
      if (await canReplace()) replace(makeProject(example));
    },
    [canReplace],
  );
  const open = useCallback(async () => {
    if (!desktop || !(await canReplace())) return;
    if (busyRef.current || fileBusyRef.current) return;
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
    } catch (cause) {
      setError(String(cause));
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  }, [canReplace, desktop]);
  const inspectReference = async (id: ReferenceId) => {
    if (desktop || deviceBusyRef.current || !(await canReplace())) return;
    if (busyRef.current || fileBusyRef.current) return;
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
      deviceBusyRef.current
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
  useEffect(() => {
    if (!desktop || verificationStarted.current) return;
    verificationStarted.current = true;
    void invoke<'3d' | '2d-compare' | null>('verification_configuration')
      .then((configuration) => {
        if (configuration) {
          const next = makeProject(
            configuration === '2d-compare' ? 'plane-stress-tension' : 'cantilever',
          );
          if (configuration === '2d-compare') {
            next.study.solver.kind = 'pinn';
            next.study.solver.pinn.layers = 2;
            next.study.solver.pinn.width = 16;
            next.study.solver.pinn.steps = 2000;
            next.study.solver.pinn.interiorPoints = 128;
            next.study.solver.pinn.boundaryPoints = 32;
            next.study.solver.pinn.device = 'cpu';
          }
          replace(next);
          setDeformation('actual');
          setVerificationConfiguration(configuration);
          setVerification(true);
        }
      })
      .catch((cause) => setError(String(cause)));
  }, [desktop]);
  useEffect(() => {
    if (verification && !active.current)
      void execute(verificationConfiguration === '2d-compare' ? 'compare' : 'solve');
  }, [verification]);
  const verified = (report: Record<string, unknown>) => {
    if (!verification || verificationSent.current || !currentData) return;
    void invoke('verification_trace', { message: `frontend rendered ${fieldId}` });
    if (verificationConfiguration === '2d-compare') {
      const reports = verificationReports.current;
      if (fieldSource === 'fem' && fieldId === 'displacement-mag') {
        reports.renderer = report;
        setFieldId('vonMises');
        return;
      }
      if (fieldSource === 'fem' && fieldId === 'vonMises') {
        reports.stressRenderer = { ...report, viewportPng: null };
        setFieldSource('pinn');
        setFieldId('displacement-mag');
        return;
      }
      if (fieldSource === 'pinn') {
        reports.pinnRenderer = { ...report, viewportPng: null };
        setFieldSource('difference');
        return;
      }
      if (fieldSource === 'difference') {
        reports.differenceRenderer = { ...report, viewportPng: null };
        verificationSent.current = true;
        void invoke('verification_complete', {
          report: {
            project,
            manifest: currentData.manifest,
            ...reports,
            metrics: {
              count: liveMetrics.current.length,
              first: liveMetrics.current[0],
              last: liveMetrics.current.at(-1),
            },
          },
        }).catch((cause) => setError(String(cause)));
      }
      return;
    }
    if (!verificationDisplacement.current) {
      verificationDisplacement.current = report;
      setFieldId('vonMises');
      return;
    }
    if (fieldId !== 'vonMises') return;
    verificationSent.current = true;
    void invoke('verification_complete', {
      report: {
        project,
        manifest: currentData.manifest,
        renderer: verificationDisplacement.current,
        stressRenderer: { ...report, viewportPng: null },
      },
    }).catch((cause) => setError(String(cause)));
  };
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
  useEffect(() => {
    if (!confirmation && !help) return;
    const previous = document.activeElement;
    const modal = document.querySelector<HTMLElement>('.modal');
    const focusable = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
        ) ?? [],
      ).filter((element) => element.getClientRects().length > 0);
    (modal?.querySelector<HTMLInputElement>('input') ?? focusable()[0])?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmation) {
          setConfirmation(false);
          confirmResolver.current?.('cancel');
          confirmResolver.current = null;
        } else setHelp(false);
      }
      const buttons = focusable();
      if (event.key === 'Tab' && buttons.length) {
        const index = buttons.indexOf(document.activeElement as HTMLElement);
        const next = event.shiftKey
          ? index <= 0
            ? buttons.length - 1
            : index - 1
          : (index + 1) % buttons.length;
        event.preventDefault();
        buttons[next].focus();
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      window.removeEventListener('keydown', key);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [confirmation, help]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === 'F1') {
        event.preventDefault();
        if (!confirmation) {
          setHelpContext(section);
          setHelp(true);
        }
        return;
      }
      if (!event.metaKey && !event.ctrlKey) return;
      const character = event.key.toLowerCase();
      if (!['s', 'o', 'n'].includes(character)) return;
      event.preventDefault();
      if (busyRef.current || fileBusyRef.current || confirmationRef.current || help) return;
      if (character === 's') void save(event.shiftKey);
      if (character === 'o') void open();
      if (character === 'n') void create();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirtyRef.current || busyRef.current || fileBusyRef.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('keydown', key);
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [save, open, create, help, confirmation, section]);
  useEffect(() => {
    if (!desktop) return;
    let unsubscribe: (() => void) | undefined;
    let dead = false;
    import('@tauri-apps/api/window')
      .then(async ({ getCurrentWindow }) => {
        const window = getCurrentWindow();
        const remove = await window.onCloseRequested(async (event) => {
          if (busyRef.current || fileBusyRef.current) {
            event.preventDefault();
            setError(
              fileBusyRef.current
                ? 'Wait for the project file operation to finish before closing Phyra.'
                : 'Cancel the running job before closing Phyra.',
            );
            return;
          }
          if (dirtyRef.current) {
            event.preventDefault();
            if (await canReplaceRef.current()) await window.destroy();
          }
        });
        if (dead) remove();
        else unsubscribe = remove;
      })
      .catch((cause) => setError(`Window lifecycle failed: ${String(cause)}`));
    return () => {
      dead = true;
      unsubscribe?.();
    };
  }, [desktop]);

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
        (next === 'loads' && id !== loadId))
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
    edit((next) => changeStudyDimension(next, dimension));
    setSelected([]);
    setConstraintId(null);
    setLoadId(null);
    setAnimate(false);
  };
  const chooseSource = (source: FieldSource) => {
    setFieldSource(source);
    setProbe(null);
    if (source !== 'fem' && source !== 'primary' && fieldId.startsWith('reactions'))
      setFieldId('displacement-mag');
  };

  return (
    <NumericDraftContext.Provider value={reportDraftValidity}>
      <div className="app-shell">
        <WorkbenchHeader
          name={project.name}
          path={path}
          dirty={dirty}
          locked={locked}
          canUseFiles={desktop}
          canSave={!locked && !validation && desktop}
          canExport={!locked && solved && desktop}
          device={
            currentData?.manifest.training?.device ??
            (isPinn
              ? project.study.solver.pinn.device === 'auto'
                ? 'CPU · float64 (Auto)'
                : project.study.solver.pinn.device.toUpperCase()
              : 'FEM · CPU')
          }
          theme={theme}
          preference={preference}
          onTheme={setPreference}
          onNew={() => void create()}
          onOpen={() => void open()}
          onSave={(saveAs) => void save(saveAs)}
          onExport={() => void exportFields()}
          onHelp={() => showHelp()}
          onFilesHelp={() => showHelp('files')}
        />
        <div className="workspace">
          <aside className="model-panel" style={{ width: leftWidth }}>
            <ModelTree
              project={project}
              section={section}
              constraintId={constraintId}
              loadId={loadId}
              locked={locked}
              cells={stat?.cells}
              solved={solved}
              stale={!!data && !currentData}
              onSection={selectSection}
              onExample={(example) => void create(example)}
              onAddSupport={addConstraint}
              onAddLoad={addLoad}
            />
          </aside>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize model panel"
            onPointerDown={(event) => resize(event, 'left')}
          />
          <main className="work-area">
            <div className="work-heading">
              <div>
                <span className="eyebrow">
                  STATIC STRUCTURAL · {is2D ? '2D PLANE STRESS' : '3D SOLID'}
                </span>
                <h1>{sectionTitles[section]}</h1>
                <p className="work-subtitle">{sectionDescriptions[section]}</p>
              </div>
              <div className="run-actions">
                <button
                  className="secondary"
                  disabled={locked || !!validation || !desktop}
                  onClick={() => void execute('mesh')}
                >
                  <Magnet size={15} />
                  Mesh
                </button>
                {is2D && !busy && (
                  <button
                    className="secondary"
                    disabled={locked || !!validation || !desktop}
                    onClick={() => void execute('compare')}
                  >
                    <GitCompareArrows size={15} />
                    Compare
                  </button>
                )}
                {busy ? (
                  <button
                    className="cancel-button"
                    disabled={cancelling}
                    onClick={() => void cancel()}
                  >
                    <Square size={13} />
                    {cancelling ? 'Stopping…' : 'Cancel'}
                  </button>
                ) : (
                  <button
                    className="primary"
                    disabled={locked || !!validation || !desktop}
                    onClick={() => void execute(primaryOperation(project))}
                  >
                    <Play size={14} fill="currentColor" />
                    {isPinn ? 'Train PINN' : 'Run FEM'}
                  </button>
                )}
              </div>
            </div>
            {!desktop && (
              <div className="browser-banner">
                <span>
                  {referenceId ? (
                    <>
                      Saved CPU reference · {referenceLabels[referenceId]}. Recorded result
                      {referenceId === '2d-compare' ? ' and training history' : ''}; open the
                      desktop app to compute. Editing inputs makes fields stale.
                    </>
                  ) : (
                    <>
                      Browser preview · inspect saved CPU references, or open the desktop app to
                      compute and use native project files.
                    </>
                  )}
                </span>
                <div className="reference-actions">
                  <button disabled={locked} onClick={() => void inspectReference('3d')}>
                    Inspect 3D reference
                  </button>
                  <button disabled={locked} onClick={() => void inspectReference('2d-compare')}>
                    Inspect 2D comparison
                  </button>
                </div>
              </div>
            )}
            {validation && (
              <div className="inline-alert">
                <TriangleAlert size={15} />
                <span>{validation}</span>
              </div>
            )}
            {error && (
              <div className="error-alert" role="alert">
                <TriangleAlert size={16} />
                <span>{error}</span>
                <button aria-label="Dismiss error" onClick={() => setError(null)}>
                  <X size={15} />
                </button>
              </div>
            )}
            {data && !currentData && (
              <div className="stale-banner">
                <TriangleAlert size={14} />
                Inputs changed. Previous mesh and results are stale; run the analysis again.
              </div>
            )}
            <div className="viewport-toolbar">
              <div className="view-mode">
                <span className={solved ? 'indicator solved' : 'indicator'} />
                {solved ? 'Solution' : currentData ? 'Mesh' : 'Geometry'}
                <span className="toolbar-divider" />
                {is2D ? 'RECTANGLE' : project.geometry.kind.toUpperCase()}
              </div>
              <label className="edge-toggle">
                <input
                  type="checkbox"
                  checked={edges}
                  onChange={(event) => setEdges(event.target.checked)}
                />
                Mesh edges
              </label>
              <select
                aria-label="Displayed result field"
                disabled={!solved || locked}
                value={solved ? fieldId : 'geometry'}
                onChange={(event) => {
                  setFieldId(event.target.value as FieldId);
                  setProbe(null);
                }}
              >
                {availableFields.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {currentData?.manifest.operation === 'compare' && (
              <div className="comparison-source">
                {(
                  [
                    { id: 'fem', label: 'FEM' },
                    { id: 'pinn', label: 'PINN' },
                    { id: 'difference', label: 'Absolute Δ' },
                    { id: 'relative', label: 'Relative Δ' },
                  ] as const
                ).map((source) => (
                  <button
                    key={source.id}
                    className={fieldSource === source.id ? 'active' : ''}
                    onClick={() => chooseSource(source.id)}
                  >
                    {source.label}
                  </button>
                ))}
                <span>Matched nodes and cell centroids</span>
              </div>
            )}
            <div className="viewport-wrap">
              <Viewport
                theme={theme}
                project={project}
                data={currentData}
                field={field}
                selected={selected}
                onSelect={selectRegion}
                onProbe={setProbe}
                onVerified={verification ? verified : undefined}
                edges={edges}
                source={fieldSource}
                animate={animate}
                deformation={deformation}
                customScale={customScale}
              />
              {field && (
                <div className="contour-legend">
                  <strong>{field.label}</strong>
                  <span>
                    {field.association === 'cell' ? 'Element values' : 'Nodal values'} ·{' '}
                    {is2D ? 'full domain' : 'full volume'}
                  </span>
                  {field.finiteCount === 0 ? (
                    <small>No defined relative values · zero references omitted</small>
                  ) : (
                    <>
                      <div
                        className="legend-gradient"
                        style={{ background: contourGradient(field.minimum, field.maximum) }}
                      />
                      <div className="legend-labels">
                        <span>
                          {formatValue(
                            displayValue(field.minimum, field.units, project.displayUnits).value,
                          )}
                        </span>
                        <b>{displayValue(0, field.units, project.displayUnits).units}</b>
                        <span>
                          {formatValue(
                            displayValue(field.maximum, field.units, project.displayUnits).value,
                          )}
                        </span>
                      </div>
                      {field.minimum === field.maximum && <small>Constant field</small>}
                    </>
                  )}
                </div>
              )}
            </div>
            <div className="selection-bar">
              <span>
                <span className="selection-dot" />
                {selected.length
                  ? `${selected.length} ${selected.length === 1 ? 'boundary' : 'boundaries'} selected`
                  : 'Select a boundary in the viewport'}
              </span>
              {selected.length > 0 && (
                <>
                  <div className="selection-chips">
                    {selected.map((region) => (
                      <button key={region} onClick={() => selectRegion(region)}>
                        {region}
                        <X size={10} />
                      </button>
                    ))}
                  </div>
                  <button className="text-button" disabled={locked} onClick={addConstraint}>
                    Add support
                  </button>
                  <button className="text-button" disabled={locked} onClick={addLoad}>
                    Add load
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Clear selection"
                    onClick={() => setSelected([])}
                  >
                    <X size={14} />
                  </button>
                </>
              )}
            </div>
            <div className="diagnostics-strip">
              {stat ? (
                <>
                  <span>
                    <b>{stat.nodes.toLocaleString()}</b> nodes
                  </span>
                  <span>
                    <b>{stat.cells.toLocaleString()}</b> cells
                  </span>
                  <span title={stat.qualityMetric}>
                    Minimum quality <b>{formatValue(stat.minQuality)}</b>
                  </span>
                </>
              ) : (
                <span>Geometry ready · generate a mesh to inspect discretization</span>
              )}
              <span className="status-right">
                {fileBusy ? (
                  <>
                    <span className="spinner" />
                    {fileBusyLabel}
                  </>
                ) : busy ? (
                  <>
                    <span className="spinner" />
                    {progress?.stage ?? (busy === 'mesh' ? 'Starting mesher' : 'Starting solver')}
                    {progress?.progress != null && (
                      <progress max={1} value={progress.progress} aria-label="Engine progress" />
                    )}
                  </>
                ) : notice ? (
                  <>
                    <Check size={13} />
                    {notice}
                  </>
                ) : (
                  <>
                    <span className="status-dot" />
                    Ready
                  </>
                )}
              </span>
            </div>
            <RunWorkspace
              project={project}
              manifest={currentData?.manifest}
              recordedReference={!!referenceId}
              history={metrics}
              status={runStatus}
              execution={runExecution}
              elapsed={runElapsed}
              stage={busy ? progress?.stage : undefined}
              tab={runTab}
              onTab={(tab) => {
                setRunTab(tab);
                setRunExpanded(true);
              }}
              expanded={runExpanded}
              onToggle={() => setRunExpanded((value) => !value)}
            />
          </main>
          <div
            className="panel-splitter"
            role="separator"
            aria-label="Resize properties panel"
            onPointerDown={(event) => resize(event, 'right')}
          />
          <aside className="properties-panel" style={{ width: rightWidth }}>
            <div className="panel-heading">
              <span>{sectionTitles[section].toUpperCase()}</span>
              <button
                className="property-help"
                aria-label={`Help with ${sectionTitles[section].toLowerCase()}`}
                title="Help with this editor"
                onClick={() => showHelp()}
              >
                <CircleHelp size={16} />
              </button>
            </div>
            <div className="properties-scroll">
              <fieldset disabled={locked} key={`${project.id}:${project.displayUnits}`}>
                {section === 'study' && (
                  <>
                    <Group title="Static structural study">
                      <label className="field-label">
                        <span>Project name</span>
                        <input
                          value={project.name}
                          maxLength={200}
                          onChange={(event) =>
                            edit((next) => {
                              next.name = event.target.value;
                            }, false)
                          }
                        />
                      </label>
                      <label className="field-label">
                        <span>Dimension</span>
                      </label>
                      <div className="segmented">
                        <button
                          className={is2D ? 'active' : ''}
                          onClick={() => chooseDimension('2d')}
                        >
                          2D
                        </button>
                        <button
                          className={!is2D ? 'active' : ''}
                          onClick={() => chooseDimension('3d')}
                        >
                          3D
                        </button>
                      </div>
                      <div className="info-card">
                        <Activity size={18} />
                        <div>
                          <strong>{is2D ? 'Plane stress' : '3D solid elasticity'}</strong>
                          <p>
                            {is2D
                              ? 'In-plane X/Y deformation with σzz = 0. Thickness defines the physical cross-section of the 2D domain.'
                              : 'Three displacement components in a connected 3D solid, with homogeneous isotropic material.'}
                          </p>
                        </div>
                      </div>
                      {is2D && (
                        <NumberInput
                          label="Physical thickness"
                          value={project.study.thickness * factor}
                          unit={project.displayUnits}
                          onChange={(value) =>
                            edit((next) => {
                              next.study.thickness = value / factor;
                            })
                          }
                        />
                      )}
                      <p className="property-hint">
                        Static, small-strain linear elasticity. Changing dimension clears
                        incompatible boundary assignments.
                      </p>
                    </Group>
                    <Group title="Solution method">
                      <button className="secondary full" onClick={() => selectSection('solver')}>
                        <BrainCircuit size={15} />
                        {isPinn ? 'Configure experimental PINN' : 'Configure finite element method'}
                      </button>
                      <p className="property-hint">
                        {is2D
                          ? 'Use FEM and PINN on the same physical definition, then compare at shared evaluation locations.'
                          : 'The 3D study uses finite elements. The experimental PINN method supports 2D plane stress.'}
                      </p>
                    </Group>
                  </>
                )}
                {section === 'solver' && (
                  <>
                    <Group title="Solution method">
                      <div className="segmented">
                        <button
                          className={!isPinn ? 'active' : ''}
                          onClick={() => edit((next) => changeStudySolver(next, 'fem'))}
                        >
                          FEM
                        </button>
                        {is2D && (
                          <button
                            className={isPinn ? 'active' : ''}
                            onClick={() => edit((next) => changeStudySolver(next, 'pinn'))}
                          >
                            PINN
                          </button>
                        )}
                      </div>
                      <p className="property-hint">
                        {isPinn
                          ? 'Learn a displacement field from elasticity equilibrium and boundary-condition residuals.'
                          : `Sparse linear elasticity using ${is2D ? 'first-order triangles' : 'first-order tetrahedra'}.`}
                      </p>
                      {isPinn && (
                        <div className="experimental-note">
                          Experimental Physics ML. Training convergence is problem-dependent.
                          Inspect losses and compare with the classical reference before
                          interpreting a result.
                        </div>
                      )}
                    </Group>
                    {is2D && (
                      <>
                        <Group title="PINN training configuration">
                          <div className="form-grid">
                            {(
                              [
                                { key: 'layers', label: 'Hidden layers' },
                                { key: 'width', label: 'Layer width' },
                                { key: 'steps', label: 'Training steps' },
                                { key: 'seed', label: 'Seed' },
                              ] as const
                            ).map((setting) => (
                              <NumberInput
                                key={setting.key}
                                label={setting.label}
                                value={project.study.solver.pinn[setting.key]}
                                onChange={(value) =>
                                  edit((next) => {
                                    next.study.solver.pinn[setting.key] = value;
                                  })
                                }
                              />
                            ))}
                          </div>
                          <NumberInput
                            label="Learning rate"
                            value={project.study.solver.pinn.learningRate}
                            onChange={(value) =>
                              edit((next) => {
                                next.study.solver.pinn.learningRate = value;
                              })
                            }
                          />
                          <div className="form-grid">
                            <NumberInput
                              label="Interior samples"
                              value={project.study.solver.pinn.interiorPoints}
                              onChange={(value) =>
                                edit((next) => {
                                  next.study.solver.pinn.interiorPoints = value;
                                })
                              }
                            />
                            <NumberInput
                              label="Boundary samples"
                              value={project.study.solver.pinn.boundaryPoints}
                              onChange={(value) =>
                                edit((next) => {
                                  next.study.solver.pinn.boundaryPoints = value;
                                })
                              }
                            />
                          </div>
                          <p className="property-hint">
                            Tanh activation · Adam optimizer. These settings also apply to the PINN
                            leg of Compare.
                          </p>
                        </Group>
                        <Group title="Compute device">
                          <label className="field-label">
                            <span>Training device</span>
                            <select
                              value={project.study.solver.pinn.device}
                              onChange={(event) =>
                                edit((next) => {
                                  next.study.solver.pinn.device = event.target
                                    .value as Project['study']['solver']['pinn']['device'];
                                })
                              }
                            >
                              <option value="auto">Auto · CPU · float64</option>
                              {devices?.devices
                                .filter(
                                  (device) =>
                                    device.available && ['cpu', 'mps', 'cuda'].includes(device.id),
                                )
                                .map((device) => (
                                  <option key={device.id} value={device.id}>
                                    {device.label} · {device.precision}
                                  </option>
                                ))}
                              {project.study.solver.pinn.device !== 'auto' &&
                                !devices?.devices.some(
                                  (device) =>
                                    device.available &&
                                    device.id === project.study.solver.pinn.device,
                                ) && (
                                  <option value={project.study.solver.pinn.device} hidden>
                                    Saved preference ·{' '}
                                    {project.study.solver.pinn.device.toUpperCase()} (availability
                                    unconfirmed)
                                  </option>
                                )}
                            </select>
                          </label>
                          <button
                            className="secondary full"
                            disabled={!desktop || locked}
                            onClick={() => void refreshDevices()}
                          >
                            <Cpu size={14} />
                            {deviceBusy ? 'Detecting devices…' : 'Refresh available devices'}
                          </button>
                          {deviceError && (
                            <p className="draft-error">Device detection failed: {deviceError}</p>
                          )}
                          {devices ? (
                            <p className="property-hint">
                              {devices.devices
                                .filter((device) => device.available)
                                .map((device) => `${device.label}: ${device.precision}`)
                                .join(' · ')}
                              <br />
                              The completed run records the device and precision actually used.
                            </p>
                          ) : (
                            <p className="property-hint">
                              Device availability is queried from the installed numerical runtime.
                              Opening a project does not require a GPU.
                            </p>
                          )}
                        </Group>
                      </>
                    )}
                    <Group title="Execute">
                      <button
                        className="primary full"
                        disabled={!desktop || !!validation}
                        onClick={() => void execute(primaryOperation(project))}
                      >
                        {isPinn ? <BrainCircuit size={15} /> : <Play size={15} />}
                        {isPinn ? 'Train PINN' : 'Run FEM'}
                      </button>
                      {is2D && (
                        <button
                          className="secondary full"
                          style={{ marginTop: 9 }}
                          disabled={!desktop || !!validation}
                          onClick={() => void execute('compare')}
                        >
                          <GitCompareArrows size={15} />
                          Compare FEM + PINN
                        </button>
                      )}
                    </Group>
                  </>
                )}
                {section === 'geometry' && (
                  <>
                    <Group title={is2D ? 'Rectangular domain' : 'Solid definition'}>
                      <label className="field-label">
                        <span>{is2D ? 'Domain' : 'Primitive'}</span>
                        <select
                          value={project.geometry.kind}
                          onChange={(event) => {
                            if (invalidDraftsRef.current.size) {
                              setError(
                                'Complete or revert the numeric input before changing primitive.',
                              );
                              return;
                            }
                            edit((next) => {
                              next.geometry.kind = event.target
                                .value as Project['geometry']['kind'];
                              next.study.constraints = [];
                              next.study.loads = [];
                            });
                            setSelected([]);
                            setConstraintId(null);
                            setLoadId(null);
                          }}
                        >
                          <option value="box">
                            {is2D ? 'Rectangular domain' : 'Rectangular solid'}
                          </option>
                          {!is2D && (
                            <>
                              <option value="cylinder">Cylinder · X axis</option>
                              <option value="bracket">L bracket · XY plane</option>
                            </>
                          )}
                        </select>
                      </label>
                      {(
                        [
                          'length',
                          ...(is2D
                            ? ['width']
                            : project.geometry.kind === 'cylinder'
                              ? ['radius']
                              : [
                                  'width',
                                  'height',
                                  ...(project.geometry.kind === 'bracket' ? ['thickness'] : []),
                                ]),
                        ] as (keyof Omit<Project['geometry'], 'kind'>)[]
                      ).map((dimension) => (
                        <NumberInput
                          key={dimension}
                          label={dimension.charAt(0).toUpperCase() + dimension.slice(1)}
                          value={project.geometry[dimension] * factor}
                          unit={project.displayUnits}
                          onChange={(value) =>
                            edit((next) => {
                              next.geometry[dimension] = value / factor;
                            })
                          }
                        />
                      ))}
                    </Group>
                    <Group title="Display units">
                      <div className="segmented">
                        {(['mm', 'm'] as const).map((unit) => (
                          <button
                            key={unit}
                            className={project.displayUnits === unit ? 'active' : ''}
                            onClick={() =>
                              edit((next) => {
                                next.displayUnits = unit;
                              }, false)
                            }
                          >
                            {unit === 'mm' ? 'Millimeters' : 'Meters'}
                          </button>
                        ))}
                      </div>
                      <p className="property-hint">
                        Inputs and outputs convert for display. Authoritative geometry and solver
                        fields use SI.
                      </p>
                    </Group>
                    <Group title="Boundary regions">
                      <div className="boundary-list">
                        {regions.map((region) => (
                          <label key={region.id}>
                            <input
                              type="checkbox"
                              checked={selected.includes(region.id)}
                              onChange={() => selectRegion(region.id)}
                            />
                            <span>{region.name}</span>
                            <code>{region.id}</code>
                          </label>
                        ))}
                      </div>
                    </Group>
                    <p className="property-hint">
                      {is2D
                        ? 'Rectangle spans X = 0 to length and Y = 0 to width. Physical thickness belongs to the study.'
                        : project.geometry.kind === 'cylinder'
                          ? 'Cylinder spans X = 0 to length, centered on Y = Z = 0.'
                          : 'Geometry starts at the global origin. Brackets extend in X and Y, with height in Z.'}{' '}
                      Changing primitive clears its boundary assignments.
                    </p>
                  </>
                )}
                {section === 'material' && (
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
                          One isotropic material for the entire domain. Generic example properties
                          are editable demonstration inputs, not certified material data.
                        </p>
                      </div>
                    </div>
                    <p className="property-hint">
                      Supported ratio: −1 &lt; ν ≤ 0.45. Near incompressibility and idealized stress
                      singularities require careful interpretation.
                    </p>
                  </>
                )}
                {section === 'mesh' && (
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
                        <Metric
                          label={is2D ? 'Triangular cells' : 'Tetrahedral cells'}
                          value={stat.cells}
                        />
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
                          Stress is constant per element. Refine and compare meshes for bending; a
                          visually smooth contour does not establish convergence.
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
                )}
                {section === 'constraints' && (
                  <>
                    <Group
                      title="Displacement supports"
                      action={
                        <button
                          className="icon-button"
                          aria-label="Add support"
                          onClick={addConstraint}
                        >
                          <Plus size={16} />
                        </button>
                      }
                    >
                      {!constraint ? (
                        <div className="empty-state">
                          <LockKeyhole size={24} />
                          <p>
                            Select a support in the model tree or create one on the selected
                            boundaries.
                          </p>
                          <button className="secondary full" onClick={addConstraint}>
                            Add support
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="field-label">
                            <span>Name</span>
                            <input
                              value={constraint.name}
                              maxLength={200}
                              onChange={(event) =>
                                editConstraint((item) => {
                                  item.name = event.target.value;
                                })
                              }
                            />
                          </label>
                          <div className="segmented">
                            <button
                              className={
                                constraint.components
                                  .slice(0, is2D ? 2 : 3)
                                  .every((value) => value === 0)
                                  ? 'active'
                                  : ''
                              }
                              onClick={() =>
                                editConstraint((item) => {
                                  item.components = is2D ? [0, 0, null] : [0, 0, 0];
                                })
                              }
                            >
                              Fixed
                            </button>
                            <button
                              className={
                                constraint.components
                                  .slice(0, is2D ? 2 : 3)
                                  .some((value) => value !== 0)
                                  ? 'active'
                                  : ''
                              }
                              onClick={() =>
                                editConstraint((item) => {
                                  item.components = [0, null, null];
                                })
                              }
                            >
                              Components
                            </button>
                          </div>
                          <div className="component-editor">
                            {(is2D ? (['X', 'Y'] as const) : (['X', 'Y', 'Z'] as const)).map(
                              (axis, index) => (
                                <div key={axis}>
                                  <label className="component-check">
                                    <input
                                      type="checkbox"
                                      checked={constraint.components[index] !== null}
                                      onChange={(event) =>
                                        editConstraint((item) => {
                                          item.components[index] = event.target.checked ? 0 : null;
                                        })
                                      }
                                    />
                                    <span>U{axis.toLowerCase()}</span>
                                  </label>
                                  {constraint.components[index] !== null ? (
                                    <NumberInput
                                      label={`Prescribed ${axis}`}
                                      value={constraint.components[index]! * factor}
                                      unit={project.displayUnits}
                                      onChange={(value) =>
                                        editConstraint((item) => {
                                          item.components[index] = value / factor;
                                        })
                                      }
                                    />
                                  ) : (
                                    <span className="free-component">Free</span>
                                  )}
                                </div>
                              ),
                            )}
                          </div>
                        </>
                      )}
                    </Group>
                    {constraint && (
                      <>
                        <Group title="Assigned boundaries">
                          {boundaryEditor(constraint, (value) => {
                            if (!value.length) {
                              setError('A support needs at least one boundary.');
                              return;
                            }
                            editConstraint((item) => {
                              item.regions = assignedRegions(value, 'x0');
                            });
                          })}
                        </Group>
                        <button
                          className="danger full"
                          onClick={() => {
                            edit((next) => {
                              next.study.constraints = next.study.constraints.filter(
                                (item) => item.id !== constraint.id,
                              );
                            });
                            setConstraintId(null);
                          }}
                        >
                          <Trash2 size={14} />
                          Delete support
                        </button>
                      </>
                    )}
                    <p className="property-hint">
                      Prescribed values use the global axes. An unchecked component is free.
                      Conflicting assignments and rigid body freedom are reported by the engine.
                    </p>
                  </>
                )}
                {section === 'loads' && (
                  <>
                    <Group
                      title={is2D ? 'Boundary edge loads' : 'Surface loads'}
                      action={
                        <button className="icon-button" aria-label="Add load" onClick={addLoad}>
                          <Plus size={16} />
                        </button>
                      }
                    >
                      {!load ? (
                        <div className="empty-state">
                          <ArrowUpRight size={25} />
                          <p>
                            Select a load in the model tree or create one on the selected
                            boundaries.
                          </p>
                          <button className="secondary full" onClick={addLoad}>
                            Add load
                          </button>
                        </div>
                      ) : (
                        <>
                          <label className="field-label">
                            <span>Name</span>
                            <input
                              value={load.name}
                              maxLength={200}
                              onChange={(event) =>
                                editLoad((item) => {
                                  item.name = event.target.value;
                                })
                              }
                            />
                          </label>
                          <label className="field-label">
                            <span>Type</span>
                            <select
                              value={load.kind}
                              onChange={(event) =>
                                editLoad((item) => {
                                  item.kind = event.target.value as Load['kind'];
                                })
                              }
                            >
                              <option value="force">Distributed total force</option>
                              <option value="pressure">Boundary pressure</option>
                            </select>
                          </label>
                          {load.kind === 'force' ? (
                            <>
                              {(is2D ? (['X', 'Y'] as const) : (['X', 'Y', 'Z'] as const)).map(
                                (axis, index) => (
                                  <NumberInput
                                    key={axis}
                                    label={`Force ${axis}`}
                                    value={load.vector[index]}
                                    unit="N"
                                    onChange={(value) =>
                                      editLoad((item) => {
                                        item.vector[index] = value;
                                      })
                                    }
                                  />
                                ),
                              )}
                              <p className="property-hint">
                                {is2D
                                  ? 'One total vector force across assigned edges, distributed by edge length × physical thickness in the global frame.'
                                  : 'One total vector force across all assigned faces, distributed by surface area in the global frame.'}
                              </p>
                            </>
                          ) : (
                            <>
                              <NumberInput
                                label="Pressure"
                                value={load.pressure}
                                unit="Pa"
                                onChange={(value) =>
                                  editLoad((item) => {
                                    item.pressure = value;
                                  })
                                }
                              />
                              <p className="property-hint">
                                Positive pressure acts inward, opposite the outward solid boundary
                                normal. Negative pressure acts outward.
                              </p>
                            </>
                          )}
                        </>
                      )}
                    </Group>
                    {load && (
                      <>
                        <Group title="Assigned boundaries">
                          {boundaryEditor(load, (value) => {
                            if (!value.length) {
                              setError('A load needs at least one boundary.');
                              return;
                            }
                            editLoad((item) => {
                              item.regions = assignedRegions(value, 'x1');
                            });
                          })}
                        </Group>
                        <button
                          className="danger full"
                          onClick={() => {
                            edit((next) => {
                              next.study.loads = next.study.loads.filter(
                                (item) => item.id !== load.id,
                              );
                            });
                            setLoadId(null);
                          }}
                        >
                          <Trash2 size={14} />
                          Delete load
                        </button>
                      </>
                    )}
                  </>
                )}
              </fieldset>
              {section === 'results' &&
                (!solved ? (
                  <div className="empty-state result-empty">
                    <Activity size={30} />
                    <h3>
                      {data && data.manifest.operation !== 'mesh'
                        ? 'Solution is stale'
                        : 'No solution yet'}
                    </h3>
                    <p>
                      {data && data.manifest.operation !== 'mesh'
                        ? 'The inputs have changed. Solve again to inspect current physical fields.'
                        : 'Define your material, boundary supports, and loading, then solve the model.'}
                    </p>
                    <button
                      className="primary full"
                      disabled={locked || !!validation || !desktop}
                      onClick={() => void execute(primaryOperation(project))}
                    >
                      <Play size={14} />
                      {isPinn ? 'Train PINN' : 'Run FEM'}
                    </button>
                  </div>
                ) : (
                  <>
                    <Group title="Field visualization">
                      <label className="field-label">
                        <span>Contour</span>
                        <select
                          value={fieldId}
                          onChange={(event) => {
                            setFieldId(event.target.value as FieldId);
                            setProbe(null);
                          }}
                        >
                          {availableFields.map((option) => (
                            <option key={option.id} value={option.id}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="field-label">
                        <span>Deformation</span>
                        <select
                          value={deformation}
                          onChange={(event) =>
                            setDeformation(event.target.value as typeof deformation)
                          }
                        >
                          <option value="off">Undeformed</option>
                          <option value="actual">Actual scale · ×1</option>
                          <option value="auto">Auto amplification</option>
                          <option value="custom">Custom amplification</option>
                        </select>
                      </label>
                      {deformation === 'custom' && (
                        <NumberInput
                          label="Scale factor"
                          value={customScale}
                          physical={false}
                          unit="×"
                          onChange={(value) => setCustomScale(Math.max(0, value))}
                        />
                      )}
                      <div className="animation-control">
                        <button
                          className="secondary full"
                          aria-pressed={animate}
                          onClick={() => {
                            if (!animate && deformation === 'off') setDeformation('auto');
                            setAnimate((value) => !value);
                          }}
                        >
                          {animate ? <Pause size={14} /> : <Play size={14} />}
                          {animate ? 'Pause static deformation' : 'Play static deformation'}
                        </button>
                      </div>
                      <p className="property-hint">
                        Amplification uses displacement and model size, independent of the contour
                        field. Gray edges show the undeformed outline. Animation cycles the static
                        field; it is not a dynamic simulation.
                      </p>
                    </Group>
                    {probe && (
                      <Group title="Probe">
                        <div className="probe-value">
                          {formatValue(
                            displayValue(probe.value, probe.units, project.displayUnits).value,
                          )}{' '}
                          <span>{displayValue(0, probe.units, project.displayUnits).units}</span>
                        </div>
                        <p className="property-hint">
                          {probe.association === 'cell' ? 'Element' : 'Nearest surface node'} #
                          {probe.id} · boundary {probe.region}
                        </p>
                        {probe.association === 'node' && (
                          <p className="property-hint">
                            Reference position:{' '}
                            {probe.position.map((value) => formatValue(value * factor)).join(', ')}{' '}
                            {project.displayUnits}
                          </p>
                        )}
                      </Group>
                    )}
                    {currentData.manifest.summary && (
                      <Group
                        title={
                          currentData.manifest.operation === 'compare'
                            ? 'FEM reference summary'
                            : 'Physical summary'
                        }
                      >
                        <Metric
                          label="Maximum displacement"
                          value={currentData.manifest.summary.maxDisplacement * factor}
                          unit={project.displayUnits}
                        />
                        <Metric
                          label="Maximum von Mises"
                          value={currentData.manifest.summary.maxVonMises / 1e6}
                          unit="MPa"
                        />
                        <Metric
                          label="Strain energy"
                          value={currentData.manifest.summary.strainEnergy}
                          unit="J"
                        />
                        <Metric
                          label="Force imbalance"
                          value={Math.hypot(...currentData.manifest.summary.forceBalance)}
                          unit="N"
                        />
                        <Metric
                          label="Moment imbalance"
                          value={Math.hypot(...currentData.manifest.summary.momentBalance)}
                          unit="N·m"
                        />
                        <Metric
                          label={
                            currentData.manifest.operation === 'train'
                              ? 'PINN PDE residual · RMS'
                              : 'Relative free-DOF residual'
                          }
                          value={currentData.manifest.summary.relativeResidual}
                        />
                        <div className="vector-summary">
                          <span>Total applied force [N]</span>
                          <code>
                            {currentData.manifest.summary.totalForce.map(formatValue).join(', ')}
                          </code>
                          <span>Total support reaction [N]</span>
                          <code>
                            {currentData.manifest.summary.totalReaction.map(formatValue).join(', ')}
                          </code>
                        </div>
                        <Metric
                          label="Execution time"
                          value={currentData.manifest.summary.elapsedSeconds}
                          unit="s"
                        />
                        <p className="property-hint">
                          {is2D
                            ? 'Extrema include the complete 2D domain.'
                            : 'Extrema include the full volume.'}{' '}
                          {currentData.manifest.operation === 'train'
                            ? 'PINN reactions integrate learned support tractions. The PDE residual is the RMS of dimensionless stress divergence at interior collocation points.'
                            : 'FEM reactions use the original equilibrium equations.'}{' '}
                          Stresses use tensor shear components.
                        </p>
                      </Group>
                    )}
                    <button
                      className="secondary full"
                      disabled={locked || !desktop}
                      onClick={() => void exportFields()}
                    >
                      <ArrowDownToLine size={15} />
                      Export physical fields
                    </button>
                    <p className="property-hint">
                      Export retains authoritative SI values and element stress fields. Idealized
                      restraints and re-entrant corners can produce nonconvergent stress maxima.
                    </p>
                  </>
                ))}
              {currentData?.manifest.warnings.length ? (
                <div className="warning-list">
                  {currentData.manifest.warnings.map((warning, index) => (
                    <p key={index}>
                      <TriangleAlert size={14} />
                      {warning}
                    </p>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="properties-footer">
              {fileBusy ? (
                <>
                  <LockKeyhole size={12} />
                  Project file operation in progress
                </>
              ) : busy ? (
                <>
                  <LockKeyhole size={12} />
                  Inputs locked while worker runs
                </>
              ) : (
                <>
                  REV {project.revision}
                  <span>{dirty ? 'Modified' : 'Unchanged'}</span>
                </>
              )}
            </div>
          </aside>
        </div>
        {confirmation && (
          <div className="modal-backdrop">
            <div className="modal" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
              <div className="modal-icon">
                <Save size={23} />
              </div>
              <h2 id="unsaved-title">Save your changes?</h2>
              <p>
                Your current project has unsaved changes. Save before continuing, or discard them.
              </p>
              <div className="modal-actions">
                {(['cancel', 'discard', 'save'] as const).map((choice) => (
                  <button
                    key={choice}
                    className={choice === 'save' ? 'primary' : 'secondary'}
                    disabled={choice === 'save' && (!!validation || !desktop)}
                    onClick={() => {
                      setConfirmation(false);
                      confirmResolver.current?.(choice);
                      confirmResolver.current = null;
                    }}
                  >
                    {choice === 'save'
                      ? 'Save changes'
                      : choice === 'discard'
                        ? 'Discard'
                        : 'Cancel'}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
        {help && !confirmation && (
          <div className="modal-backdrop help-backdrop">
            <div
              className="modal help-dialog"
              role="dialog"
              aria-modal="true"
              aria-label="Phyra help"
            >
              <HelpPanel open={help} context={helpContext} onClose={() => setHelp(false)} />
            </div>
          </div>
        )}
      </div>
    </NumericDraftContext.Provider>
  );
}
