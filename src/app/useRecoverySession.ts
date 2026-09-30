import { useCallback, useEffect, useRef, useState } from 'react';
import type { Project } from '../domain/contracts/types';
import { recoveryEligible, recoverySnapshot } from '../domain/project/recovery';
import { inputError } from '../domain/project/validation';
import {
  clearRecovery,
  getRecovery,
  nextRecoverySequence,
  readRecovery,
  writeRecovery,
  type RecoveryRecord,
} from '../platform/desktop/recovery';
import { restoreRecoveryRecord } from './recoveryActions';
type Props = {
  desktop: boolean;
  verification: boolean;
  project: Project;
  dirty: boolean;
  invalidDrafts: number;
  blocked: boolean;
  onRestore: (project: Project) => void;
  onError: (message: string) => void;
};
export function useRecoverySession({
  desktop,
  verification,
  project,
  dirty,
  invalidDrafts,
  blocked,
  onRestore,
  onError,
}: Props) {
  const [records, setRecords] = useState<RecoveryRecord[]>([]);
  const [prompt, setPrompt] = useState(false);
  const [pending, setPending] = useState(false);
  const [ready, setReady] = useState(!desktop);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [checkpointRevision, setCheckpointRevision] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const latest = useRef({ project, dirty, invalidDrafts, blocked, onRestore, onError });
  latest.current = { project, dirty, invalidDrafts, blocked, onRestore, onError };
  const enabled = desktop && !verification;
  const enqueue = useCallback(<T>(task: () => Promise<T>): Promise<T> => {
    const next = queue.current.catch(() => undefined).then(task);
    queue.current = next;
    return next;
  }, []);
  useEffect(() => {
    if (!enabled) {
      setReady(true);
      return;
    }
    let disposed = false;
    void getRecovery()
      .then((inventory) => {
        if (disposed) return;
        setRecords(inventory.records);
        setPrompt(inventory.records.length > 0);
        setReady(true);
        if (inventory.unreadableCount)
          latest.current.onError(
            `Recovery: ${inventory.unreadableCount} recovery copies could not be read and were preserved. Save current work manually.`,
          );
      })
      .catch((cause) => {
        if (!disposed) {
          setReady(true);
          setFailed(true);
          latest.current.onError(`Recovery inventory failed: ${String(cause)}`);
        }
      });
    return () => {
      disposed = true;
    };
  }, [enabled]);
  useEffect(() => {
    if (
      !enabled ||
      !ready ||
      prompt ||
      pending ||
      blocked ||
      !recoveryEligible(project, dirty, invalidDrafts)
    )
      return;
    let disposed = false;
    const identity = JSON.stringify(project);
    const timeout = window.setTimeout(() => {
      if (
        latest.current.blocked ||
        !recoveryEligible(
          latest.current.project,
          latest.current.dirty,
          latest.current.invalidDrafts,
        ) ||
        JSON.stringify(latest.current.project) !== identity
      )
        return;
      const snapshot = recoverySnapshot(project);
      const ownSequence = nextRecoverySequence();
      void enqueue(() => writeRecovery(snapshot, ownSequence))
        .then((result) => {
          if (disposed || JSON.stringify(latest.current.project) !== identity || !result.accepted)
            return;
          setSavedAt(result.savedAt);
          setCheckpointRevision(result.revision);
          setFailed(false);
        })
        .catch((cause) => {
          if (disposed) return;
          setFailed(true);
          latest.current.onError(`Recovery checkpoint failed: ${String(cause)}`);
        });
    }, 1200);
    return () => {
      disposed = true;
      window.clearTimeout(timeout);
    };
  }, [enabled, ready, prompt, pending, blocked, project, dirty, invalidDrafts, enqueue]);
  const clearOwn = useCallback(async () => {
    if (!enabled) return;
    const ownSequence = nextRecoverySequence();
    await enqueue(() => clearRecovery(ownSequence));
    setSavedAt(null);
    setCheckpointRevision(null);
  }, [enabled, enqueue]);
  const restore = async (record: RecoveryRecord) => {
    if (pending || blocked) return;
    setPending(true);
    try {
      await restoreRecoveryRecord(record.id, {
        read: readRecovery,
        checkpoint: (snapshot) =>
          enqueue(() => writeRecovery(snapshot, nextRecoverySequence(), true)),
        adopt: (next, checkpoint) => {
          latest.current.onRestore(next);
          setPrompt(false);
          setSavedAt(checkpoint.savedAt);
          setCheckpointRevision(checkpoint.revision);
          setFailed(false);
        },
        removePrior: async (id) => {
          await enqueue(() => clearRecovery(nextRecoverySequence(), id));
          setRecords((previous) => previous.filter((item) => item.id !== id));
        },
        onCleanupFailure: (cause) =>
          latest.current.onError(
            `Recovery cleanup: the recovered project is active; its earlier copy was preserved. ${String(cause)}`,
          ),
      });
    } catch (cause) {
      latest.current.onError(`Recovery restore failed: ${String(cause)}`);
    } finally {
      setPending(false);
    }
  };
  const discard = async (record: RecoveryRecord) => {
    if (pending || blocked) return;
    setPending(true);
    try {
      await enqueue(() => clearRecovery(nextRecoverySequence(), record.id));
      setRecords((previous) => {
        const next = previous.filter((item) => item.id !== record.id);
        if (!next.length) setPrompt(false);
        return next;
      });
    } catch (cause) {
      latest.current.onError(`Recovery discard failed: ${String(cause)}`);
    } finally {
      setPending(false);
    }
  };
  const status = !enabled
    ? null
    : !ready
      ? 'Checking recovery'
      : failed
        ? 'Recovery unavailable · save manually'
        : invalidDrafts || inputError(project)
          ? 'Recovery paused · invalid inputs'
          : !dirty
            ? 'Project unchanged'
            : checkpointRevision === project.revision && savedAt
              ? 'Recovery definition saved'
              : 'Recovery pending';
  return {
    records,
    prompt,
    setPrompt,
    pending,
    ready,
    status,
    savedAt,
    clearOwn,
    restore,
    discard,
  };
}
