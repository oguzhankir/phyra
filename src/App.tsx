import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  FilePlus2,
  FolderOpen,
  Layers3,
  LockKeyhole,
  Magnet,
  Play,
  Plus,
  Save,
  Settings2,
  Square,
  Trash2,
  TriangleAlert,
  Waves,
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
} from './bridge';
import type { Constraint, Load, Progress, Project } from './types';
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
} from './fields';
import Viewport, { type Probe } from './Viewport';
import { parseNumericDraft } from './numericDraft';

const NumericDraftContext = createContext<(id: string, invalidLabel: string | null) => void>(
  () => {},
);

type Section = 'geometry' | 'material' | 'mesh' | 'constraints' | 'loads' | 'results';
const uid = () => crypto.randomUUID();
function assignedRegions(values: RegionId[], fallback: RegionId): Constraint['regions'] {
  return values.length ? [values[0], ...values.slice(1)] : [fallback];
}
function inputError(project: Project): string | null {
  const g = project.geometry;
  const dimensions =
    g.kind === 'cylinder'
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
function NumberInput({
  label,
  value,
  onChange,
  unit,
  disabled = false,
  physical = true,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: string;
  disabled?: boolean;
  physical?: boolean;
}) {
  const id = useId();
  const reportValidity = useContext(NumericDraftContext);
  const [text, setText] = useState(String(value));
  const textRef = useRef(text);
  textRef.current = text;
  const invalid = parseNumericDraft(text) === null;
  useEffect(() => {
    const parsed = parseNumericDraft(textRef.current);
    if (
      parsed === null ||
      Math.abs(parsed - value) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4
    ) {
      setText(String(value));
      if (physical) reportValidity(id, null);
    }
  }, [value, id, physical, reportValidity]);
  useEffect(
    () => () => {
      if (physical) reportValidity(id, null);
    },
    [id, physical, reportValidity],
  );
  return (
    <label className="field-label">
      <span>{label}</span>
      <div className={`input-with-unit ${invalid ? 'invalid-input' : ''}`}>
        <input
          type="text"
          inputMode="decimal"
          value={text}
          aria-invalid={invalid}
          disabled={disabled}
          onChange={(event) => {
            const draft = event.target.value;
            textRef.current = draft;
            setText(draft);
            const parsed = parseNumericDraft(draft);
            if (physical) reportValidity(id, parsed === null ? label : null);
            if (parsed !== null) onChange(parsed);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setText(String(value));
              if (physical) reportValidity(id, null);
            }
          }}
        />
        {unit && <span>{unit}</span>}
      </div>
      {invalid && (
        <small className="draft-error">Complete the number, or press Escape to revert.</small>
      )}
    </label>
  );
}
function Group({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="property-group">
      <div className="group-heading">
        <h3>{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>
        {formatValue(value)} <small>{unit}</small>
      </strong>
    </div>
  );
}
const sectionTitles: Record<Section, string> = {
  geometry: 'Geometry',
  material: 'Material',
  mesh: 'Mesh',
  constraints: 'Supports',
  loads: 'Loads',
  results: 'Results',
};

export default function App() {
  const [project, setProject] = useState<Project>(() => makeProject('cantilever'));
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
  const [data, setData] = useState<ResultData | null>(null);
  const [section, setSection] = useState<Section>('geometry');
  const [selected, setSelected] = useState<RegionId[]>([]);
  const [constraintId, setConstraintId] = useState<string | null>(null);
  const [loadId, setLoadId] = useState<string | null>(null);
  const [fieldId, setFieldId] = useState<FieldId>('geometry');
  const [edges, setEdges] = useState(true);
  const [deformation, setDeformation] = useState<'off' | 'actual' | 'auto' | 'custom'>('auto');
  const [customScale, setCustomScale] = useState(10);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [busy, setBusy] = useState<'mesh' | 'solve' | null>(null);
  const busyRef = useRef(busy);
  busyRef.current = busy;
  const [fileBusy, setFileBusy] = useState<'open' | 'save' | 'export' | null>(null);
  const fileBusyRef = useRef(fileBusy);
  fileBusyRef.current = fileBusy;
  const [progress, setProgress] = useState<Progress | null>(null);
  const [cancelling, setCancelling] = useState(false);
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
  const [verification, setVerification] = useState(false);
  const verificationStarted = useRef(false);
  const verificationSent = useRef(false);
  const verificationDisplacement = useRef<Record<string, unknown> | null>(null);
  const desktop = '__TAURI_INTERNALS__' in window;
  const locked = !!busy || !!fileBusy;
  const currentData =
    data &&
    data.manifest.projectId === project.id &&
    data.manifest.studyId === project.study.id &&
    data.manifest.revision === project.revision
      ? data
      : null;
  const solved = currentData?.manifest.operation === 'solve';
  const field = useMemo(() => extractField(currentData, fieldId), [currentData, fieldId]);
  const validation = invalidDraftLabels.length
    ? `${invalidDraftLabels[0]} has an incomplete or nonfinite numeric draft. Complete it, or press Escape to revert before continuing.`
    : inputError(project);
  const regions = regionNames(project.geometry.kind);
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
      if (busyRef.current || fileBusyRef.current) return false;
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
    [data],
  );
  const canReplace = useCallback(async (): Promise<boolean> => {
    if (busyRef.current || fileBusyRef.current || confirmationRef.current) return false;
    if (!dirtyRef.current) return true;
    confirmationRef.current = true;
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
    setSection('geometry');
    setFieldId(result?.manifest.operation === 'solve' ? 'displacement-mag' : 'geometry');
    setProbe(null);
    setProgress(null);
    setError(null);
    setPath(null);
  };
  const create = useCallback(
    async (example?: ExampleId) => {
      if (await canReplace()) replace(makeProject(example));
    },
    [canReplace],
  );
  const open = useCallback(async () => {
    if (!(await canReplace())) return;
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
      setNotice('Project opened');
    } catch (cause) {
      setError(String(cause));
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  }, [canReplace]);
  const exportFields = async () => {
    if (!currentData || busyRef.current || fileBusyRef.current) return;
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
  const execute = async (operation: 'mesh' | 'solve') => {
    if (
      busyRef.current ||
      fileBusyRef.current ||
      confirmationRef.current ||
      invalidDraftsRef.current.size ||
      validation
    )
      return;
    const snapshot = structuredClone(project);
    const job = {
      token: ++serial.current,
      cancelled: false,
      jobId: undefined as string | undefined,
    };
    active.current = job;
    setBusy(operation);
    busyRef.current = operation;
    setCancelling(false);
    setProgress(null);
    setError(null);
    setNotice(null);
    setProbe(null);
    try {
      const manifest = await runJob(operation, snapshot);
      if (verification)
        void invoke('verification_trace', { message: 'frontend manifest received' });
      if (job.cancelled || active.current?.token !== job.token) return;
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
      if (verification) void invoke('verification_trace', { message: 'frontend result set' });
      setFieldId(operation === 'solve' ? 'displacement-mag' : 'geometry');
      if (operation === 'solve') setSection('results');
      setDirty(true);
      setNotice(operation === 'solve' ? 'Analysis complete' : 'Volume mesh generated');
    } catch (cause) {
      if (!job.cancelled) {
        setError(String(cause));
        if (verification)
          void invoke('verification_complete', { report: { error: String(cause) } });
      } else setNotice('Job cancelled; worker stopped');
    } finally {
      if (active.current?.token === job.token) {
        active.current = null;
        setBusy(null);
        busyRef.current = null;
        setCancelling(false);
      }
    }
  };
  const cancel = async () => {
    if (!active.current || cancelling) return;
    active.current.cancelled = true;
    setCancelling(true);
    try {
      await cancelJob();
      setNotice('Cancellation acknowledged; worker stopped');
    } catch (cause) {
      setError(`Cancellation failed: ${String(cause)}`);
      setCancelling(false);
    }
  };
  useEffect(() => {
    if (!desktop || verificationStarted.current) return;
    verificationStarted.current = true;
    void invoke<boolean>('verification_mode')
      .then((enabled) => {
        if (enabled) {
          setDeformation('actual');
          setVerification(true);
        }
      })
      .catch((cause) => setError(String(cause)));
  }, [desktop]);
  useEffect(() => {
    if (verification && !active.current) void execute('solve');
  }, [verification]);
  const verified = (report: Record<string, unknown>) => {
    if (!verification || verificationSent.current || !currentData) return;
    void invoke('verification_trace', { message: `frontend rendered ${fieldId}` });
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
      setProgress(event);
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
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);
  useEffect(() => {
    if (!confirmation && !help) return;
    const previous = document.activeElement;
    const modal = document.querySelector<HTMLElement>('.modal');
    const buttons = Array.from(
      modal?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [],
    );
    buttons[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (confirmation) {
          setConfirmation(false);
          confirmResolver.current?.('cancel');
          confirmResolver.current = null;
        } else setHelp(false);
      }
      if (event.key === 'Tab' && buttons.length) {
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
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
      if (!event.metaKey && !event.ctrlKey) return;
      const character = event.key.toLowerCase();
      if (!['s', 'o', 'n'].includes(character)) return;
      event.preventDefault();
      if (busyRef.current || fileBusyRef.current || confirmationRef.current) return;
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
  }, [save, open, create]);
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
        components: [0, 0, 0],
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
        vector: [0, 0, -100],
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

  return (
    <NumericDraftContext.Provider value={reportDraftValidity}>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand">
            <div className="brand-symbol">
              <Waves size={23} strokeWidth={2.4} />
            </div>
            <strong>
              phyra<span>WORKBENCH</span>
            </strong>
          </div>
          <div className="file-actions">
            <button
              title="New project · Ctrl/⌘ N"
              aria-label="New project"
              disabled={locked}
              onClick={() => void create()}
            >
              <FilePlus2 size={17} />
            </button>
            <button
              title="Open project · Ctrl/⌘ O"
              aria-label="Open project"
              disabled={locked || !desktop}
              onClick={() => void open()}
            >
              <FolderOpen size={17} />
            </button>
            <button
              title="Save · Ctrl/⌘ S"
              aria-label="Save project"
              disabled={locked || !!validation || !desktop}
              onClick={() => void save()}
            >
              <Save size={17} />
            </button>
            <button
              className="save-as"
              disabled={locked || !!validation || !desktop}
              onClick={() => void save(true)}
            >
              Save as
            </button>
          </div>
          <div className="project-title">
            {project.name}
            {dirty && <span className="dirty-dot" title="Unsaved changes" />}
            <span>{path ? path.split(/[\\/]/).pop() : 'Local project'}</span>
          </div>
          <div className="header-end">
            <span className="local-tag">
              <span />
              LOCAL CPU
            </span>
            <button aria-label="Workflow help" title="Workflow help" onClick={() => setHelp(true)}>
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <div className="workspace">
          <aside className="model-panel" style={{ width: leftWidth }}>
            <div className="panel-heading">
              <span>PROJECT</span>
              <select
                aria-label="Load example"
                disabled={locked}
                value=""
                onChange={(event) => void create(event.target.value as ExampleId)}
              >
                <option value="">Examples</option>
                <option value="cantilever">Cantilever beam</option>
                <option value="cylinder">Axial cylinder</option>
                <option value="bracket">L bracket</option>
                <option value="extension">Prescribed extension</option>
              </select>
            </div>
            <div className="study-title">
              <Activity size={17} />
              <div>
                <strong>Linear static</strong>
                <small>3D · isotropic elasticity</small>
              </div>
            </div>
            <nav className="model-tree">
              <button
                className={`tree-row ${section === 'geometry' ? 'active' : ''}`}
                onClick={() => selectSection('geometry')}
              >
                <Box size={16} />
                <span>
                  Geometry
                  <small>
                    {project.geometry.kind === 'box'
                      ? 'Rectangular solid'
                      : project.geometry.kind === 'cylinder'
                        ? 'Cylinder'
                        : 'L bracket'}
                  </small>
                </span>
                <ChevronRight size={13} />
              </button>
              <button
                className={`tree-row ${section === 'material' ? 'active' : ''}`}
                onClick={() => selectSection('material')}
              >
                <Layers3 size={16} />
                <span>
                  Material<small>{project.study.material.name}</small>
                </span>
                <ChevronRight size={13} />
              </button>
              <button
                className={`tree-row ${section === 'mesh' ? 'active' : ''}`}
                onClick={() => selectSection('mesh')}
              >
                <Magnet size={16} />
                <span>
                  Volume mesh
                  <small>
                    {stat ? `${stat.cells.toLocaleString()} tetrahedra` : 'Not generated'}
                  </small>
                </span>
                {stat && <span className="tree-dot" />}
              </button>
              <div className="tree-group-label">
                <button onClick={() => selectSection('constraints')}>
                  SUPPORTS <span>{project.study.constraints.length}</span>
                </button>
                <button aria-label="Add support" disabled={locked} onClick={addConstraint}>
                  <Plus size={14} />
                </button>
              </div>
              {project.study.constraints.map((item) => (
                <button
                  key={item.id}
                  className={`tree-row child ${section === 'constraints' && constraintId === item.id ? 'active' : ''}`}
                  onClick={() => selectSection('constraints', item.id)}
                >
                  <LockKeyhole size={14} />
                  <span>
                    {item.name}
                    <small>{item.regions.join(', ')}</small>
                  </span>
                </button>
              ))}
              <div className="tree-group-label">
                <button onClick={() => selectSection('loads')}>
                  LOADS <span>{project.study.loads.length}</span>
                </button>
                <button aria-label="Add load" disabled={locked} onClick={addLoad}>
                  <Plus size={14} />
                </button>
              </div>
              {project.study.loads.map((item) => (
                <button
                  key={item.id}
                  className={`tree-row child ${section === 'loads' && loadId === item.id ? 'active' : ''}`}
                  onClick={() => selectSection('loads', item.id)}
                >
                  <ArrowUpRight size={14} />
                  <span>
                    {item.name}
                    <small>
                      {item.kind === 'force' ? 'Total surface force' : 'Normal pressure'}
                    </small>
                  </span>
                </button>
              ))}
              <div className="tree-divider" />
              <button
                className={`tree-row ${section === 'results' ? 'active' : ''}`}
                onClick={() => selectSection('results')}
              >
                <Activity size={16} />
                <span>
                  Results
                  <small>
                    {solved
                      ? 'Current solution'
                      : data?.manifest.operation === 'solve'
                        ? 'Stale · inputs changed'
                        : 'No solution yet'}
                  </small>
                </span>
                {solved && <Check size={14} className="success" />}
              </button>
            </nav>
            <div className="model-footer">
              <span className="scope-label">SUPPORTED SCOPE</span>
              <p>
                Small strain · linear elasticity
                <br />
                Connected, homogeneous solid
              </p>
            </div>
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
                <span className="eyebrow">STRUCTURAL ANALYSIS</span>
                <h1>{section === 'results' ? 'Inspect the solution' : 'Build your analysis'}</h1>
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
                    onClick={() => void execute('solve')}
                  >
                    <Play size={14} fill="currentColor" />
                    Solve
                  </button>
                )}
              </div>
            </div>
            {!desktop && (
              <div className="browser-banner">
                Browser preview · open the desktop application to mesh, solve, and use native
                project files.
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
                {project.geometry.kind.toUpperCase()}
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
                {fieldOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="viewport-wrap">
              <Viewport
                project={project}
                data={currentData}
                field={field}
                selected={selected}
                onSelect={selectRegion}
                onProbe={setProbe}
                onVerified={verification ? verified : undefined}
                edges={edges}
                deformation={deformation}
                customScale={customScale}
              />
              {field && (
                <div className="contour-legend">
                  <strong>{field.label}</strong>
                  <span>
                    {field.association === 'cell'
                      ? 'Element values · full volume'
                      : 'Nodal values · full volume'}
                  </span>
                  <div className="legend-gradient" />
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
                <span>Geometry ready · generate a volume mesh to inspect discretization</span>
              )}
              <span className="status-right">
                {fileBusy ? (
                  <>
                    <span className="spinner" />
                    {fileBusy === 'open'
                      ? 'Opening project'
                      : fileBusy === 'save'
                        ? 'Saving project'
                        : 'Exporting fields'}
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
              <Settings2 size={15} />
            </div>
            <div className="properties-scroll">
              <fieldset disabled={locked} key={`${project.id}:${project.displayUnits}`}>
                {section === 'geometry' && (
                  <>
                    <Group title="Solid definition">
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
                        <span>Primitive</span>
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
                          <option value="box">Rectangular solid</option>
                          <option value="cylinder">Cylinder · X axis</option>
                          <option value="bracket">L bracket · XY plane</option>
                        </select>
                      </label>
                      {(
                        [
                          'length',
                          ...(project.geometry.kind === 'cylinder'
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
                      {project.geometry.kind === 'cylinder'
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
                          One isotropic material for the entire solid. Generic example properties
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
                    <Group title="Volume discretization">
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
                        Gmsh generates connected 3D tetrahedra. This is a target edge scale; the
                        mesher adapts to boundaries.
                      </p>
                    </Group>
                    {stat && (
                      <Group title="Mesh statistics">
                        <Metric label="Nodes" value={stat.nodes} />
                        <Metric label="Tetrahedral cells" value={stat.cells} />
                        <Metric label="Surface triangles" value={stat.surfaceTriangles} />
                        <Metric label="Minimum quality" value={stat.minQuality} />
                        <p className="property-hint">Quality metric: {stat.qualityMetric}</p>
                      </Group>
                    )}
                    <div className="info-card">
                      <Magnet size={18} />
                      <div>
                        <strong>First-order tetrahedra</strong>
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
                                constraint.components.every((value) => value === 0) ? 'active' : ''
                              }
                              onClick={() =>
                                editConstraint((item) => {
                                  item.components = [0, 0, 0];
                                })
                              }
                            >
                              Fixed
                            </button>
                            <button
                              className={
                                constraint.components.some((value) => value !== 0) ? 'active' : ''
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
                            {(['X', 'Y', 'Z'] as const).map((axis, index) => (
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
                            ))}
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
                      title="Surface loads"
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
                              <option value="pressure">Surface pressure</option>
                            </select>
                          </label>
                          {load.kind === 'force' ? (
                            <>
                              {(['X', 'Y', 'Z'] as const).map((axis, index) => (
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
                              ))}
                              <p className="property-hint">
                                One total vector force across all assigned faces, distributed by
                                surface area in the global frame.
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
                      {data?.manifest.operation === 'solve'
                        ? 'Solution is stale'
                        : 'No solution yet'}
                    </h3>
                    <p>
                      {data?.manifest.operation === 'solve'
                        ? 'The inputs have changed. Solve again to inspect current physical fields.'
                        : 'Define your material, boundary supports, and loading, then solve the model.'}
                    </p>
                    <button
                      className="primary full"
                      disabled={locked || !!validation || !desktop}
                      onClick={() => void execute('solve')}
                    >
                      <Play size={14} />
                      Solve analysis
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
                          {fieldOptions.map((option) => (
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
                      <p className="property-hint">
                        Amplification uses displacement and model size, independent of the contour
                        field. Gray edges show the undeformed outline.
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
                      <Group title="Physical summary">
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
                          label="Relative free-DOF residual"
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
                          Extrema include the full volume. Reactions use the original equilibrium
                          equations. Stresses follow XX, YY, ZZ, XY, YZ, XZ; shear values are tensor
                          components.
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
                    disabled={choice === 'save' && !!validation}
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
        {help && (
          <div className="modal-backdrop">
            <div
              className="modal help-modal"
              role="dialog"
              aria-modal="true"
              aria-labelledby="help-title"
            >
              <button
                className="modal-close"
                aria-label="Close help"
                onClick={() => setHelp(false)}
              >
                <X size={18} />
              </button>
              <span className="eyebrow">LOCAL ENGINEERING WORKFLOW</span>
              <h2 id="help-title">From geometry to results</h2>
              <ol>
                <li>Edit a box, cylinder, or L bracket. Set the material and mesh size.</li>
                <li>
                  Click boundaries in the viewport. Add supports and distributed force or pressure
                  loads.
                </li>
                <li>
                  Mesh to inspect the discretization, then solve. Under-constrained models are
                  reported.
                </li>
                <li>
                  Explore displacements, element stresses, and reactions. Compare mesh refinements
                  for convergence.
                </li>
                <li>
                  Save the project and cached fields, reopen it, or export the physical arrays.
                </li>
              </ol>
              <p className="property-hint">
                Ctrl/⌘ N · New &nbsp; Ctrl/⌘ O · Open &nbsp; Ctrl/⌘ S · Save
                <br />
                Ctrl/⌘ Shift S · Save as &nbsp; F · Fit model
              </p>
              <button className="primary full" onClick={() => setHelp(false)}>
                Continue
              </button>
            </div>
          </div>
        )}
      </div>
    </NumericDraftContext.Provider>
  );
}
