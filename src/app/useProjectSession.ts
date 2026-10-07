import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectDefinition as Project } from '../domain/contracts/types';
import { resultIsCurrent } from '../domain/execution/presentation';
import {
  createHistory,
  recordEdit,
  undo as undoEdit,
  redo as redoEdit,
} from '../domain/project/history';
import { blankProject, documentError, documentSizeError } from '../domain/project/document';
import type { ResultData } from '../domain/results/fields';
import { makeProject, type ExampleId } from '../features/examples/projects';
import { loadReference, type ReferenceId } from '../features/examples/references';
import { exportResults, openProject, saveProject } from '../platform/desktop/bridge';
import type { FileOperation, WorkbenchActivity } from './workbenchActivity';
import {
  closeProjectDocument,
  persistProjectSnapshot,
  projectReplacementIssue,
  scheduleProjectAutosave,
} from './projectPersistence';

export type AutosaveStatus =
  'off' | 'needs-save' | 'waiting' | 'saving' | 'saved' | 'paused' | 'error';

interface Props {
  documentId: string;
  initialProject: Project;
  initialPath?: string | null;
  initialDirty?: boolean;
  initialReferenceId?: ReferenceId | null;
  desktop: boolean;
  activity: WorkbenchActivity;
  currentResult: () => ResultData | null;
  clearRecovery: () => Promise<void>;
  prepareDocumentClose: () => Promise<void>;
  retireDocument: () => Promise<void>;
  beforeConfirmation: () => void;
  onReplace: (project: Project, data: ResultData | null) => void;
  onReference: (id: ReferenceId) => void;
  onEdit: () => void;
  onHistoryNavigate: (project: Project, notice: string) => void;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
}

// Owns editable definitions, unsaved drafts and association with a native archive.
// Adopting a definition delegates result/view reset to composition, never recovery storage.
export function useProjectSession(props: Props) {
  const { desktop, activity } = props;
  const callbacks = useRef(props);
  callbacks.current = props;
  const busyRef = activity.execution;
  const fileBusyRef = activity.file;
  const deviceBusyRef = activity.device;
  const recoveryBusyRef = activity.recovery;
  const confirmationRef = activity.confirmation;
  const [project, setProject] = useState<Project>(() => structuredClone(props.initialProject));
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef(createHistory(project));
  const [, setHistoryRevision] = useState(0);
  const [dirty, setDirtyState] = useState(props.initialDirty ?? false);
  const documentGeneration = useRef(0);
  const editGeneration = useRef(0);
  const [saveRevision, setSaveRevision] = useState(0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const setDirty = useCallback((value: boolean) => {
    if (value) {
      editGeneration.current += 1;
      setSaveRevision((revision) => revision + 1);
    }
    dirtyRef.current = value;
    setDirtyState(value);
  }, []);
  const invalidDraftsRef = useRef(new Map<string, string>());
  const [invalidDraftLabels, setInvalidDraftLabels] = useState<string[]>([]);
  const reportDraftValidity = useCallback((id: string, label: string | null, markDirty = true) => {
    const drafts = invalidDraftsRef.current;
    if (label === null) {
      if (!drafts.delete(id)) return;
    } else {
      if (drafts.get(id) === label) return;
      drafts.set(id, label);
      if (markDirty) setDirty(true);
    }
    setInvalidDraftLabels(Array.from(drafts.values()));
  }, []);
  const [path, setPath] = useState<string | null>(props.initialPath ?? null);
  const pathRef = useRef(path);
  pathRef.current = path;
  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [autosavePhase, setAutosavePhase] = useState<AutosaveStatus>('saved');
  const [autosaveError, setAutosaveError] = useState<string | null>(null);
  const automaticSave = useRef(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const transitionPending = useRef(false);
  const [transitioning, setTransitioning] = useState(false);
  const [referenceId, setReferenceId] = useState<ReferenceId | null>(
    props.initialReferenceId ?? null,
  );
  const [fileBusy, setFileBusy] = useState<FileOperation | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const confirmResolver = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);
  const validation = invalidDraftLabels.length
    ? `${invalidDraftLabels[0]} has an unfinished draft. Apply, complete or revert it before continuing.`
    : documentError(project);
  const fileBusyLabel =
    fileBusy === 'open'
      ? 'Opening project'
      : fileBusy === 'save'
        ? 'Saving project'
        : fileBusy === 'reference'
          ? 'Loading saved CPU reference'
          : 'Exporting fields';
  const edit = useCallback((change: (next: Project) => void, physical = true) => {
    if (
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current ||
      recoveryBusyRef.current ||
      transitionPending.current
    )
      return;
    try {
      const previous = projectRef.current;
      const next = structuredClone(previous);
      change(next);
      if (
        JSON.stringify(previous.geometry) !== JSON.stringify(next.geometry) &&
        (next.geometry.kind === 'cad' || next.geometry.kind === 'empty')
      ) {
        if (next.geometry.kind === 'empty' || next.study?.dimension !== next.geometry.dimension)
          next.study = null;
        else if (next.study) {
          next.study.constraints = [];
          next.study.loads = [];
        }
      }
      const sizeError = documentSizeError(next);
      if (sizeError) throw new Error(sizeError);
      const transition = recordEdit(historyRef.current, previous, next, physical);
      const advancedSizeError = documentSizeError(transition.project);
      if (advancedSizeError) throw new Error(advancedSizeError);
      if (!transition.changed) return;
      historyRef.current = transition.history;
      projectRef.current = transition.project;
      setProject(transition.project);
      setHistoryRevision((revision) => revision + 1);
      setDirty(true);
      callbacks.current.onEdit();
      callbacks.current.onError(null);
      if (transition.notice) callbacks.current.onNotice(transition.notice);
    } catch (cause) {
      callbacks.current.onError(String(cause));
    }
  }, []);
  const navigateHistory = useCallback((direction: 'undo' | 'redo') => {
    if (
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current ||
      recoveryBusyRef.current ||
      deviceBusyRef.current ||
      confirmationRef.current ||
      transitionPending.current ||
      invalidDraftsRef.current.size
    )
      return;
    try {
      const history = historyRef.current;
      const entry = direction === 'undo' ? history.past.at(-1) : history.future.at(-1);
      const transition = (direction === 'undo' ? undoEdit : redoEdit)(history, projectRef.current);
      if (!transition.changed) return;
      historyRef.current = transition.history;
      projectRef.current = transition.project;
      setProject(transition.project);
      setHistoryRevision((revision) => revision + 1);
      setDirty(true);
      callbacks.current.onEdit();
      callbacks.current.onError(null);
      callbacks.current.onHistoryNavigate(
        transition.project,
        entry?.physical
          ? 'Inputs restored · recompute the analysis'
          : direction === 'undo'
            ? 'Edit undone'
            : 'Edit restored',
      );
    } catch (cause) {
      callbacks.current.onError(String(cause));
    }
  }, []);
  const writeSnapshot = useCallback(
    async (saveAs = false, automatic = false): Promise<boolean> => {
      if (
        !desktop ||
        activity.cad?.current ||
        busyRef.current ||
        fileBusyRef.current ||
        recoveryBusyRef.current ||
        deviceBusyRef.current
      )
        return false;
      if (
        !!activity.native.cad?.current ||
        !!activity.native.execution.current ||
        activity.native.file.current ||
        activity.native.device.current
      )
        return false;
      if (
        automatic &&
        (confirmationRef.current ||
          transitionPending.current ||
          activity.native.closing.current ||
          !pathRef.current)
      )
        return false;
      if (invalidDraftsRef.current.size) {
        callbacks.current.onError('Complete or revert the invalid numeric input before saving.');
        return false;
      }
      fileBusyRef.current = 'save';
      activity.native.file.current = 'save';
      setFileBusy('save');
      automaticSave.current = automatic;
      if (automatic) setAutosavePhase('saving');
      setAutosaveError(null);
      try {
        const current = structuredClone(projectRef.current);
        const document = documentGeneration.current;
        const edit = editGeneration.current;
        const data = callbacks.current.currentResult();
        const cache = data && resultIsCurrent(current, data) ? data.manifest.jobId : undefined;
        const saved = await persistProjectSnapshot(
          { project: current, path: pathRef.current, jobId: cache, saveAs, automatic },
          {
            write: (definition, jobId, as, automaticWrite) =>
              saveProject(definition, jobId, as, automaticWrite, props.documentId),
            sameDocument: () => documentGeneration.current === document,
            current: () => editGeneration.current === edit && invalidDraftsRef.current.size === 0,
            associate: (savedPath) => {
              pathRef.current = savedPath;
              setPath(savedPath);
            },
            markSaved: () => setDirty(false),
            clearRecovery: () => callbacks.current.clearRecovery(),
            cleanupFailed: (cause) =>
              callbacks.current.onError(`Recovery cleanup failed after saving: ${String(cause)}`),
          },
        );
        if (saved) {
          setAutosavePhase('saved');
          if (!automatic)
            callbacks.current.onNotice(`Saved ${pathRef.current?.split(/[\\/]/).pop()}`);
        } else if (automatic) {
          setAutosavePhase('waiting');
        }
        return saved;
      } catch (cause) {
        const message = String(cause);
        if (automatic) {
          setAutosaveError(message);
          setAutosavePhase('error');
          callbacks.current.onError(`Autosave failed · Save manually to retry. ${message}`);
        } else callbacks.current.onError(message);
        return false;
      } finally {
        automaticSave.current = false;
        fileBusyRef.current = null;
        activity.native.file.current = null;
        setFileBusy(null);
      }
    },
    [activity, desktop],
  );
  const save = useCallback(
    (saveAs = false): Promise<boolean> => {
      if (pendingSave.current) return pendingSave.current;
      const writing = writeSnapshot(saveAs);
      pendingSave.current = writing;
      void writing.finally(() => {
        if (pendingSave.current === writing) pendingSave.current = null;
      });
      return writing;
    },
    [writeSnapshot],
  );
  useEffect(() => {
    if (!desktop || !autosaveEnabled || !path || !dirty) return;
    if (validation) {
      setAutosavePhase('paused');
      return;
    }
    setAutosaveError(null);
    return scheduleProjectAutosave({
      dirty: () => dirtyRef.current,
      blocked: () =>
        !!busyRef.current ||
        !!fileBusyRef.current ||
        !!activity.native.cad?.current ||
        !!activity.native.execution.current ||
        !!activity.native.file.current ||
        activity.native.device.current ||
        activity.native.closing.current ||
        recoveryBusyRef.current ||
        deviceBusyRef.current ||
        confirmationRef.current ||
        transitionPending.current,
      waiting: () => setAutosavePhase('waiting'),
      paused: () => setAutosavePhase('paused'),
      save: () => {
        const writing = writeSnapshot(false, true);
        pendingSave.current = writing;
        void writing.finally(() => {
          if (pendingSave.current === writing) pendingSave.current = null;
        });
      },
    });
  }, [desktop, autosaveEnabled, path, dirty, project, validation, saveRevision, writeSnapshot]);
  const autosaveStatus: AutosaveStatus =
    !desktop || !autosaveEnabled
      ? 'off'
      : !path
        ? 'needs-save'
        : automaticSave.current
          ? 'saving'
          : !dirty
            ? 'saved'
            : validation
              ? 'paused'
              : autosavePhase;
  const canReplace = useCallback(async (): Promise<boolean> => {
    // Closing/replacing waits for an already-owned automatic write. No later
    // completion can clear the next document's dirty state or recovery journal.
    if (automaticSave.current && pendingSave.current) await pendingSave.current;
    const commandIssue = projectReplacementIssue(invalidDraftsRef.current);
    if (commandIssue) {
      callbacks.current.onError(commandIssue);
      return false;
    }
    if (
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current ||
      confirmationRef.current ||
      recoveryBusyRef.current
    )
      return false;
    if (!dirtyRef.current) return true;
    confirmationRef.current = true;
    callbacks.current.beforeConfirmation();
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmation(true);
    });
    try {
      if (choice === 'cancel') return false;
      if (choice === 'save') return await save();
      await callbacks.current.clearRecovery();
      return true;
    } catch (cause) {
      callbacks.current.onError(`Recovery cleanup failed: ${String(cause)}`);
      return false;
    } finally {
      confirmationRef.current = false;
    }
  }, [save]);
  const canReplaceRef = useRef(canReplace);
  canReplaceRef.current = canReplace;
  const replace = (next: Project, result: ResultData | null = null) => {
    documentGeneration.current += 1;
    editGeneration.current = 0;
    // A confirmed replacement owns a fresh definition. Drafts from the old
    // editor must not leak into the new project or rely on React unmount timing.
    invalidDraftsRef.current.clear();
    setInvalidDraftLabels([]);
    projectRef.current = next;
    historyRef.current = createHistory(next);
    setHistoryRevision((revision) => revision + 1);
    setProject(next);
    setDirty(false);
    pathRef.current = null;
    setPath(null);
    setAutosavePhase('saved');
    setAutosaveError(null);
    setReferenceId(null);
    callbacks.current.onReplace(next, result);
  };
  const close = async (): Promise<boolean> => {
    if (deviceBusyRef.current || transitionPending.current) return false;
    transitionPending.current = true;
    setTransitioning(true);
    try {
      return await closeProjectDocument({
        prepareClose: () => callbacks.current.prepareDocumentClose(),
        canReplace,
        clearRecovery: async () => {
          await callbacks.current.clearRecovery();
          await callbacks.current.retireDocument();
        },
        close: () => {
          replace(makeProject());
          callbacks.current.onNotice('Project closed');
        },
      });
    } catch (cause) {
      callbacks.current.onError(`Project remains open: ${String(cause)}`);
      return false;
    } finally {
      transitionPending.current = false;
      setTransitioning(false);
    }
  };
  const create = useCallback(
    async (example?: ExampleId, name?: string, dimension: '2d' | '3d' = '3d'): Promise<boolean> => {
      if (transitionPending.current || deviceBusyRef.current) return false;
      transitionPending.current = true;
      setTransitioning(true);
      try {
        if (!(await canReplace())) return false;
        await callbacks.current.clearRecovery();
        const next = example ? makeProject(example) : blankProject(name, dimension);
        if (name?.trim()) next.name = name.trim();
        replace(next);
        setDirty(true);
        return true;
      } catch (cause) {
        callbacks.current.onError(`Recovery cleanup failed: ${String(cause)}`);
        return false;
      } finally {
        transitionPending.current = false;
        setTransitioning(false);
      }
    },
    [canReplace],
  );
  const open = useCallback(async () => {
    if (!desktop || transitionPending.current || deviceBusyRef.current) return false;
    transitionPending.current = true;
    setTransitioning(true);
    let ownsFileOperation = false;
    try {
      if (!(await canReplace())) return false;
      if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return false;
      if (
        !!activity.native.cad?.current ||
        !!activity.native.execution.current ||
        activity.native.file.current ||
        activity.native.device.current
      )
        return false;
      fileBusyRef.current = 'open';
      activity.native.file.current = 'open';
      setFileBusy('open');
      ownsFileOperation = true;
      const opened = await openProject(props.documentId);
      if (!opened) return false;
      if ('existingDocumentId' in opened) return false;
      replace(
        opened.project,
        opened.manifest && opened.buffer
          ? { manifest: opened.manifest, buffer: opened.buffer }
          : null,
      );
      setPath(opened.path ?? null);
      pathRef.current = opened.path ?? null;
      callbacks.current.onNotice(opened.notice ?? 'Project opened');
      try {
        await callbacks.current.clearRecovery();
      } catch (cause) {
        callbacks.current.onError(
          `Recovery cleanup: the opened project is active; the earlier recovery copy was preserved. ${String(cause)}`,
        );
      }
      return true;
    } catch (cause) {
      callbacks.current.onError(String(cause));
      return false;
    } finally {
      transitionPending.current = false;
      setTransitioning(false);
      if (ownsFileOperation) {
        fileBusyRef.current = null;
        activity.native.file.current = null;
        setFileBusy(null);
      }
    }
  }, [canReplace, desktop]);
  const inspectReference = async (id: ReferenceId): Promise<boolean> => {
    if (desktop || deviceBusyRef.current || transitionPending.current) return false;
    transitionPending.current = true;
    setTransitioning(true);
    let ownsFileOperation = false;
    try {
      if (!(await canReplace())) return false;
      if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return false;
      fileBusyRef.current = 'reference';
      setFileBusy('reference');
      ownsFileOperation = true;
      callbacks.current.onError(null);
      const saved = await loadReference(id);
      replace(saved.project, saved.data);
      setReferenceId(id);
      callbacks.current.onReference(id);
      callbacks.current.onNotice('Saved CPU reference loaded');
      return true;
    } catch (cause) {
      callbacks.current.onError(`Reference result could not be opened: ${String(cause)}`);
      return false;
    } finally {
      transitionPending.current = false;
      setTransitioning(false);
      if (ownsFileOperation) {
        fileBusyRef.current = null;
        setFileBusy(null);
      }
    }
  };
  const exportFields = async () => {
    const currentData = callbacks.current.currentResult();
    if (
      !desktop ||
      !currentData ||
      !resultIsCurrent(projectRef.current, currentData) ||
      activity.cad?.current ||
      busyRef.current ||
      fileBusyRef.current
    )
      return;
    if (
      !!activity.native.cad?.current ||
      !!activity.native.execution.current ||
      activity.native.file.current ||
      activity.native.device.current
    )
      return;
    fileBusyRef.current = 'export';
    activity.native.file.current = 'export';
    setFileBusy('export');
    try {
      const saved = await exportResults(currentData.manifest.jobId, props.documentId);
      if (saved) callbacks.current.onNotice('Physical fields exported');
    } catch (cause) {
      callbacks.current.onError(String(cause));
    } finally {
      fileBusyRef.current = null;
      activity.native.file.current = null;
      setFileBusy(null);
    }
  };
  return {
    project,
    projectRef,
    edit,
    undo: () => navigateHistory('undo'),
    redo: () => navigateHistory('redo'),
    canUndo: historyRef.current.past.length > 0,
    canRedo: historyRef.current.future.length > 0,
    undoLabel: historyRef.current.past.at(-1)?.label ?? '',
    redoLabel: historyRef.current.future.at(-1)?.label ?? '',
    replace,
    dirty,
    dirtyRef,
    setDirty,
    invalidDraftsRef,
    invalidDraftLabels,
    reportDraftValidity,
    validation,
    transitioning,
    path,
    referenceId,
    fileBusy,
    fileBusyLabel,
    confirmation,
    setConfirmation,
    confirmResolver,
    canReplaceRef,
    create,
    open,
    save,
    close,
    autosaveEnabled,
    setAutosaveEnabled,
    autosaveStatus,
    autosaveError,
    inspectReference,
    exportFields,
  };
}
export type ProjectSession = ReturnType<typeof useProjectSession>;
