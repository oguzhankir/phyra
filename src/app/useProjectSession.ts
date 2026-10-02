import { useCallback, useRef, useState } from 'react';
import type { Project } from '../domain/contracts/types';
import { resultIsCurrent } from '../domain/execution/presentation';
import {
  createHistory,
  recordEdit,
  undo as undoEdit,
  redo as redoEdit,
} from '../domain/project/history';
import { inputError } from '../domain/project/validation';
import type { ResultData } from '../domain/results/fields';
import { makeProject, type ExampleId } from '../features/examples/projects';
import { loadReference, type ReferenceId } from '../features/examples/references';
import { exportResults, openProject, saveProject } from '../platform/desktop/bridge';
import type { FileOperation, WorkbenchActivity } from './workbenchActivity';

interface Props {
  desktop: boolean;
  activity: WorkbenchActivity;
  currentResult: () => ResultData | null;
  clearRecovery: () => Promise<void>;
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
  const [project, setProject] = useState<Project>(() => makeProject('plane-stress-tension'));
  const projectRef = useRef(project);
  projectRef.current = project;
  const historyRef = useRef(createHistory(project));
  const [, setHistoryRevision] = useState(0);
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
  const [fileBusy, setFileBusy] = useState<FileOperation | null>(null);
  const [confirmation, setConfirmation] = useState(false);
  const confirmResolver = useRef<((choice: 'save' | 'discard' | 'cancel') => void) | null>(null);
  const validation = invalidDraftLabels.length
    ? `${invalidDraftLabels[0]} has an incomplete or nonfinite numeric draft. Complete it, or press Escape to revert before continuing.`
    : inputError(project);
  const fileBusyLabel =
    fileBusy === 'open'
      ? 'Opening project'
      : fileBusy === 'save'
        ? 'Saving project'
        : fileBusy === 'reference'
          ? 'Loading saved CPU reference'
          : 'Exporting fields';
  const edit = useCallback((change: (next: Project) => void, physical = true) => {
    if (busyRef.current || fileBusyRef.current || recoveryBusyRef.current) return;
    try {
      const previous = projectRef.current;
      const next = structuredClone(previous);
      change(next);
      const transition = recordEdit(historyRef.current, previous, next, physical);
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
      busyRef.current ||
      fileBusyRef.current ||
      recoveryBusyRef.current ||
      deviceBusyRef.current ||
      confirmationRef.current ||
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
  const save = useCallback(
    async (saveAs = false): Promise<boolean> => {
      if (!desktop || busyRef.current || fileBusyRef.current || recoveryBusyRef.current)
        return false;
      if (invalidDraftsRef.current.size) {
        callbacks.current.onError('Complete or revert the invalid numeric input before saving.');
        return false;
      }
      fileBusyRef.current = 'save';
      setFileBusy('save');
      try {
        const current = structuredClone(projectRef.current);
        const invalid = inputError(current);
        if (invalid) {
          callbacks.current.onError(invalid);
          return false;
        }
        const data = callbacks.current.currentResult();
        const cache = data && resultIsCurrent(current, data) ? data.manifest.jobId : undefined;
        const saved = await saveProject(current, cache, saveAs);
        if (!saved) return false;
        setPath(saved);
        setDirty(false);
        try {
          await callbacks.current.clearRecovery();
        } catch (cause) {
          callbacks.current.onError(`Recovery cleanup failed after saving: ${String(cause)}`);
        }
        callbacks.current.onNotice(`Saved ${saved.split(/[\\/]/).pop()}`);
        return true;
      } catch (cause) {
        callbacks.current.onError(String(cause));
        return false;
      } finally {
        fileBusyRef.current = null;
        setFileBusy(null);
      }
    },
    [activity, desktop],
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
    callbacks.current.beforeConfirmation();
    const choice = await new Promise<'save' | 'discard' | 'cancel'>((resolve) => {
      confirmResolver.current = resolve;
      setConfirmation(true);
    });
    confirmationRef.current = false;
    if (choice === 'cancel') return false;
    if (choice === 'save') return await save();
    try {
      await callbacks.current.clearRecovery();
      return true;
    } catch (cause) {
      callbacks.current.onError(`Recovery cleanup failed: ${String(cause)}`);
      return false;
    }
  }, [save]);
  const canReplaceRef = useRef(canReplace);
  canReplaceRef.current = canReplace;
  const replace = (next: Project, result: ResultData | null = null) => {
    // A confirmed replacement owns a fresh definition. Drafts from the old
    // editor must not leak into the new project or rely on React unmount timing.
    invalidDraftsRef.current.clear();
    setInvalidDraftLabels([]);
    projectRef.current = next;
    historyRef.current = createHistory(next);
    setHistoryRevision((revision) => revision + 1);
    setProject(next);
    setDirty(false);
    setPath(null);
    setReferenceId(null);
    callbacks.current.onReplace(next, result);
  };
  const create = useCallback(
    async (example?: ExampleId) => {
      if (await canReplace()) {
        try {
          await callbacks.current.clearRecovery();
          replace(makeProject(example));
        } catch (cause) {
          callbacks.current.onError(`Recovery cleanup failed: ${String(cause)}`);
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
      callbacks.current.onNotice(opened.notice ?? 'Project opened');
      try {
        await callbacks.current.clearRecovery();
      } catch (cause) {
        callbacks.current.onError(
          `Recovery cleanup: the opened project is active; the earlier recovery copy was preserved. ${String(cause)}`,
        );
      }
    } catch (cause) {
      callbacks.current.onError(String(cause));
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
    callbacks.current.onError(null);
    try {
      const saved = await loadReference(id);
      replace(saved.project, saved.data);
      setReferenceId(id);
      callbacks.current.onReference(id);
      callbacks.current.onNotice('Saved CPU reference loaded');
    } catch (cause) {
      callbacks.current.onError(`Reference result could not be opened: ${String(cause)}`);
    } finally {
      fileBusyRef.current = null;
      setFileBusy(null);
    }
  };
  const exportFields = async () => {
    const currentData = callbacks.current.currentResult();
    if (
      !desktop ||
      !currentData ||
      !resultIsCurrent(projectRef.current, currentData) ||
      busyRef.current ||
      fileBusyRef.current
    )
      return;
    fileBusyRef.current = 'export';
    setFileBusy('export');
    try {
      const saved = await exportResults(currentData.manifest.jobId);
      if (saved) callbacks.current.onNotice('Physical fields exported');
    } catch (cause) {
      callbacks.current.onError(String(cause));
    } finally {
      fileBusyRef.current = null;
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
    inspectReference,
    exportFields,
  };
}
export type ProjectSession = ReturnType<typeof useProjectSession>;
